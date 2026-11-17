const test = require("node:test"),
  assert = require("node:assert/strict")
const { load } = require("./lib/earth-source.cjs")
const noise = load("cloud-noise.js"),
  { renderBudget } = load("cloud-model.js")
test("cloud volume is periodic across all three axes", () => {
  for (const fn of [noise.value, noise.worley])
    for (const p of [
      [0.13, 1.89, 3.07],
      [-0.25, 2.13, 0.41],
    ]) {
      const expected = fn(...p, 4)
      for (let axis = 0; axis < 3; axis++) {
        const wrapped = [...p]
        wrapped[axis] += 4
        assert.ok(Math.abs(fn(...wrapped, 4) - expected) < 1e-10)
      }
    }
})
test("atlas gutters wrap within each slice without leaking adjacent slices", () => {
  const { width, data } = noise.generate(),
    { SIZE, TILES, STRIDE } = noise
  const pixel = (z, x, y) => {
    const i =
      ((Math.floor(z / TILES) * STRIDE + y + 1) * width +
        (z % TILES) * STRIDE +
        x +
        1) *
      4
    return data.subarray(i, i + 4)
  }
  for (const z of [0, 7, 8, 31, 63])
    for (let i = 0; i < SIZE; i++) {
      assert.deepEqual(pixel(z, -1, i), pixel(z, SIZE - 1, i))
      assert.deepEqual(pixel(z, SIZE, i), pixel(z, 0, i))
      assert.deepEqual(pixel(z, i, -1), pixel(z, i, SIZE - 1))
      assert.deepEqual(pixel(z, i, SIZE), pixel(z, i, 0))
    }
})
test("cloud work remains bounded as display resolution and pixel ratio grow", () => {
  for (const [name, limit] of [
    ["low", 130000],
    ["balanced", 260000],
    ["high", 560000],
  ])
    for (const [w, h] of [
      [1, 1],
      [1100, 750],
      [3840, 2160],
      [7680, 4320],
    ]) {
      const b = renderBudget(w, h, name)
      assert.ok(b.width >= 1 && b.height >= 1)
      assert.ok(b.width * b.height <= limit)
      assert.ok(b.steps <= 64)
    }
  assert.equal(renderBudget(1100, 750, "high", false).lowResolution, false)
  assert.equal(renderBudget(1100, 750, "high", false).steps, 24)
})
