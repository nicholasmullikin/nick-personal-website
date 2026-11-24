const test = require("node:test")
const assert = require("node:assert/strict")
const THREE = require("three")
const { create } = require("./lib/earth-source.cjs").load("continuity.js")
const W = 64,
  N = W - 1
function tile(z, x, y, W = 64) {
  const N = W - 1
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
test("adjacent dense and standard terrain share positions and normals", () => {
  const ds = {},
    reconcile = create(THREE, ds)
  for (const [coarse, fine, fraction] of [
    [tile(2, 0, 0), tile(2, 1, 0, 127), 1],
    [tile(2, 0, 0), tile(3, 2, 0, 127), 0.5],
  ]) {
    reconcile([
      {
        dataSource: ds,
        renderedTiles: new Map([
          [0, coarse],
          [1, fine],
        ]),
      },
    ])
    for (let row = 0; row < 127; row++) {
      const u = (row / 126) * fraction * 63,
        i = Math.floor(u)
      for (const field of ["position", "normal"]) {
        const expected = read(coarse, i * 64 + 63, field).lerp(
          read(coarse, Math.min(i + 1, 63) * 64 + 63, field),
          u - i,
        )
        assert.ok(
          expected.distanceTo(read(fine, row * 127, field)) <
            (field === "position" ? 0.0002 : 0.000002),
        )
      }
    }
  }
})

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

test("every desired terrain leaf has exactly one selected ancestor at every positive budget", () => {
  const { selectTerrainTiles } = require("./lib/earth-source.cjs").load(
    "terrain-selection.js",
  )
  const key = code => ({
    level: Math.floor(Math.log2(code) / 2),
    mortonCode: () => code,
    parent: () => key(Math.floor(code / 4)),
  })
  const leaves = [67, 64, 7, 17, 65, 22, 6, 66, 18, 23, 19].map(
    (code, distance) => ({
      tileKey: key(code),
      distance,
      offset: 0,
    }),
  )
  assert.deepEqual(selectTerrainTiles(leaves, 0), [])
  for (let limit = 1; limit <= leaves.length; limit++) {
    const selected = selectTerrainTiles(leaves, limit)
    assert.ok(selected.length <= limit)
    for (const { tileKey } of leaves) {
      const ancestors = new Set()
      for (let k = tileKey; ; k = k.parent()) {
        ancestors.add(k.mortonCode())
        if (k.level === 0) break
      }
      assert.equal(
        selected.filter(e => ancestors.has(e.tileKey.mortonCode())).length,
        1,
      )
    }
  }
})

test("streamed tile exchanges match a fresh stitch and leave distant meshes resident", () => {
  const coordinates = [
    [3, 2, 2],
    [4, 6, 4, 127],
    [4, 6, 5],
    [3, 3, 3],
    [2, 1, 0],
    [4, 7, 5],
    [3, 1, 3],
    [3, 0, 6],
  ]
  const meshes = coordinates.map(args => tile(...args))
  const source = {}
  const update = (fn, tiles) =>
    fn([
      {
        dataSource: source,
        renderedTiles: new Map(tiles.map((t, i) => [i, t])),
      },
    ])
  const reconcile = create(THREE, source)
  const distant = meshes.at(-1).objects[0].geometry
  let versions
  for (const visible of [
    [0, 2, 3, 4, 7],
    [0, 1, 2, 3, 4, 5, 7],
    [3, 1, 5, 4, 7],
    [0, 2, 4, 6, 7],
    [5, 0, 3, 2, 4, 1, 7],
  ]) {
    const current = visible.map(i => meshes[i])
    const fresh = visible.map(i => tile(...coordinates[i]))
    update(reconcile, current)
    update(create(THREE, source), fresh)
    for (let i = 0; i < current.length; i++) {
      for (const attr of ["position", "normal"]) {
        const a = current[i].objects[0].geometry.attributes[attr].array
        const b = fresh[i].objects[0].geometry.attributes[attr].array
        for (let j = 0; j < a.length; j++) {
          assert.ok(
            Math.abs(a[j] - b[j]) < 0.0002,
            `tile ${i} ${attr} component ${j}`,
          )
        }
      }
    }
    const currentVersions = [
      distant.attributes.position.version,
      distant.attributes.normal.version,
    ]
    if (versions) assert.deepEqual(currentVersions, versions)
    versions = currentVersions
  }
})

test("cold terrain requests establish broad coverage before detail and retain a disjoint cover", () => {
  const { planTerrainTiles } = require("./lib/earth-source.cjs").load(
    "terrain-selection.js",
  )
  const key = code => ({
    level: Math.floor(Math.log2(code) / 2),
    mortonCode: () => code,
    parent: () => key(Math.floor(code / 4)),
    changedLevelBy: delta => key(Math.floor(code * 4 ** delta)),
  })
  const start = 4 ** 15
  const desired = Array.from({ length: 80 }, (_, i) => ({
    tileKey: key(start + i),
    offset: 0,
    distance: i,
  }))
  const cache = new Map(),
    state = k => cache.get(k.mortonCode())
  const plan = () => planTerrainTiles(desired, state, [])
  const cold = plan()
  assert.equal(cold.rendered.length, 0)
  assert.equal(cold.requests.length, 2)
  assert.ok(cold.requests.every(e => e.tileKey.level === 12))
  for (const e of cold.requests) cache.set(e.tileKey.mortonCode(), "ready")
  for (let step = 0; step < 20; step++) {
    const current = plan(),
      drawing = new Set(current.rendered.map(e => e.tileKey.mortonCode()))
    for (const leaf of desired) {
      let k = leaf.tileKey,
        count = 0
      for (;;) {
        if (drawing.has(k.mortonCode())) count++
        if (!k.level) break
        k = k.parent()
      }
      assert.equal(
        count,
        1,
        "each visible footprint has precisely one drawn ancestor",
      )
    }
    if (current.complete) {
      assert.equal(current.rendered.length, desired.length)
      return
    }
    const pending = current.requests.filter(e => state(e.tileKey) !== "ready")
    assert.ok(pending.length > 0 && pending.length <= 12)
    for (const e of pending) cache.set(e.tileKey.mortonCode(), "ready")
  }
  assert.fail("all leaves should eventually refine")
})

test("cropped terrain retains the parent's triangulation below the native grid spacing", () => {
  const { cropParentSurface, parentPatchLayout } =
    require("./lib/earth-source.cjs").load("terrain-parent.js")
  const { samplePosition } = require("./lib/earth-source.cjs").load(
    "terrain-sample.js",
  )
  const matrix = new THREE.Matrix4()
  const frame = {
    position: new THREE.Vector3(),
    xAxis: new THREE.Vector3(1, 0, 0),
    yAxis: new THREE.Vector3(0, 1, 0),
    zAxis: new THREE.Vector3(0, 0, 1),
  }
  const width = 9,
    p = new Float32Array(width * width * 3)
  for (let row = 0; row < width; row++)
    for (let col = 0; col < width; col++) {
      const i = 3 * (row * width + col)
      p[i] = col
      p[i + 1] = row
      p[i + 2] = ((col * row + 5 * col + 3 * row) % 7) * 16
    }
  for (const diagonal of [-1, 0, 1]) {
    const parent = {
      level: 3,
      row: 2,
      column: 4,
      width,
      positions: p,
      normals: Int16Array.from(p, (value, i) => Math.round(10000 * Math.sin(i + value))),
      normalScale: 1 / 32767,
      morph: {
        delta: new Int16Array(width * width),
        factor: 0,
        normalDelta: Int8Array.from(p, (_, i) => (i % 43) - 21),
        normalFactor: 1 / 127,
      },
      diagonal,
      matrix: matrix.elements,
    }
    const litParent = {
      ...parent,
      positions: Float32Array.from(parent.normals, (n, j) =>
        n * parent.normalScale + parent.morph.normalFactor * parent.morph.normalDelta[j]),
      morph: undefined,
    }
    for (const gap of [1, 2, 3, 4])
      for (const offset of [
        [0, 1],
        [1, 0],
        [1, 1],
      ]) {
        const scale = 2 ** gap,
          [x, y] = offset
        const child = {
          level: 3 + gap,
          row: parent.row * scale + y,
          column: parent.column * scale + x,
        }
        const layout = parentPatchLayout(parent, child)
        const { positions, normals } = cropParentSurface(
          parent,
          child,
          frame,
          layout.width,
          6378137,
          layout.skirtVertices,
        )
        const n = layout.width - 1
        for (let i = 0; i < n * n * 6; i += 3) {
          const tri = layout.index.subarray(i, i + 3),
            weights = [0.17, 0.31, 0.52]
          const u = weights.reduce(
            (sum, w, j) => sum + (w * (tri[j] % layout.width)) / n,
            0,
          )
          const v = weights.reduce(
            (sum, w, j) => sum + (w * Math.floor(tri[j] / layout.width)) / n,
            0,
          )
          const expected = samplePosition(
            parent,
            (x + u) / scale,
            (y + v) / scale,
            {},
          ).z
          const drawn = weights.reduce(
            (sum, w, j) => sum + w * positions[3 * tri[j] + 2],
            0,
          )
          const picked = samplePosition({ ...layout, positions }, u, v, {}).z
          assert.ok(Math.abs(drawn - expected) < 0.0001)
          assert.ok(Math.abs(picked - drawn) < 0.0001)
          // Evaluate the shader's mixed vertex normals on the original triangle.
          const lighting = samplePosition(litParent, (x + u) / scale, (y + v) / scale, {})
          for (const [axis, field] of ["x", "y", "z"].entries()) {
            const shade = weights.reduce((sum, w, j) => sum + w * normals[3 * tri[j] + axis] / 32767, 0)
            assert.ok(Math.abs(shade - lighting[field]) < 0.00002)
          }
        }
      }
  }
})

test("failed child DEM inherits the ancestor triangle in the child's tangent frame", () => {
  const { cropParentSurface } = require("./lib/earth-source.cjs").load(
    "terrain-parent.js",
  )
  const matrix = new THREE.Matrix4()
    .makeRotationX(0.3)
    .setPosition(6378137, 100, 30)
  const p = new Float32Array([0, 0, 0, 100, 0, 25, 0, 100, 50, 100, 100, 125])
  const frame = {
    position: { x: 6378130, y: 95, z: 29 },
    xAxis: { x: 1, y: 0, z: 0 },
    yAxis: { x: 0, y: 1, z: 0 },
    zAxis: { x: 0, y: 0, z: 1 },
  }
  const parent = {
    positions: p,
    width: 2,
    matrix: matrix.elements,
    level: 4,
    column: 7,
    row: 2,
  }
  for (const dy of [0, 1])
    for (const dx of [0, 1]) {
      const child = { level: 5, column: 14 + dx, row: 4 + dy }
      const { positions } = cropParentSurface(parent, child, frame, 5, 6378137)
      for (let y = 0; y < 5; y++)
        for (let x = 0; x < 5; x++) {
          const u = (dx + x / 4) / 2,
            v = (dy + y / 4) / 2
          const z =
            u + v <= 1
              ? 25 * u + 50 * v
              : 125 * (u + v - 1) + 25 * (1 - v) + 50 * (1 - u)
          const expected = new THREE.Vector3(100 * u, 100 * v, z)
            .applyMatrix4(matrix)
            .sub(frame.position)
          const actual = new THREE.Vector3().fromArray(
            positions,
            3 * (5 * y + x),
          )
          assert.ok(expected.distanceTo(actual) < 0.00001)
        }
    }
})

test("terrain fetch cancellation interrupts retry backoff and HTTP 404 needs no pixel decode", async () => {
  const { fetchTerrain } = require("./lib/earth-source.cjs").load("math.js")
  const oldFetch = global.fetch
  const key = { level: 12, row: 3, column: 4 },
    controller = new AbortController()
  let requests = 0
  try {
    global.fetch = async () => {
      requests++
      return { ok: false, status: 503 }
    }
    const response = fetchTerrain(key, "test", controller.signal)
    await new Promise(resolve => setTimeout(resolve, 10))
    controller.abort()
    await assert.rejects(response, { name: "AbortError" })
    assert.equal(requests, 1)
    global.fetch = async () => ({ ok: false, status: 404 })
    assert.deepEqual(await fetchTerrain(key, "test"), {
      kind: "empty-ocean-dem",
    })
  } finally {
    global.fetch = oldFetch
  }
})

test("camera motion defers new DEM work without reducing resident detail, then resumes after a stop", () => {
  const { createTerrainStream } = require("./lib/earth-source.cjs").load(
    "terrain-stream.js",
  )
  const stream = createTerrainStream()
  const camera = new THREE.PerspectiveCamera(42, 1.5, 1, 1e6)
  const map = {
    camera,
    canvas: { clientHeight: 720 },
    targetDistance: 1000,
    update() {},
  }
  const key = code => ({
    level: Math.floor(Math.log2(code) / 2),
    mortonCode: () => code,
    parent: () => key(Math.floor(code / 4)),
    changedLevelBy: delta => key(Math.floor(code * 4 ** delta)),
  })
  const start = 4 ** 15
  const desired = [0, 1, 2, 3, 256, 257, 258, 259, 260, 261, 262, 263].map(
    i => ({
      tileKey: key(start + i),
      offset: 0,
      distance: i,
      area: 0.3,
    }),
  )
  const ready = new Set([
    start,
    start + 1,
    start + 2,
    start + 3,
    Math.floor((start + 256) / 64),
  ])
  const state = k => (ready.has(k.mortonCode()) ? "ready" : undefined)
  try {
    const before = stream.update(map, desired, state, [], 0)
    camera.position.x = 200
    const moving = stream.update(map, desired, state, [], 16)
    const settled = stream.update(map, desired, state, [], 230)
    const keys = v => v.rendered.map(e => e.tileKey.mortonCode()).sort()
    assert.deepEqual(keys(moving), keys(before))
    assert.ok(moving.rendered.some(t => t.tileKey.level === 15))
    assert.ok(moving.requests.length < before.requests.length)
    assert.deepEqual(keys(settled), keys(before))
    assert.equal(settled.requests.length, before.requests.length)
  } finally {
    stream.dispose()
  }
})

test("a newly visible sibling cannot replace resident fine terrain on a turn", () => {
  const { planTerrainTiles } = require("./lib/earth-source.cjs").load(
    "terrain-selection.js",
  )
  const key = code => ({
    level: Math.floor(Math.log2(code) / 2),
    mortonCode: () => code,
    parent: () => key(Math.floor(code / 4)),
    changedLevelBy: delta => key(Math.floor(code * 4 ** delta)),
  })
  const child = 4 ** 15
  const desired = [child, child + 1, child + 7].map(code => ({
    tileKey: key(code),
    offset: 0,
  }))
  const ancestor = Math.floor(child / 4 ** 4)
  const loaded = new Set([ancestor, child, child + 1])
  const cut = planTerrainTiles(
    desired,
    k => (loaded.has(k.mortonCode()) ? "ready" : undefined),
    [],
  )
  assert.equal(cut.rendered.length, 3)
  assert.deepEqual(
    cut.rendered.filter(e => !e.cropFrom).map(e => e.tileKey.mortonCode()),
    [child, child + 1],
  )
  const crop = cut.rendered.find(e => e.cropFrom)
  assert.equal(crop.cropFrom.mortonCode(), ancestor)
  assert.equal(crop.tileKey.mortonCode(), Math.floor((child + 7) / 4))
  assert.equal(
    cut.rendered.some(e => e.tileKey.mortonCode() === ancestor),
    false,
  )
})

test("compact elevation and terrain picking use the same triangles, including edited boundary vertices", () => {
  const { load } = require("./lib/earth-source.cjs")
  const { makeAdaptiveTerrain } = load("terrain-adaptive.js")
  const { terrainTopology, samplePosition, perimeterIndex } =
    load("terrain-sample.js")
  const imageWidth = 256,
    n = 128,
    heights = Float32Array.from({ length: imageWidth ** 2 }, (_, i) => {
      const x = i % imageWidth,
        y = Math.floor(i / imageWidth)
      return (
        x * 0.15 +
        y * 0.3 +
        10 * Math.exp(-((x - 24) ** 2 + (y - 46) ** 2) / 32)
      )
    })
  const key = { level: 15, column: 5475, row: 13045 }
  const frame = {
    xAxis: { x: 1, y: 0, z: 0 },
    yAxis: { x: 0, y: 1, z: 0 },
    zAxis: { x: 0, y: 0, z: 1 },
    position: { x: 0, y: 0, z: 0 },
  }
  const packed = makeAdaptiveTerrain(
    heights,
    imageWidth,
    imageWidth,
    key,
    n,
    frame,
    6378137,
    1,
  )
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute("uv", new THREE.BufferAttribute(packed.uv, 2))
  geometry.userData.attributeMetadata = {
    position: {
      terrainGridWidth: n + 1,
      terrainEdgeWidth: packed.edgeWidth,
      terrainSurfaceCount: packed.surfaceCount,
    },
  }
  const topology = terrainTopology(geometry)
  assert.equal(terrainTopology(geometry), topology)
  assert.ok(packed.surfaceCount < (n + 1) ** 2 / 2)
  const edgeSegments = packed.edgeWidth - 1
  assert.ok(edgeSegments < n)
  const triCount = (packed.index.length - 48 * edgeSegments) / 3
  const surface = { width: n + 1, positions: packed.positions, topology }
  // Simulate a seam update without rebuilding the compact topology.
  for (let j = 0; j < 4 * edgeSegments; j++) {
    const x = packed.uv[2 * j] * edgeSegments,
      y = (1 - packed.uv[2 * j + 1]) * edgeSegments
    assert.equal(perimeterIndex(x, y, edgeSegments), j)
    packed.positions[j * 3 + 2] += Math.sin(j) * 3
  }
  for (let face = 0; face < triCount; face++) {
    const ids = packed.index.subarray(3 * face, 3 * face + 3)
    const weights = [0.22, 0.63, 0.15]
    const u = ids.reduce((a, k, j) => a + packed.uv[2 * k] * weights[j], 0)
    const v = ids.reduce(
      (a, k, j) => a + (1 - packed.uv[2 * k + 1]) * weights[j],
      0,
    )
    const point = samplePosition(surface, u, v, {})
    for (const [coordinate, name] of ["x", "y", "z"].entries()) {
      const expected = ids.reduce(
        (a, k, j) => a + packed.positions[3 * k + coordinate] * weights[j],
        0,
      )
      assert.ok(Math.abs(expected - point[name]) < 1e-6)
    }
  }
})

test("indexed spatial picking follows visible triangles after a terrain seam moves", () => {
  const { createTerrainPicker } = require("./lib/earth-source.cjs").load(
    "terrain-picking.js",
  )
  const pick = createTerrainPicker(THREE)
  const geometry = new THREE.PlaneGeometry(16, 16, 64, 64)
  const position = geometry.attributes.position
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial())
  mesh.rotation.x = 0.2
  mesh.position.set(4, 12, 90)
  mesh.updateMatrixWorld()
  const record = { mesh, position, matrix: mesh.matrixWorld, tile: {} }
  const probes = [
    [
      [2, -3, 5],
      [-0.3, 0.1, -1],
    ],
    [
      [-6.8, -1, 4],
      [0.1, 0.05, -1],
    ],
    [
      [9, 2, 3],
      [0, 0, -1],
    ],
    [
      [9, 0, 3],
      [-1, 0, 0],
    ],
  ]
  function verify() {
    geometry.computeBoundingBox()
    geometry.computeBoundingSphere()
    for (const [o, d] of probes) {
      const origin = new THREE.Vector3(...o).applyMatrix4(mesh.matrixWorld)
      const direction = new THREE.Vector3(...d).transformDirection(
        mesh.matrixWorld,
      )
      const raycaster = new THREE.Raycaster(origin, direction)
      const expected = raycaster.intersectObject(mesh)[0]?.point
      const result = pick(raycaster.ray, [record])
      assert.equal(!!result, !!expected)
      if (result) assert.ok(expected.distanceTo(result) < 1e-7)
    }
  }
  verify()
  for (let i = 0; i < position.count; i++)
    position.setZ(i, Math.max(0, position.getX(i) - 4))
  position.needsUpdate = true
  verify()
  mesh.material.side = THREE.DoubleSide
  verify()
})

