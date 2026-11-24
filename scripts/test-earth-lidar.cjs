const test = require("node:test"),
  assert = require("node:assert/strict")
const { load } = require("./lib/earth-source.cjs")
const { coordinates, tileFrame, surveyAt, createRaster, possibleNodes } =
  load("lidar-grid.js")
const { observedRoof } = load("lidar-buildings.js")
const { pack } = load("building-coordinates.js")

test("airborne coverage preserves footprint holes and tries the next survey", () => {
  const outside = [0, 0, 20, 0, 20, 20, 0, 20],
    hole = [6, 6, 6, 14, 14, 14, 14, 6]
  const rows = [
    ["new", 0, 0, [[outside, hole]]],
    ["older", 0, 0, [[outside]]],
  ]
  assert.equal(surveyAt(rows, 2, 10), "new")
  assert.equal(surveyAt(rows, 10, 10), "older")
  assert.equal(surveyAt(rows, 50, 10), undefined)
})

test("airborne cells share boundaries and face upwards on a measured slope", () => {
  const [mx, my] = coordinates(34.405, -119.844),
    z = 17,
    n = 2 ** z,
    x = Math.floor(mx * n),
    y = Math.floor(my * n)
  const f = tileFrame(x, y, z),
    east = tileFrame(x + 1, y, z)
  assert.ok(Math.abs(f.west + f.span - east.west) < 1e-7)
  const cells = 16,
    r = createRaster(cells)
  for (let j = 0; j <= cells; j++)
    for (let i = 0; i <= cells; i++) {
      if (i > 5 && i < 11 && j > 5 && j < 11) continue
      const h = 20 + ((f.metres * i) / cells) * 0.2
      r.add(i / cells, j / cells, h)
      r.add(i / cells, j / cells, h)
    }
  r.add(0, 0, 80)
  const mesh = r.mesh(f.metres),
    raw = r.observations(),
    center = 8 * 17 + 8
  assert.equal(mesh.index.includes(center), false)
  assert.ok(mesh.normal[2] > 31000)
  assert.ok(mesh.normal[0] < -6000)
  assert.equal(raw[0], 20)
  assert.ok(Number.isNaN(raw[center]))
  assert.equal(mesh.pos[2], 20)
  assert.ok(mesh.coverage > 0.8 && mesh.coverage < 1)
  const b = [
    f.west - 2000,
    f.north - 2000,
    -2000,
    f.west + 2000,
    f.north + 2000,
    2000,
  ]
  const nodes = possibleNodes({ bounds: b, span: 64 }, f, 22, 1.4)
  assert.ok(nodes.length > 0 && nodes.length < 500)
  assert.equal(new Set(nodes.map(v => v.key)).size, nodes.length)
  for (let i = 1; i < nodes.length; i++) assert.ok(nodes[i].d >= nodes[i - 1].d)
})

test("measured roofs need independent, consistent samples inside nominal flat buildings", () => {
  const xy = pack([0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 0, 0, 0])
  const ys = [-0.5, -0.5, -0.5, -0.5, 0, 0, 6, 6]
  const g = {
    attributes: {
      uv: { getY: i => ys[i] },
      tileUv: { getX: i => xy[2 * i], getY: i => xy[2 * i + 1] },
    },
    index: { array: [0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7] },
  }
  const sample = (u, v) => ({
    id: Math.round(1000 * u) + Math.round(v * 1000) * 2000,
    value: 36,
  })
  assert.equal(observedRoof(g, 0, 8, sample, 13), 17)
  assert.equal(
    observedRoof(g, 0, 8, () => ({ id: 0, value: 36 }), 13),
    undefined,
  )
  assert.equal(
    observedRoof(g, 0, 8, (u, v) => (u < 0.5 ? undefined : sample(u, v)), 13),
    undefined,
  )
  assert.equal(
    observedRoof(
      g,
      0,
      8,
      (u, v) => ({ ...sample(u, v), value: 20 + 30 * u }),
      13,
    ),
    undefined,
  )
  ys[6] = ys[7] = 23
  assert.equal(observedRoof(g, 0, 8, sample, 13, 17), 17)
  ys[0] = -2
  assert.equal(observedRoof(g, 0, 8, sample, 13), undefined)
})

test("ground decimation bounds reconstruction error and keeps gaps open", () => {
  const div = 32,
    r = createRaster(div),
    height = (x, y) => 0.19 * x + 0.07 * y + (x >= 22 ? 4 : 0)
  for (let y = 0; y <= div; y++)
    for (let x = 0; x <= div; x++) {
      if (x >= 8 && x <= 16 && y >= 8 && y <= 16) continue
      const h = height(x, y)
      r.add(x / div, y / div, h)
      r.add(x / div, y / div, h)
    }
  const full = r.mesh(32),
    small = r.mesh(32, 0.22)
  assert.ok(small.index.length < 0.8 * full.index.length)
  assert.ok(small.pos.length < full.pos.length)
  function zAt(mesh, x, y) {
    for (let i = 0; i < mesh.index.length; i += 3) {
      const index = [0, 1, 2].map(j => 3 * mesh.index[i + j]),
        [a, b, c] = index,
        pts = mesh.pos
      const x0 = pts[a],
        y0 = pts[a + 1],
        bx = pts[b] - x0,
        by = pts[b + 1] - y0,
        cx = pts[c] - x0,
        cy = pts[c + 1] - y0
      const det = bx * cy - by * cx,
        ub = ((x - x0) * cy - (y - y0) * cx) / det,
        uc = (bx * (y - y0) - by * (x - x0)) / det
      if (ub >= -1e-7 && uc >= -1e-7 && ub + uc <= 1.0000001)
        return (1 - ub - uc) * pts[a + 2] + ub * pts[b + 2] + uc * pts[c + 2]
    }
  }
  for (let j = 0; j <= 32; j += 2)
    for (let i = 0; i <= 32; i += 2) {
      const fullZ = zAt(full, i - 16, 16 - j),
        smallZ = zAt(small, i - 16, 16 - j)
      if (fullZ === undefined) assert.equal(smallZ, undefined)
      else assert.ok(Math.abs(smallZ - fullZ) < 0.221)
    }
})
