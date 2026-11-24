const test = require("node:test")
const assert = require("node:assert/strict")
const { load } = require("./lib/earth-source.cjs")
const { waterMask, SIDE } = load("water-mask.js")
const { expand } = load("mapped-water.js")
const { nearest } = load("street-lights.js")
const { shadowBand } = load("cloud-shadow-cache.js")
const { bounds, sourceTiles, patchInstances } = load("canopy-grid.js")

test("water coverage clips outside edges, preserves islands and skips intermittent water", () => {
  const ring = (x, y, w, h) =>
    [
      [x, y],
      [x + w, y],
      [x + w, y + h],
      [x, y + h],
      [x, y],
    ].map(([x, y]) => ({ x, y }))
  const features = [
    {
      type: 3,
      properties: {},
      loadGeometry: () => [ring(-5, -8, 155, 178), ring(21, 27, 72, 35)],
    },
    {
      type: 3,
      properties: { intermittent: 1 },
      loadGeometry: () => [ring(172, 0, 40, 240)],
    },
    { type: 3, properties: {}, loadGeometry: () => [ring(235, 165, 39, 110)] },
  ]
  const piers = {
    extent: SIDE * 2,
    length: 1,
    feature: () => ({
      type: 3,
      properties: { class: "pier" },
      loadGeometry: () => [ring(6, 20, 30, 12)],
    }),
  }
  const mask = waterMask(
    {
      extent: SIDE,
      length: features.length,
      feature: i => features[i],
    },
    piers,
  )
  const out = new Uint8Array(1024 * 1024)
  expand(mask, out, 256, 512)
  for (let y = 0; y < 256; y++)
    for (let x = 0; x < 256; x++) {
      const expected =
        (x < 150 &&
          y < 170 &&
          !(x >= 3 && x < 18 && y >= 10 && y < 16) &&
          !(x >= 21 && x < 93 && y >= 27 && y < 62)) ||
        (x >= 235 && y >= 165)
      assert.equal(out[(512 + y) * 1024 + 256 + x], expected ? 255 : 0)
    }
  assert.equal(out[511 * 1024 + 256], 0)
})

test("fixture selection wraps at the date line and limits the nearest visible lights", () => {
  const n = 8192,
    y = 4000
  const records = new Map([
    [y * n + n - 1, new Uint16Array([65500, 0, 58000, 0])],
    [y * n, new Uint16Array([14, 0, 8000, 0])],
  ])
  const lamps = nearest(records, 0, y / n, 40075017, 2)
  assert.equal(lamps.length, 2)
  assert.ok(lamps[0].mx < 0.00001 && lamps[1].mx > 0.9999)
  assert.ok(lamps.every(p => p.r2 < 10))
})

test("cached near-ground cloud shadows stop before crossing a cloud shell", () => {
  const lat = 0,
    climate = 1.22,
    h = 1.8 * climate
  assert.deepEqual(shadowBand(8, lat, h, 10), [0, 0])
  assert.ok(shadowBand(8, lat, h - 0.25, 10)[1] < 0.25)
  assert.ok(shadowBand(8, lat, h + 0.25, 10)[0] > -0.25)
  assert.deepEqual(shadowBand(8, lat, 0, 10), [-0.65, 0.65])
})

test("canopy placement is bounded, deterministic and contained within the sampled patch", () => {
  const tile = { x: 10955, y: 26103, z: 16 },
    box = bounds(tile),
    rasters = new Map()
  for (const t of sourceTiles(box))
    rasters.set(t.x + "/" + t.y, { heights: new Uint8Array(65536).fill(16) })
  const first = patchInstances(tile, box, rasters, 20, 0),
    second = patchInstances(tile, box, rasters, 20, 0)
  assert.deepEqual(first, second)
  assert.equal(first.length, 100)
  for (let i = 0; i < first.length; i += 5) {
    assert.ok(
      first[i] >= 0 && first[i] < 1 && first[i + 1] >= 0 && first[i + 1] < 1,
    )
    assert.ok(first[i + 2] > 11 && first[i + 2] < 16 && first[i + 3] < 2)
  }
})

