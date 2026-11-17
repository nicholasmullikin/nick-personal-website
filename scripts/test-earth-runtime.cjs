const test = require("node:test"),
  assert = require("node:assert/strict"),
  THREE = require("three")
const { clipPlanes, transform, triangleHeight } =
  require("./lib/earth-source.cjs").load("math.js")
const EarthAtmosphere = require("./lib/earth-source.cjs").load("atmosphere.js")
const R = 6378137

test("near-ground frustum includes the elevated horizon independently of target distance", () => {
  const clip = clipPlanes()
  for (const height of [0, 1, 40, 1000, 5000, 20000, 300000, 30000000]) {
    const result = clip.evaluateClipPlanes({
      position: new THREE.Vector3(R + height, 0, 0),
    })
    const horizon =
      Math.sqrt(height * (2 * R + height)) + Math.sqrt(9000 * (2 * R + 9000))
    assert.ok(Number.isFinite(result.near) && result.near > 0)
    assert.ok(result.far > horizon)
    assert.ok(result.maximum >= result.far && result.far > result.near)
  }
  const a = clip.evaluateClipPlanes({
    position: new THREE.Vector3(R + 40, 0, 0),
  }).far
  const b = clip.evaluateClipPlanes({
    position: new THREE.Vector3(R + 41, 0, 0),
  }).far
  assert.ok(
    Math.abs(a - b) < 1000,
    "range changes continuously near the ground",
  )
})
test("ancestor UV windows preserve both hemispheres and image orientation", () => {
  assert.deepEqual(
    transform({ z: 3, x: 4, y: 2 }, { z: 2, x: 2, y: 1 }),
    [0.5, 0.5, 0, 0.5],
  )
  assert.deepEqual(
    transform({ z: 3, x: 5, y: 3 }, { z: 2, x: 2, y: 1 }),
    [0.5, 0.5, 0.5, 0],
  )
  assert.deepEqual(transform({ z: 4, x: 15, y: 15 }, { z: 0, x: 0, y: 0 }), [
    1 / 16,
    1 / 16,
    15 / 16,
    0,
  ])
  assert.deepEqual(transform({ z: 4, x: 0, y: 0 }, { z: 0, x: 0, y: 0 }), [
    1 / 16,
    1 / 16,
    0,
    15 / 16,
  ])
})
test("optical-depth LUT models extinction, planet shadow, and clear space", () => {
  const texture = EarthAtmosphere.makeLut(THREE),
    { data, width, height } = texture.image
  const pixel = (x, y) => [
    ...data.slice((y * width + x) * 4, (y * width + x) * 4 + 3),
  ]
  assert.deepEqual(pixel(0, 0), [0, 0, 0], "planet blocks sunlight from below")
  const ground = pixel(width - 1, 0),
    space = pixel(width - 1, height - 1)
  assert.ok(
    ground[0] > ground[2] && ground[2] > 0,
    "blue scatters more than red",
  )
  assert.ok(
    space.every(v => v >= 254),
    "near-vacuum transmits sunlight",
  )
  assert.ok(data.every(Number.isFinite))
  texture.dispose()
})

test("camera elevation follows triangle faces rather than a bilinear saddle", () => {
  assert.equal(triangleHeight(0, 0, 0, 100, 0.25, 0.25), 0)
  assert.equal(triangleHeight(0, 0, 0, 100, 0.75, 0.75), 50)
  assert.equal(triangleHeight(0, 0, 0, 100, 0.75, 0.25), 0)
})
