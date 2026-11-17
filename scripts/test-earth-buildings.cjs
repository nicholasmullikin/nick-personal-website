const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  path = require("node:path")
const {
  source,
  sourceRequire: requireMap,
  load,
} = require("./lib/earth-source.cjs")
const { coords } = load("buildings.js")
async function fixture(features) {
  const { default: Pbf } = await import(requireMap.resolve("pbf"))
  const p = new Pbf()
  p.writeMessage(
    3,
    (_, layer) => {
      layer.writeStringField(1, "building")
      layer.writeVarintField(15, 2)
      layer.writeVarintField(5, 4096)
      for (const f of features)
        layer.writeMessage(
          2,
          (f, feature) => {
            feature.writeVarintField(1, f.id || 1)
            feature.writeVarintField(3, 3)
            feature.writePackedVarint(2, [
              0,
              0,
              1,
              1,
              ...(f.hidden ? [2, 2] : []),
            ])
            let x = 0,
              y = 0
            const commands = []
            for (const ring of f.rings) {
              commands.push(9)
              const delta = (a, b) => {
                const dx = a - x,
                  dy = b - y
                commands.push((dx << 1) ^ (dx >> 31), (dy << 1) ^ (dy >> 31))
                x = a
                y = b
              }
              delta(...ring[0])
              commands.push(((ring.length - 1) << 3) | 2)
              for (const point of ring.slice(1)) delta(...point)
              commands.push(15)
            }
            feature.writePackedVarint(4, commands)
          },
          f,
        )
      for (const key of ["render_height", "render_min_height", "hide_3d"])
        layer.writeStringField(3, key)
      layer.writeMessage(4, (_, v) => v.writeDoubleField(3, 20), null)
      layer.writeMessage(4, (_, v) => v.writeDoubleField(3, 5), null)
      layer.writeMessage(4, (_, v) => v.writeBooleanField(7, true), null)
    },
    null,
  )
  return p.finish().buffer
}
async function decode(buffer) {
  const { buildTile } = await import(
    require("node:url").pathToFileURL(
      path.join(source, "building-geometry.mjs"),
    ).href
  )
  return buildTile(buffer, 14, 4824, 6157)
}
test("worker extrudes real heights, preserves courtyards, and omits hidden outlines", async () => {
  const ring = [
      [500, 500],
      [3500, 500],
      [3500, 3500],
      [500, 3500],
    ],
    hole = [
      [1500, 1500],
      [1500, 2500],
      [2500, 2500],
      [2500, 1500],
    ]
  const result = await decode(
    await fixture([
      { rings: [ring, hole] },
      { id: 2, rings: [ring], hidden: true },
    ]),
  )
  assert.equal(result.count, 1)
  let min = Infinity,
    max = -Infinity,
    roofArea = 0
  for (let i = 0; i < result.position.length; i += 3) {
    const h =
      Math.hypot(...result.origin.map((v, j) => v + result.position[i + j])) -
      6378137
    min = Math.min(min, h)
    max = Math.max(max, h)
    assert.ok(Number.isFinite(h))
    const n = Math.hypot(...result.normal.slice(i, i + 3))
    assert.ok(Math.abs(n - 1) < 1e-5)
  }
  assert.ok(Math.abs(min - 5) < 0.05, `min height ${min}`)
  assert.ok(Math.abs(max - 20) < 0.05, `roof height ${max}`)
  for (let v = 0; v < result.position.length / 3; v += 3) {
    if (result.uv[v * 2 + 1] >= 0) continue
    const a = Array.from(result.tileUv.slice(v * 2, v * 2 + 2)),
      b = Array.from(result.tileUv.slice((v + 1) * 2, (v + 1) * 2 + 2)),
      c = Array.from(result.tileUv.slice((v + 2) * 2, (v + 2) * 2 + 2))
    roofArea +=
      Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1])) /
      2
  }
  assert.ok(
    Math.abs(roofArea - (3000 ** 2 - 1000 ** 2) / 4096 ** 2) < 1e-6,
    "courtyard has no roof",
  )
})
test("building tile selection wraps longitude and clamps Mercator poles", () => {
  const a = coords(40.75, -73.98),
    b = coords(40.75, 286.02)
  assert.ok(Math.abs(a[0] - b[0]) < 1e-8)
  assert.ok(a[0] >= 0 && a[0] < 16384)
  for (const lat of [-90, 90]) {
    const [x, y] = coords(lat, 180)
    assert.ok(Number.isFinite(x) && Number.isFinite(y))
    assert.ok(y >= 0 && y < 16384)
  }
})