test("lunar surface orientation tracks geocentric JPL Horizons libration", () => {
  const { ephemeris, direction } = load("ephemeris.js"),
    { lunarOrientation } = load("lunar-orientation.js")
  // Horizons body 301, observer 500@399, observer quantity 14, east longitude.
  const refs = [
    ["2024-04-08T18:00Z", 1.951469, -0.437737],
    ["2025-06-21T12:00Z", -2.298946, -4.537606],
    ["2026-11-19T12:00Z", -7.146347, -2.772654],
    ["2027-12-21T00:00Z", 4.933296, 6.039597],
  ]
  for (const [time, lon, lat] of refs) {
    const utc = Date.parse(time),
      e = ephemeris(utc)
    const towardEarth = direction(
      { set: (...v) => v.map(n => -n) },
      e.moon,
      e.sidereal,
    )
    const axes = lunarOrientation(utc, e.sidereal, { set: (...v) => v })
    const [x, y, z] = [0, 3, 6].map(i =>
      towardEarth.reduce((dot, n, k) => dot + n * axes[i + k], 0),
    )
    assert.ok(Math.abs((Math.atan2(y, x) * 180) / Math.PI - lon) < 0.12, time)
    assert.ok(Math.abs((Math.asin(z) * 180) / Math.PI - lat) < 0.12, time)
  }
})

test("streaming one water mask uploads only the changed atlas rectangle", () => {
  const THREE = require("./lib/earth-source.cjs").sourceRequire("three")
  const { mappedWater } = load("mapped-water.js")
  const patches = []
  const map = {
    target: { latitude: 0, longitude: 0 },
    zoomLevel: 15,
    update() {},
    renderer: {
      capabilities: { maxTextures: 16, isWebGL2: true },
      copyTextureToTexture(offset, src, dst) {
        patches.push({
          x: offset.x,
          y: offset.y,
          bytes: src.image.data.slice(),
          dst,
        })
      },
    },
  }
  const water = mappedWater(THREE, map),
    tiles = new Map()
  const entries = [{ dataSource: { name: "buildings" }, renderedTiles: tiles }]
  const tile = x => ({
    tileKey: { column: x, row: 8191 },
    waterMask: new Uint8Array(8192).fill(255),
  })
  try {
    tiles.set(0, tile(8191))
    water.update(entries, "a")
    const before = water.stats.uploadBytes
    tiles.set(1, tile(8192))
    water.update(entries, "a")
    assert.equal(water.stats.uploadBytes - before, 65536)
    assert.equal(patches.length, 1)
    assert.ok(patches[0].bytes.every(n => n === 255))
    tiles.delete(0)
    water.update(entries, "a")
    assert.ok(patches[1].bytes.every(n => n === 0))
    const { x, y, dst } = patches[1]
    assert.equal(dst.image.data[y * 1024 + x], 0)
    assert.equal(dst.image.data[patches[0].y * 1024 + patches[0].x], 255)
    tiles.clear()
    water.update(entries, "a")
    assert.equal(water.stats.active, false)
  } finally {
    water.dispose()
  }
})

test("mapped lights retain the mesh and resample only invalidated terrain", () => {
  const THREE = require("./lib/earth-source.cjs").sourceRequire("three")
  const { streetLightMesh } = load("street-light-mesh.js")
  const anchors = new THREE.Group()
  const map = {
    mapAnchors: anchors,
    projection: {
      projectPoint: (p, v) =>
        v.set(6371000 + p.altitude, p.longitude, p.latitude),
    },
  }
  let count = 0
  const handle = streetLightMesh(
    THREE,
    map,
    { atMercator: () => ++count && 15 },
    8,
    {},
  )
  const center = { latitude: 1, longitude: 2, altitude: 0 }
  const records = [new Uint16Array(4), new Uint16Array(2)]
  const points = [0, 0, 1].map((id, i) => ({
    mx: 0.5 + i / 5000,
    my: 0.5,
    id,
    record: records[id],
    index: i,
  }))
  const versions = new Map([
    [0, 3],
    [1, 2],
  ])
  try {
    handle.update(points, center, versions)
    const mesh = anchors.children[0],
      attr = mesh.geometry.getAttribute("base")
    assert.equal(count, 9)
    handle.update(points, { ...center, longitude: 2.1 }, versions)
    assert.equal(count, 9)
    versions.set(1, 3)
    handle.update(points, center, versions)
    assert.equal(count, 12)
    assert.equal(anchors.children[0], mesh)
    assert.equal(mesh.geometry.getAttribute("base"), attr)
    assert.equal(mesh.geometry.instanceCount, 3)
  } finally {
    handle.dispose()
  }
  assert.equal(anchors.children.length, 0)
})
