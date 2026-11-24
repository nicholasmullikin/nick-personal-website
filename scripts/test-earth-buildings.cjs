const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  path = require("node:path")
const {
  source,
  sourceRequire: requireMap,
  load,
} = require("./lib/earth-source.cjs")
const { coords } = load("buildings.js")
const tileCoordinates = load("building-coordinates.js")
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
              ...(f.colour ? [3, 3] : []),
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
      for (const key of [
        "render_height",
        "render_min_height",
        "hide_3d",
        "colour",
      ])
        layer.writeStringField(3, key)
      layer.writeMessage(4, (_, v) => v.writeDoubleField(3, 20), null)
      layer.writeMessage(4, (_, v) => v.writeDoubleField(3, 5), null)
      layer.writeMessage(4, (_, v) => v.writeBooleanField(7, true), null)
      layer.writeMessage(4, (_, v) => v.writeStringField(1,
        typeof features[0]?.colour === "string" ? features[0].colour : "#3972ab"), null)
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
test("building colors preserve named and abbreviated OSM colors", async () => {
  const ring = [[500, 500], [3500, 500], [3500, 3500], [500, 3500]]
  for (const [colour, expected] of [
    ["lightgrey", [211, 211, 211]], [" WHITE ", [255, 255, 255]],
    ["#3aF", [51, 170, 255]], ["black", [0, 0, 0]],
    ["red", [153, 51, 51]],
  ]) {
    const result = await decode(await fixture([{ rings: [ring], colour }]))
    assert.deepEqual(Array.from(result.chunks[0].color.slice(0, 3)), expected)
  }
  const { parseBuildingColor } = await import(require("node:url").pathToFileURL(
    path.join(source, "building-geometry.mjs"),
  ).href)
  assert.equal(parseBuildingColor("not-a-color"), undefined)
  assert.equal(parseBuildingColor("constructor"), undefined)
})
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
      { rings: [ring, hole], colour: true },
      { id: 2, rings: [ring], hidden: true },
    ]),
  )
  assert.equal(result.count, 1)
  let min = Infinity,
    max = -Infinity,
    roofArea = 0
  for (const chunk of result.chunks) {
    assert.deepEqual(Array.from(chunk.color.slice(0, 3)), [0x39, 0x72, 0xab])
    assert.ok(chunk.index instanceof Uint16Array)
    assert.ok(chunk.position.length / 3 <= 65535)
    for (let i = 0; i < chunk.position.length; i += 3) {
      const h =
        Math.hypot(...result.origin.map((v, j) => v + chunk.position[i + j])) -
        6378137
      min = Math.min(min, h)
      max = Math.max(max, h)
      assert.ok(Number.isFinite(h))
      const n = Math.hypot(...chunk.normal.slice(i, i + 3)) / 32767
      assert.ok(Math.abs(n - 1) < 1e-4)
    }
    for (let k = 0; k < chunk.index.length; k += 3) {
      const [a, b, c] = chunk.index.slice(k, k + 3)
      const vec = (from, to) =>
        [0, 1, 2].map(
          j => chunk.position[to * 3 + j] - chunk.position[from * 3 + j],
        )
      const u = vec(a, b),
        v = vec(a, c)
      const cross = [
        u[1] * v[2] - u[2] * v[1],
        u[2] * v[0] - u[0] * v[2],
        u[0] * v[1] - u[1] * v[0],
      ]
      assert.ok(
        cross.reduce((sum, x, j) => sum + x * chunk.normal[a * 3 + j], 0) > 0,
        "triangle winding matches outward normal",
      )
      if (chunk.uv[a * 2 + 1] >= 0) continue
      assert.equal(
        chunk.uv[a * 2],
        (512 * 3000) / 4096,
        "roof width survives indexing",
      )
      const p = [a, b, c].map(i =>
        Array.from(
          chunk.tileUv.slice(i * 2, i * 2 + 2),
          tileCoordinates.unpack,
        ),
      )
      roofArea +=
        Math.abs(
          (p[1][0] - p[0][0]) * (p[2][1] - p[0][1]) -
            (p[2][0] - p[0][0]) * (p[1][1] - p[0][1]),
        ) / 2
    }
  }
  assert.ok(Math.abs(min - 5) < 0.05, `min height ${min}`)
  assert.ok(Math.abs(max - 20) < 0.05, `roof height ${max}`)
  assert.ok(
    Math.abs(roofArea - (3000 ** 2 - 1000 ** 2) / 4096 ** 2) < 1e-6,
    "courtyard has no roof",
  )
})
test("packed tile coordinates preserve shared boundaries and unusually wide footprints", () => {
  const near = [-0.25, 0, 0.25, 1, 1.25]
  const far = [-2, 0, 1, 3]
  assert.ok(tileCoordinates.pack(near) instanceof Int16Array)
  assert.ok(tileCoordinates.pack(far) instanceof Float32Array)
  for (const values of [near, far])
    assert.deepEqual(
      Array.from(tileCoordinates.pack(values), tileCoordinates.unpack),
      values,
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

test("large building tiles split into WebGL1-compatible indexed chunks", async () => {
  const ring = [
    [500, 500],
    [3500, 500],
    [3500, 3500],
    [500, 3500],
  ]
  const result = await decode(
    await fixture(
      Array.from({ length: 3500 }, (_, id) => ({ id, rings: [ring] })),
    ),
  )
  assert.equal(result.count, 3500)
  assert.ok(result.chunks.length > 1)
  for (const chunk of result.chunks) {
    assert.ok(chunk.index instanceof Uint16Array)
    assert.ok(chunk.position.length / 3 <= 65535)
    for (const index of chunk.index)
      assert.ok(index < chunk.position.length / 3)
  }
})

test("building foundations use one height per footprint and refresh on local elevation changes", () => {
  const THREE = requireMap("three")
  const { createStyle } = load("building-material.js")
  let samples = 0,
    height = 120,
    updates = 0
  const style = createStyle(
    THREE,
    { zoomLevel: 15, update: () => updates++ },
    { uniforms: {} },
    { uniforms: {} },
    () => {
      samples++
      return height
    },
  )
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute(
    "baseUv",
    new THREE.BufferAttribute(
      tileCoordinates.pack([
        0.1, 0.2, 0.1, 0.2, 0.1, 0.2, 0.6, 0.7, 0.6, 0.7, 0.6, 0.7,
      ]),
      2,
    ),
  )
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 10)
  const tile = {
    center: new THREE.Vector3(6378137, 0, 0),
    tileKey: { column: 4824, row: 6157, level: 14 },
    objects: [],
  }
  const material = style.create(tile)
  tile.objects.push({ isMesh: true, geometry })
  // An empty signature is valid when no terrain tiles are rendered.
  style.update(tile, material, "")
  assert.equal(samples, 2)
  assert.ok(Math.abs(geometry.boundingSphere.center.x - 120) < 1e-6)
  style.update(tile, material, "")
  assert.equal(samples, 2)
  height = 300
  style.update(tile, material, 1)
  assert.equal(samples, 4)
  assert.ok(Math.abs(geometry.boundingSphere.center.x - 300) < 1e-6)
  const secondGeometry = new THREE.BufferGeometry()
  secondGeometry.setAttribute(
    "baseUv",
    new THREE.BufferAttribute(tileCoordinates.pack([0.2, 0.3]), 2),
  )
  secondGeometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 5)
  const secondMaterial = style.create(tile)
  const secondMesh = {
    isMesh: true,
    geometry: secondGeometry,
    material: secondMaterial,
  }
  tile.objects.push(secondMesh)
  height = 500
  style.update(tile, secondMaterial, 1, secondMesh)
  assert.ok(Math.abs(secondGeometry.boundingSphere.center.x - 500) < 1e-6)
  assert.ok(Math.abs(geometry.boundingSphere.center.x - 300) < 1e-6)
  assert.ok(updates > 0)
  material.dispose()
  secondMaterial.dispose()
})

test("building aerial interpolation respects GPU and geometry limits", () => {
  const THREE = requireMap("three"), { createStyle } = load("building-material.js")
  const make = (maxVertexTextures, maxVaryings) => {
    const map = { zoomLevel: 15, update() {}, renderer: { capabilities: { maxVertexTextures, maxVaryings } } }
    const style = createStyle(THREE, map, { uniforms: {} }, { uniforms: {} }, () => 0)
    const tile = { center: new THREE.Vector3(6378137, 0, 0), tileKey: { column: 0, row: 0, level: 14 }, objects: [] }
    const material = style.create(tile), geometry = new THREE.BufferGeometry()
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 100)
    const mesh = new THREE.Mesh(geometry, material)
    tile.objects.push(mesh)
    style.update(tile, material, 1, mesh)
    return { mesh, material, geometry }
  }
  for (const caps of [[0, 16], [4, 9]]) {
    const { material } = make(...caps)
    assert.equal(material.defines.EARTH_VERTEX_AERIAL, 0)
    material.dispose()
  }
  const { mesh, material, geometry } = make(4, 10)
  assert.equal(material.defines.EARTH_VERTEX_AERIAL, 1)
  mesh.onBeforeRender()
  assert.equal(material.uniforms.aerialVertexAllowed.value, 1)
  geometry.boundingSphere.radius = 1501
  mesh.onBeforeRender()
  assert.equal(material.uniforms.aerialVertexAllowed.value, 0)
  geometry.boundingSphere = null
  mesh.onBeforeRender()
  assert.equal(material.uniforms.aerialVertexAllowed.value, 0)
  material.dispose()
})