test("seam-only normal repair matches full area-weighted normals, including interior neighbors", () => {
  const { surfaceNormals, boundaryFaces, refreshBoundaryNormals } =
    require("./lib/earth-source.cjs").load("terrain-normals.js")
  const { perimeterIndices } = require("./lib/earth-source.cjs").load(
    "terrain-grid.js",
  )
  const n = 32
  const geometry = new THREE.PlaneGeometry(32, 32, n, n)
  const position = geometry.attributes.position
  for (let i = 0; i < position.count; i++)
    position.setZ(
      i,
      Math.sin(position.getX(i) / 7) * Math.cos(position.getY(i) / 9),
    )
  const index = geometry.index.array,
    edge = perimeterIndices(n + 1)
  const normal = surfaceNormals(
    position.array,
    index,
    position.count,
    index.length,
  )
  const packed = surfaceNormals(
    position.array,
    index,
    position.count,
    index.length,
    new Int16Array(normal.length),
  )
  function compare() {
    geometry.computeVertexNormals()
    const expected = geometry.attributes.normal.array
    for (let i = 0; i < normal.length; i++) {
      assert.ok(Math.abs(normal[i] - expected[i]) < 2e-7)
      assert.ok(Math.abs(packed[i] / 32767 - expected[i]) <= 0.5 / 32767 + 2e-7)
    }
  }
  compare()
  const plan = boundaryFaces(index, position.count, index.length, edge)
  assert.ok(plan.faces.length < index.length / 6)
  for (const bump of [1, 4, -0.3]) {
    for (const i of edge) position.setZ(i, bump * Math.sin(i))
    refreshBoundaryNormals(position.array, index, normal, plan)
    refreshBoundaryNormals(position.array, index, packed, plan)
    compare()
  }
})

