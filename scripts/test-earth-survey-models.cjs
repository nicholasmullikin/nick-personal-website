const test = require("node:test")
const assert = require("node:assert/strict")
const THREE = require("three")
const { load } = require("./lib/earth-source.cjs")
const { surveyTransform, sourceAt } = load("survey-region.js")
const { surveyBudget } = load("survey-budget.js")
const { attachRoofTags, splitRoofTags } = load("roof-tags.js")
const { buildRoof, names } = load("roof-shapes.js")

test("the survey frame preserves local geographic position and surveyed altitude", () => {
  const a = 6378137,
    b = 6356752.314245
  function ecef(lat, lon, z) {
    const f = (lat * Math.PI) / 180,
      l = (lon * Math.PI) / 180
    const n = (a * a) / Math.hypot(a * Math.cos(f), b * Math.sin(f))
    return new THREE.Vector3(
      (n + z) * Math.cos(f) * Math.cos(l),
      (n + z) * Math.cos(f) * Math.sin(l),
      ((n * b * b) / (a * a) + z) * Math.sin(f),
    )
  }
  for (const [lat, lon, geoid] of [
    [60.17, 24.95, 0],
    [52.01, 4.36, 43],
    [35.68, 139.76, 36],
  ]) {
    const tr = surveyTransform(THREE, lat, lon, geoid)
    for (const [dy, dx, h] of [
      [0, 0, 0],
      [0, 0, 120],
      [0.009, -0.01, 52],
      [-0.02, 0.025, 0],
    ]) {
      const world = ecef(lat + dy, lon + dx, geoid + h).applyMatrix4(tr)
      const f = ((lat + dy) * Math.PI) / 180,
        l = ((lon + dx) * Math.PI) / 180,
        r = a + h
      assert.ok(
        world.distanceTo(
          new THREE.Vector3(
            r * Math.cos(f) * Math.cos(l),
            r * Math.cos(f) * Math.sin(l),
            r * Math.sin(f),
          ),
        ) < 0.04,
      )
    }
    assert.ok(sourceAt(lat, lon))
  }
  assert.equal(sourceAt(34.4, -119.84), undefined)
})

test("network reservations survive delayed responses and refill at a bounded rate", () => {
  const mib = 1024 ** 2
  let now = 1000
  const b = surveyBudget(true, () => now)
  assert.equal(b.reserve(10 * mib), true)
  assert.equal(b.reserve(3 * mib), false)
  b.pay(13 * mib)
  b.release(10 * mib)
  assert.equal(b.reserve(mib), false)
  now += b.delay(mib) + 1
  assert.equal(b.reserve(mib), true)
  b.release(mib)
  now += 86400000
  assert.equal(b.reserve(13 * mib), false)
})

test("roof profiles conserve triangulated area and share their wall heights", () => {
  const ring = [
    [0, 0],
    [20, 0],
    [20, 14],
    [11, 14],
    [11, 8],
    [0, 8],
  ].map(([x, y]) => ({ x, y }))
  const triangles = [0, 1, 4, 0, 4, 5, 1, 2, 4, 2, 3, 4]
  const area = p =>
    Math.abs(
      (p[1].x - p[0].x) * (p[2].y - p[0].y) -
        (p[1].y - p[0].y) * (p[2].x - p[0].x),
    ) / 2
  for (let shape = 1; shape < names.length; shape++) {
    const r = buildRoof(
      { shape, measured: true, rise: 3 },
      [ring],
      ring,
      triangles,
      12,
      2,
      1,
    )
    assert.ok(
      Math.abs(r.faces.reduce((a, f) => a + area(f), 0) - 214) < 1e-5,
      names[shape],
    )
    const vertices = r.faces.flat()
    for (const p of r.walls.flat())
      assert.ok(
        vertices.some(q => Math.hypot(q.x - p.x, q.y - p.y, q.z - p.z) < 1e-4),
        names[shape],
      )
  }
})

test("skillion roofs slope down along a recorded compass bearing", () => {
  const ring = [
    [0, 0],
    [10, 0],
    [10, 20],
    [0, 20],
  ].map(([x, y]) => ({ x, y }))
  for (const bearing of [0, 90, 180, 270]) {
    const r = buildRoof(
      { shape: 5, bearing, rise: 4, measured: true },
      [ring],
      ring,
      [0, 1, 2, 0, 2, 3],
      18,
      0,
      1,
    )
    const first = r.walls[0]
    const downslope = p =>
      Math.sin((bearing * Math.PI) / 180) * p.x -
      Math.cos((bearing * Math.PI) / 180) * p.y
    const low = first.reduce((a, b) => (b.z < a.z ? b : a)),
      high = first.reduce((a, b) => (b.z > a.z ? b : a))
    assert.ok(downslope(low) > downslope(high))
    assert.equal(high.z - low.z, 4)
  }
})

test("mapped architecture needs a matching polygon, including when vector IDs are merged", () => {
  const bytes = [69, 82, 70, 52]
  for (const shape of [1, 2]) {
    bytes.push(1, shape | 32 | 64, 30, 1 | 8 | 16, 0, 248, 224, 7, 7)
    for (const n of [50, 20, 80, 70]) bytes.push(n, 0)
  }
  const pbf = Uint8Array.of(1, 2, 3).buffer
  const packed = attachRoofTags(pbf, Uint8Array.from(bytes).buffer)
  const { tile, tags } = splitRoofTags(packed)
  assert.deepEqual(Array.from(tile), [1, 2, 3])
  const known = tags.match(2, 0, 0, 4096, 50, 20, 80, 70)
  assert.equal(known.shape, 2)
  assert.equal(known.wallClass, 7)
  assert.deepEqual(known.color, [255, 0, 0])
  assert.deepEqual(known.wallColor, [0, 255, 0])
  assert.equal(tags.match(999, 0, 0, 4096, 50, 20, 80, 70), undefined)
  assert.equal(tags.match(2, 0, 0, 4096, 54, 20, 80, 70), undefined)
  assert.equal(attachRoofTags(pbf, undefined), pbf)
})

