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
  assert.ok(
    height >
      require("./lib/earth-source.cjs").load("atmosphere-lut.json").height,
  )
  const ground = pixel(width - 1, 0),
    space = pixel(
      width - 1,
      require("./lib/earth-source.cjs").load("atmosphere-lut.json").height - 1,
    )
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

test("indexed elevations use the finest local mesh and invalidate affected building regions", () => {
  const { createElevation } = require("./lib/earth-source.cjs").load(
    "elevation.js",
  )
  const e = createElevation(THREE, {})
  function tile(level, column, row, height) {
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(
        Array.from({ length: 4 }, () => [height, 0, 0]).flat(),
        3,
      ),
    )
    return {
      tileKey: { level, column, row },
      objects: [new THREE.Mesh(geometry)],
      center: new THREE.Vector3(R, 0, 0),
      boundingBox: { getRotationMatrix: () => new THREE.Matrix4() },
    }
  }
  const sample = (longitude, latitude = 30) =>
    e.terrainHeight({ latitude, longitude })
  const rev = (x, y) => e.terrainHeight.revisionForTile(x, y, 4)
  const update = (...tiles) =>
    e.update({ renderedTiles: new Map(tiles.map((t, i) => [i, t])) })
  const coarse = tile(0, 0, 0, 10),
    local = tile(2, 0, 1, 75),
    far = tile(2, 2, 2, 120)
  update(coarse)
  const first = rev(1, 6),
    distant = rev(10, 10),
    adjacent = rev(4, 6),
    wrapped = rev(15, 6)
  assert.equal(sample(-140), 10)
  update(local)
  assert.equal(sample(-140), 75)
  assert.equal(sample(80), 10)
  assert.equal(sample(220), 75)
  for (const [a, b] of [
    [rev(1, 6), first],
    [rev(4, 6), adjacent],
    [rev(15, 6), wrapped],
  ])
    assert.notEqual(a, b)
  assert.equal(rev(10, 10), distant)
  const next = rev(1, 6)
  update(local, far)
  assert.equal(rev(1, 6), next)
  assert.notEqual(rev(10, 10), distant)
  local.objects[0].geometry.attributes.position.needsUpdate = true
  update(local)
  assert.notEqual(rev(1, 6), next)
  // A historical finer tile must not lift foundations above the mesh currently drawn.
  update(coarse)
  assert.equal(sample(-140), 10)
  update(local)
  assert.equal(sample(-140), 75)
  const beforeDisposal = rev(1, 6)
  local.disposed = true
  update(far)
  assert.equal(sample(-140), 10)
  assert.notEqual(rev(1, 6), beforeDisposal)
  e.elevationProvider.clearCache()
  assert.equal(sample(-140), 0)
  assert.equal(sample(Infinity), 0)
})

test("camera restores its requested offshore altitude after a coarse collision estimate refines", () => {
  const { createElevation } = require("./lib/earth-source.cjs").load(
    "elevation.js",
  )
  const camera = new THREE.PerspectiveCamera()
  camera.position.set(R + 151, 0, 0)
  const e = createElevation(THREE, {
    camera,
    projection: { unprojectPoint: () => ({ latitude: 20, longitude: 20 }) },
    update() {},
  })
  const update = altitude => {
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(
        Array.from({ length: 4 }, () => [altitude, 0, 0]).flat(),
        3,
      ),
    )
    const tile = {
      tileKey: { level: 0, column: 0, row: 0 },
      center: new THREE.Vector3(R, 0, 0),
      boundingBox: { getRotationMatrix: () => new THREE.Matrix4() },
      objects: [new THREE.Mesh(geometry)],
    }
    e.update({ renderedTiles: new Map([[0, tile]]) })
  }
  update(430)
  e.protectCamera(0)
  assert.equal(camera.position.x - R, 470)
  update(0)
  for (let t = 20; t <= 2000; t += 20) e.protectCamera(t)
  assert.equal(camera.position.x - R, 151)
  update(430)
  e.protectCamera(2010)
  camera.position.setLength(R + 560)
  update(0)
  e.protectCamera(2020)
  assert.equal(camera.position.x - R, 560)
})

test("solar and lunar position and apparent diameter agree with JPL Horizons", () => {
  const { ephemeris, solarUtc, referenceLongitude } =
    require("./lib/earth-source.cjs").load("ephemeris.js")
  // JPL observer center 500@399, apparent RA/Dec of date (deg) and diameter (arcsec).
  const samples = [
    [
      "2024-04-08T18:00Z",
      17.89266,
      7.58702,
      1915.582,
      17.57721,
      7.81487,
      1992.135,
    ],
    [
      "2025-06-21T12:00Z",
      90.40296,
      23.43783,
      1887.82,
      32.6021,
      16.85652,
      1963.569,
    ],
    [
      "2026-11-19T12:00Z",
      234.88056,
      -19.52448,
      1941.141,
      350.21828,
      -1.8809,
      1851.99,
    ],
    [
      "2027-12-21T00:00Z",
      268.76513,
      -23.43222,
      1949.997,
      184.37292,
      -6.9925,
      1909.453,
    ],
  ]
  const degrees = 180 / Math.PI
  for (const [date, sra, sdec, sdia, mra, mdec, mdia] of samples) {
    const { sun, moon } = ephemeris(Date.parse(date))
    const ra = b => (b.ra * degrees + 360) % 360
    assert.ok(Math.hypot(ra(sun) - sra, sun.dec * degrees - sdec) < 0.01)
    assert.ok(Math.hypot(ra(moon) - mra, moon.dec * degrees - mdec) < 0.05)
    assert.ok(Math.abs(7200 * degrees * sun.radius - sdia) < 2)
    assert.ok(
      Math.abs(7200 * degrees * Math.asin(1737.4 / moon.distance) - mdia) < 4,
    )
    const midnight = Date.parse(date.slice(0, 10))
    const f = ephemeris(solarUtc(midnight, 12))
    const subsolarLongitude =
      (((f.sun.ra - f.sidereal) * degrees + 540) % 360) - 180
    assert.ok(
      Math.abs(subsolarLongitude - referenceLongitude) < 0.03,
      "apparent noon at slider reference",
    )
  }
})

test("water highlights respond to the solar disk clearing a local ridge", () => {
  const { diskVisibility } = require("./lib/earth-source.cjs").load(
    "water-horizon.js",
  )
  const light = new THREE.Vector3(0.04, 1, 0).normalize()
  assert.equal(
    diskVisibility(0.5, 0.5, 400, light, () => 400),
    1,
  )
  assert.equal(
    diskVisibility(0.5, 0.5, 400, light, () => 650),
    0,
  )
  assert.equal(
    diskVisibility(0.5, 0.5, 400, new THREE.Vector3(-1, 0, 0), () => 400),
    0,
  )
})

test("water ripples grow downwind of a surveyed shoreline", () => {
  const { SIDE, fillFetch } = require("./lib/earth-source.cjs").load(
    "water-fetch.js",
  )
  const mask = new Uint8Array(SIDE * SIDE)
  for (let y = 0; y < SIDE; y++) mask.fill(255, y * SIDE + 8, (y + 1) * SIDE)
  const surveyed = Array(16).fill(true)
  const out = new Uint8Array(mask.length)
  fillFetch(mask, SIDE, surveyed, 10, out)
  const row = SIDE * 8
  assert.equal(out[row + 7], 0)
  assert.ok(out[row + 8] > 0 && out[row + 8] < out[row + 40])
  assert.ok(out[row + 40] < out[row + 110])
  fillFetch(mask, SIDE, Array(16).fill(false), 10, out)
  assert.ok(out.every(value => value === 255))
})
