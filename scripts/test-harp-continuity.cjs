const test = require("node:test")
const assert = require("node:assert/strict")
const THREE = require("three")
const { create } = require("./lib/earth-source.cjs").load("continuity.js")
const W = 64,
  N = W - 1
function tile(z, x, y) {
  const center = new THREE.Vector3(x * 10, y * 10, 17)
  const rotation = new THREE.Matrix4().makeRotationX(0.37)
  const frame = rotation.clone().setPosition(center),
    inverse = frame.clone().invert()
  const points = [],
    index = []
  for (let r = 0; r < W; r++)
    for (let c = 0; c < W; c++) {
      const wx = (x + c / N) / 2 ** z,
        wy = (y + r / N) / 2 ** z
      const v = new THREE.Vector3(
        wx * 1000,
        wy * 1000,
        30 * Math.sin(c * 0.2) + 15 * Math.cos(r * 0.3) + z * 10,
      ).applyMatrix4(inverse)
      points.push(...v.toArray())
      if (r < N && c < N) {
        const i = r * W + c
        index.push(i, i + W, i + 1, i + 1, i + W, i + W + 1)
      }
    }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(points, 3))
  geometry.setIndex(index)
  geometry.computeVertexNormals()
  const mesh = new THREE.Mesh(geometry)
  return {
    tileKey: { level: z, column: x, row: y },
    localTangentSpace: true,
    center,
    boundingBox: { getRotationMatrix: () => rotation },
    objects: [mesh],
    frame,
  }
}
const read = (t, i, field = "position") => {
  const v = new THREE.Vector3().fromBufferAttribute(
    t.objects[0].geometry.attributes[field],
    i,
  )
  return field === "position"
    ? v.applyMatrix4(t.frame)
    : v.applyMatrix3(new THREE.Matrix3().setFromMatrix4(t.frame))
}
// Independently compare every pair of adjoining borders, including endpoints.
function assertContinuous(tiles) {
  let pairs = 0
  for (const a of tiles)
    for (const b of tiles) {
      const { level: z, column: x, row: y } = a.tileKey,
        { level: zz, column: xx, row: yy } = b.tileKey
      if (zz < z) continue
      const s = 2 ** (zz - z)
      let ia, ib, start
      if (xx === (x + 1) * s && yy >= y * s && yy < (y + 1) * s) {
        ia = i => i * W + N
        ib = i => i * W
        start = yy / s - y
      } else if (yy === (y + 1) * s && xx >= x * s && xx < (x + 1) * s) {
        ia = i => N * W + i
        ib = i => i
        start = xx / s - x
      } else if (
        zz > z &&
        xx + 1 === x * s &&
        yy >= y * s &&
        yy < (y + 1) * s
      ) {
        ia = i => i * W
        ib = i => i * W + N
        start = yy / s - y
      } else if (
        zz > z &&
        yy + 1 === y * s &&
        xx >= x * s &&
        xx < (x + 1) * s
      ) {
        ia = i => i
        ib = i => N * W + i
        start = xx / s - x
      } else continue
      pairs++
      for (const field of ["position", "normal"])
        for (let i = 0; i < W; i++) {
          const u = (start + i / N / s) * N,
            j = Math.floor(u)
          const expected = read(a, ia(j), field).lerp(
            read(a, ia(Math.min(j + 1, N)), field),
            u - j,
          )
          const error = expected.distanceTo(read(b, ib(i), field))
          assert.ok(
            error < (field === "position" ? 0.0002 : 0.000002),
            `${field} ${JSON.stringify(a.tileKey)} -> ${JSON.stringify(b.tileKey)} vertex ${i}: ${error}`,
          )
        }
    }
  assert.ok(pairs > 0)
}
function fixture() {
  return [
    tile(1, 0, 0),
    tile(2, 2, 0),
    tile(2, 2, 1),
    tile(1, 0, 1),
    tile(3, 4, 4),
    tile(3, 4, 5),
    tile(2, 3, 1),
  ]
}
test("same level, coarse/fine in all directions, level jumps, and shared corners", () => {
  const tiles = fixture(),
    ds = {},
    reconcile = create(THREE, ds)
  const entries = [
    { dataSource: ds, renderedTiles: new Map(tiles.map((t, i) => [i, t])) },
  ]
  reconcile(entries)
  assertContinuous(tiles)
  const snapshot = tiles.map(t =>
    Array.from(t.objects[0].geometry.attributes.position.array),
  )
  reconcile(entries)
  assert.deepEqual(
    tiles.map(t => Array.from(t.objects[0].geometry.attributes.position.array)),
    snapshot,
  )
  // Eviction/reappearance must restore from the decoded originals, not accumulate edits.
  reconcile([{ dataSource: ds, renderedTiles: new Map([[0, tiles[0]]]) }])
  reconcile(entries)
  assertContinuous(tiles)
  assert.deepEqual(
    tiles.map(t => Array.from(t.objects[0].geometry.attributes.position.array)),
    snapshot,
  )
})
test("result is independent of tile traversal order", () => {
  const a = fixture(),
    b = fixture().reverse(),
    ds = {}
  create(
    THREE,
    ds,
  )([{ dataSource: ds, renderedTiles: new Map(a.map((t, i) => [i, t])) }])
  create(
    THREE,
    ds,
  )([{ dataSource: ds, renderedTiles: new Map(b.map((t, i) => [i, t])) }])
  assertContinuous(b)
  b.reverse()
  for (let i = 0; i < a.length; i++)
    for (const field of ["position", "normal"]) {
      const aa = a[i].objects[0].geometry.attributes[field].array,
        bb = b[i].objects[0].geometry.attributes[field].array
      for (let j = 0; j < aa.length; j++)
        assert.ok(Math.abs(aa[j] - bb[j]) < 0.0002)
    }
})

test("antimeridian uses one shared boundary, including coarse/fine corners", () => {
  const a = tile(2, 3, 1),
    b = tile(2, 0, 1)
  const c = tile(2, 3, 2),
    d = tile(3, 0, 4),
    e = tile(3, 0, 5)
  const ds = {},
    tiles = [a, b, c, d, e]
  create(
    THREE,
    ds,
  )([{ dataSource: ds, renderedTiles: new Map(tiles.map((t, i) => [i, t])) }])
  for (const field of ["position", "normal"]) {
    for (let i = 0; i < W; i++) {
      assert.ok(
        read(a, i * W + N, field).distanceTo(read(b, i * W, field)) < 0.0002,
      )
      for (const [fine, start] of [
        [d, 0],
        [e, 0.5],
      ]) {
        const u = (start + (i / N) * 0.5) * N,
          j = Math.floor(u)
        const expected = read(c, j * W + N, field).lerp(
          read(c, Math.min(j + 1, N) * W + N, field),
          u - j,
        )
        assert.ok(expected.distanceTo(read(fine, i * W, field)) < 0.0002)
      }
    }
  }
})