test("survey detail waits for its native base and retains it while masked children load", () => {
  const { planTerrainTiles } = require("./lib/earth-source.cjs").load(
    "terrain-selection.js",
  )
  const key = code => ({
    level: Math.floor(Math.log2(code) / 2),
    mortonCode: () => code,
    parent: () => key(Math.floor(code / 4)),
    changedLevelBy: d => key(Math.floor(code * 4 ** d)),
  })
  const desired = [{ tileKey: key(4 ** 17), offset: 0, area: 1 }]
  const cache = new Map([[4 ** 14, "ready"]])
  const plan = () =>
    planTerrainTiles(
      desired,
      k => cache.get(k.mortonCode()),
      [],
      12,
      undefined,
      undefined,
      undefined,
      15,
    )
  assert.equal(plan().requests[0].tileKey.level, 15)
  cache.set(4 ** 15, "ready")
  assert.equal(plan().requests[0].tileKey.level, 17)
  assert.equal(plan().retain[0].tileKey.level, 15)
})

test("survey nodata and feather samples resolve to the displayed worldwide terrain", () => {
  const { blendParentHeights } = require("./lib/earth-source.cjs").load(
    "terrain-blend.js",
  )
  const radius = 6378137
  const parent = {
    kind: "parent-terrain-surface",
    width: 2,
    positions: new Float32Array(12),
    matrix: new THREE.Matrix4().setPosition(radius + 120, 0, 0).elements,
    level: 15,
    column: 42,
    row: 24,
  }
  const heights = new Float32Array([0, 200, 240])
  const img = {
    width: 3,
    height: 1,
    data: new Uint8Array([0, 0, 0, 0, 0, 0, 0, 128, 0, 0, 0, 255]),
  }
  const range = blendParentHeights(
    heights,
    img,
    { level: 17, column: 169, row: 97 },
    parent,
    radius,
  )
  assert.equal(heights[0], 120)
  assert.ok(Math.abs(heights[1] - (120 + (80 * 128) / 255)) < 0.001)
  assert.equal(heights[2], 240)
  assert.deepEqual(range, { minHeight: 120, maxHeight: 240 })
})