test("building updates use local revisions and sample only their own cache once per second", () => {
  const Module = require("node:module")
  const originalLoad = Module._load
  const buildingPath = path.join(source, "buildings.js")
  const seen = [],
    revisions = [],
    cacheScans = []
  class Source {
    constructor() {
      this.name = "buildings"
      this.enabled = true
      this.stats = {}
    }
  }
  try {
    Module._load = function (request, parent, ...rest) {
      if (
        parent?.filename === buildingPath &&
        request === "./building-material"
      )
        return { createStyle: () => ({ update: (...args) => seen.push(args) }) }
      if (
        parent?.filename === buildingPath &&
        request === "./building-data-source"
      )
        return { BuildingsDataSource: Source }
      return originalLoad.call(this, request, parent, ...rest)
    }
    delete require.cache[buildingPath]
    const { create } = require(buildingPath)
    const map = {
      zoomLevel: 15,
      camera: { position: { length: () => 6378137 + 1000 } },
      update() {},
      addDataSource: () => Promise.resolve(),
      visibleTileSet: {
        forEachCachedTile(visitor, source) {
          cacheScans.push(source)
          visitor({ memoryUsage: 100, isVisible: true })
        },
      },
    }
    const height = () => 0
    height.revisionForTile = (...args) => {
      revisions.push(args)
      return args[0]
    }
    const buildings = create({}, map, {}, {}, height)
    const tile = {
      tileKey: { column: 12, row: 23, level: 14 },
      objects: [
        {
          isMesh: true,
          geometry: { boundingSphere: {} },
          material: {},
          userData: {},
        },
      ],
    }
    const entries = [
      { dataSource: buildings.source, renderedTiles: new Map([[1, tile]]) },
    ]
    for (let i = 0; i < 100; i++) buildings.update(entries, "a")
    assert.equal(cacheScans.length, 1)
    assert.equal(cacheScans[0], buildings.source)
    assert.equal(buildings.stats.cacheBytes, 100)
    assert.equal(buildings.stats.visibleBytes, 100)
    assert.equal(seen.length, 100)
    assert.equal(seen[0][2], 12)
    assert.deepEqual(revisions[0], [12, 23, 14])
  } finally {
    Module._load = originalLoad
    delete require.cache[buildingPath]
  }
})