test("surveys are selected inside the originating country or a published Japanese city", () => {
  for (const [lat, lon, id] of [
    [47.37, 8.54, "swiss"],
    [49.61, 6.13, "luxembourg"],
    [49.935, 6.203, "luxembourg"],
    [35.68, 139.767, "plateau"],
    [52.01, 4.36, "3dbag"],
  ])
    assert.equal(sourceAt(lat, lon)?.id, id)
  for (const [lat, lon] of [
    [45.9, 6.13],
    [49.5, 5.71],
    [40, 135],
    [51.2, 6.7],
  ])
    assert.equal(sourceAt(lat, lon), undefined)
})

test("static legacy GLBs retain their binary bytes, node transform and RTC origin", () => {
  const { upgradePhotoGlb } = load("survey-legacy.js")
  const rtc = { center: [125, 480, 130] },
    translate = [2, 4, 5]
  const old = {
    buffers: { b: { byteLength: 12 } },
    bufferViews: { v: { buffer: "b", byteLength: 12 } },
    accessors: {
      a: {
        bufferView: "v",
        byteStride: 12,
        type: "VEC3",
        componentType: 5126,
        count: 1,
      },
    },
    materials: { m: { values: { diffuse: [0.2, 0.4, 0.1, 1] } } },
    meshes: {
      geom: {
        primitives: [
          { material: "m", indices: "a", attributes: { POSITION: "a" } },
        ],
      },
    },
    nodes: { n: { meshes: ["geom"], translation: translate } },
    scenes: { world: { nodes: ["n"] } },
    scene: "world",
    extensions: { CESIUM_RTC: rtc },
  }
  const j = Buffer.from(JSON.stringify(old)),
    bin = Buffer.from([1, 0, 0, 0, 2, 0, 0, 0, 3, 0, 0, 0]),
    data = Buffer.alloc(20 + j.length + bin.length)
  ;[0x46546c67, 1, data.length, j.length, 0].forEach((v, i) =>
    data.writeUInt32LE(v, i * 4),
  )
  j.copy(data, 20)
  bin.copy(data, 20 + j.length)
  const converted = upgradePhotoGlb(
      data.buffer.slice(data.byteOffset, data.byteOffset + data.length),
    ),
    bytes = Buffer.from(converted),
    len = bytes.readUInt32LE(12),
    g = JSON.parse(bytes.subarray(20, 20 + len))
  assert.equal(bytes.readUInt32LE(4), 2)
  assert.deepEqual(g.extensions.CESIUM_RTC, rtc)
  assert.deepEqual(g.nodes[0].translation, translate)
  assert.deepEqual(g.scenes[0].nodes, [0])
  assert.deepEqual(bytes.subarray(28 + len), bin)
  assert.equal(g.accessors[0].bufferView, 0)
  assert.equal(g.bufferViews[0].byteStride, undefined)
  assert.equal(upgradePhotoGlb(converted), converted)
})

test("photomesh parents reuse resident geometry and yield the stencil to finer surfaces", () => {
  const { photoFallback } = load("survey-fallback.js")
  const camera = new THREE.PerspectiveCamera()
  const tile = (radius, error, photo = true) => {
    const scene = new THREE.Group(),
      mesh = new THREE.Mesh(
        new THREE.BufferGeometry(),
        new THREE.MeshBasicMaterial(),
      )
    scene.add(mesh)
    const sphere = new THREE.Sphere(new THREE.Vector3(6378137, 0, 0), radius)
    return {
      children: [{}],
      geometricError: error,
      cached: {
        scene,
        hasPhoto: photo,
        boundingVolume: {
          distanceToPoint: p => Math.max(0, sphere.distanceToPoint(p)),
          getSphere: v => v.copy(sphere),
        },
      },
    }
  }
  const regular = tile(250, 5),
    parent = tile(350, 9),
    broad = tile(1100, 40),
    invisible = tile(140, 2, false)
  const held = []
  const tiles = {
    visibleTiles: new Set([regular]),
    group: new THREE.Group(),
    focus: new THREE.Vector3(6378137, 0, 0),
    lruCache: {
      itemList: [regular, parent, broad, invisible],
      markUsed: t => held.push(t),
    },
  }
  const fallback = photoFallback(THREE, tiles)
  assert.equal(fallback.update(200, camera), 2)
  assert.deepEqual(held, [parent, broad])
  for (const t of held) {
    const mesh = t.cached.scene.children[0]
    assert.equal(mesh.material.stencilFunc, THREE.NotEqualStencilFunc)
    assert.equal(mesh.material.stencilFuncMask, 64)
  }
  fallback.clear()
  assert.equal(tiles.group.children.length, 0)
  assert.equal(
    parent.cached.scene.children[0].material.stencilFunc,
    THREE.AlwaysStencilFunc,
  )
  assert.equal(parent.cached.scene.children[0].renderOrder, -10)
})