test("survey blending increases monotonically with distance and elevation contrast", () => {
  const { surveyWeight } = require("./lib/earth-source.cjs").load(
    "terrain-blend.js",
  )
  for (const distance of [0, 1, 6, 12, 24, 48, 80, 144, 192]) {
    let previous = 0
    for (let delta = 0; delta <= 250; delta++) {
      const weight = surveyWeight(distance, delta, 192)
      assert.ok(weight >= 0 && weight <= 1)
      assert.ok(delta * weight >= previous - 1e-10)
      assert.equal(weight, surveyWeight(distance, -delta, 192))
      if (distance === 0) assert.equal(weight, 0)
      if (distance === 192) assert.equal(weight, 1)
      previous = delta * weight
    }
  }
  for (const delta of [0, 5, 40, 250]) {
    let previous = 0
    for (let distance = 0; distance <= 192; distance++) {
      const weight = surveyWeight(distance, delta, 192)
      assert.ok(weight >= previous)
      previous = weight
    }
  }
})

test("shared cameras validate all coordinates and terrain URLs omit embedded credentials", () => {
  const { terrainPackUrl, cameraPose } = require("./lib/earth-source.cjs").load(
    "share-view.js",
  )
  const page = "https://example.org/blog/earth/"
  assert.equal(
    terrainPackUrl("/survey/manifest.json", page).href,
    "https://example.org/survey/manifest.json",
  )
  for (const value of [
    "javascript:foo",
    "data:,hello",
    "https://x:y@example.org/a",
    "http://example.org/pack",
  ]) {
    assert.equal(terrainPackUrl(value, page), undefined)
  }
  assert.equal(
    terrainPackUrl("/a", "http://localhost:8000/blog/earth/").href,
    "http://localhost:8000/a",
  )
  assert.equal(cameraPose("34,-119,10,250,75,-10").heading, 350)
  for (const value of [
    "",
    "34,-119,10,250,75",
    "34,,10,250,75,10",
    "86,-119,10,250,75,10",
    "34,-119,10,NaN,75,10",
    "34,-119,10,250,90,10",
  ]) {
    assert.equal(cameraPose(value), undefined)
  }
})

test("source cooldown preserves resident close branches alongside regional imagery patches", () => {
  const { regionalFallbackCut } = require("./lib/earth-source.cjs").load(
    "terrain-selection.js",
  )
  const key = code => ({
    level: Math.floor(Math.log2(code) / 2),
    mortonCode: () => code,
    changedLevelBy: offset => key(Math.floor(code * 4 ** offset)),
  })
  const first = 4 ** 15
  const desired = [first, first + 1, first + 16, first + 17].map(n => ({
    tileKey: key(n),
    offset: 0,
  }))
  const ready = k => (k.mortonCode() === first ? "ready" : undefined)
  const cut = regionalFallbackCut(desired, ready, 13)
  assert.deepEqual(
    cut.map(e => e.tileKey.mortonCode()),
    [first, first + 1, first / 16 + 1],
  )
})

test("retreat can prepare a missing native parent without replacing the resident draw cut", () => {
  const { createTerrainStream } = require("./lib/earth-source.cjs").load(
    "terrain-stream.js",
  )
  function key(level, column, row) {
    return {
      level,
      column,
      row,
      mortonCode: () => 4 ** level + row * 2 ** level + column,
      parent: () => key(level - 1, Math.floor(column / 2), Math.floor(row / 2)),
    }
  }
  const camera = new THREE.PerspectiveCamera(45, 1, 1, 1e7)
  camera.position.set(6379137, 0, 0)
  const map = {
    camera,
    canvas: { clientHeight: 720 },
    targetDistance: 900,
    target: { latitude: 0, longitude: 0 },
    update() {},
  }
  const leaf = key(15, 16384, 16384)
  const desired = [{ tileKey: leaf, offset: 0, distance: 0, area: 1 }]
  const previous = [{ tileKey: leaf, hasGeometry: true }]
  const stream = createTerrainStream()
  const state = tile => (tile.level === 15 ? "ready" : undefined)
  const first = stream.update(map, desired, state, previous, 0)
  assert.equal(first.complete, true)
  camera.position.y += 25
  const pan = stream.update(map, desired, state, previous, 50)
  assert.deepEqual(pan.requests, desired)
  map.targetDistance = 1250
  camera.position.x += 300
  const retreat = stream.update(map, desired, state, previous, 100)
  assert.equal(retreat.requests[0].tileKey.level, 14)
  assert.equal(retreat.requests.length, 2)
  assert.deepEqual(retreat.rendered, desired)
  const paused = stream.update(map, desired, state, previous, 115, false)
  assert.deepEqual(paused.requests, desired)
  assert.equal(paused.complete, true)
  stream.dispose()
})

test("intermediate terrain preserves its shared boundary within the surface triangle budget", () => {
  const { makeAdaptiveTerrain } = require("./lib/earth-source.cjs").load(
    "terrain-adaptive.js",
  )
  const size = 256
  const heights = Float32Array.from({ length: size * size }, (_, i) => {
    const x = i % size,
      y = Math.floor(i / size)
    return 1200 * Math.sin(x * 0.61) * Math.cos(y * 0.53) + 90 * Math.sin(x + y)
  })
  const frame = {
    xAxis: { x: 0, y: 1, z: 0 },
    yAxis: { x: 0, y: 0, z: 1 },
    zAxis: { x: 1, y: 0, z: 0 },
    position: { x: 6378137, y: 0, z: 0 },
  }
  for (const level of [8, 11, 13]) {
    const mid = 2 ** (level - 1)
    const mesh = makeAdaptiveTerrain(
      heights,
      size,
      size,
      { level, column: mid, row: mid },
      128,
      frame,
      6378137,
      1,
    )
    const edge = 4 * (mesh.edgeWidth - 1)
    const faces = (mesh.index.length - 12 * edge) / 3
    assert.equal(mesh.edgeWidth, 65)
    assert.ok(
      faces > 4500 && faces <= 5800,
      `z${level} emitted ${faces} triangles`,
    )
    const boundary = new Set()
    for (let i = 0; i < edge; i++)
      boundary.add(mesh.uv[2 * i] + "," + mesh.uv[2 * i + 1])
    for (let i = 0; i <= 64; i++) {
      const t = i / 64
      for (const [u, v] of [
        [0, t],
        [1, t],
        [t, 0],
        [t, 1],
      ])
        assert.ok(boundary.has(u + "," + v))
    }
  }
})

test("regional sunlight follows distant relief, Earth curvature and the date line", () => {
  const { horizonRegion, horizonField, covers, encodeHorizon } =
    require("./lib/earth-source.cjs").load("terrain-horizon.js")
  const angle = (6 * Math.PI) / 180
  // At the equator and longitude zero, +Y is east and +X is up.
  const region = horizonRegion(0, 0, {
    x: Math.sin(angle),
    y: Math.cos(angle),
    z: 0,
  })
  const meters = 2 * Math.PI * 6378137
  const heights = horizonField(region, x => {
    const distance = (x - region.x) * meters
    return distance >= 8600 && distance <= 12200 ? 2400 : 0
  })
  const center = heights[(heights.length - 1) / 2]
  assert.ok(
    center > 1200 && center < 1500,
    "an eastern ridge blocks low sunlight",
  )
  const flat = horizonField(region, () => 0)[0]
  assert.ok(
    Math.abs(flat - (-2300 * Math.tan(angle) - 2300 ** 2 / (2 * 6378137))) <
      0.01,
  )
  const packed = encodeHorizon(new Float32Array([flat, center]))
  const decoded = ((packed[4] * 256 + packed[5]) / 65535) * 12000 - 2000
  assert.ok(Math.abs(decoded - center) < 0.1)
  assert.equal(
    covers({ ...region, x: 0 }, { level: 13, column: 8191, row: 4096 }),
    true,
  )
  assert.equal(horizonRegion(0, 0, { x: 1, y: 0, z: 0 }), undefined)
})

test("adaptive lighting follows the source slope on a rotated globe tile", () => {
  const { makeAdaptiveTerrain } = require("./lib/earth-source.cjs").load("terrain-adaptive.js")
  const key = { level: 14, column: 14229, row: 4563 }
  const radius = 6378137, imageSize = 64, segments = 32
  const localFrame = {
    xAxis: { x: 0, y: 1, z: 0 },
    yAxis: { x: 0, y: 0, z: 1 },
    zAxis: { x: 1, y: 0, z: 0 },
    position: { x: 0, y: 0, z: 0 },
  }
  const growsEast = 0.3, growsSouth = 0.2
  const heights = Float32Array.from({ length: imageSize ** 2 }, (_, i) =>
    (i % imageSize) * growsEast + Math.floor(i / imageSize) * growsSouth)
  const mesh = makeAdaptiveTerrain(heights, imageSize, imageSize, key, segments, localFrame, radius, 3)
  let checked = 0
  for (let i = 0; i < mesh.surfaceCount; i++) {
    const u = mesh.uv[2 * i], v = 1 - mesh.uv[2 * i + 1]
    if (Math.min(u, 1 - u, v, 1 - v) <= 1 / segments) continue
    const lon = (2 * (key.column + u) / 2 ** key.level - 1) * Math.PI
    const lat = Math.atan(Math.sinh(Math.PI * (1 - 2 * (key.row + v) / 2 ** key.level)))
    const meters = 2 * Math.PI * radius * Math.cos(lat) / (2 ** key.level * imageSize)
    const east = -3 * growsEast / meters, north = 3 * growsSouth / meters
    const scale = Math.hypot(1, east, north)
    const horizontal = Math.cos(lat) - north * Math.sin(lat)
    const expected = [
      horizontal * Math.sin(lon) + east * Math.cos(lon),
      Math.sin(lat) + north * Math.cos(lat),
      horizontal * Math.cos(lon) - east * Math.sin(lon),
    ]
    for (let j = 0; j < 3; j++) assert.ok(
      Math.abs(mesh.normals[3 * i + j] / 32767 - expected[j] / scale) < 0.00003,
    )
    checked++
  }
  assert.ok(checked > 15)
})

test("the shared-midpoint error pyramid reproduces MARTINI's full error map for every supported width", () => {
  const { load, sourceRequire } = require("./lib/earth-source.cjs")
  const { updateTerrainErrors } = load("terrain-errors.js")
  const pkg = sourceRequire("@mapbox/martini")
  const Martini = pkg.default ?? pkg
  for (const width of [65, 129, 257]) {
    const engine = new Martini(width)
    const errors = new Float32Array(width * width).fill(Infinity)
    const samples = Float32Array.from({ length: errors.length }, (_, i) =>
      967 * Math.sin(i / 1389) + 11 * Math.sin((i % width) * 97) + ((i * 37) % 17))
    for (const data of [samples, samples.slice().reverse(), new Float32Array(errors.length)]) {
      updateTerrainErrors(data, errors, width)
      assert.deepEqual(errors, engine.createTile(data).errors)
    }
  }
})
