const { test } = require("node:test")
const assert = require("node:assert/strict")
const { sourceRequire, load } = require("./lib/earth-source.cjs")
const THREE = sourceRequire("three")
const { createCoverage, selectPages, selectBase } = load("imagery-coverage")

function plane(z, depth, slope = 0) {
  const positions = []
  for (const y of [17, 0, -17]) {
    for (const x of [-17, 0, 17]) positions.push(x, y, y * slope)
  }
  const position = new THREE.Float32BufferAttribute(positions, 3)
  return {
    tileKey: { level: z, column: 123, row: 456 },
    center: new THREE.Vector3(0, 0, depth),
    objects: [
      {
        isMesh: true,
        material: { userData: { earthTerrain: true } },
        geometry: { attributes: { position } },
      },
    ],
  }
}

test("feedback uses nearest surface and matches projected texels per pixel", () => {
  const sample = createCoverage(THREE)
  const camera = new THREE.PerspectiveCamera(90, 1, 0.5, 1000)
  camera.position.z = 10
  camera.updateMatrixWorld()
  const map = { canvas: { width: 1024, height: 1024 }, camera }
  const front = plane(15, 0),
    back = plane(14, -1)
  for (const order of [
    [front, back],
    [back, front],
  ]) {
    const visible = sample(map, order)
    assert.equal(visible.length, 24 * 24)
    assert.ok(visible.every(s => s.tile === front && s.z === 17))
    assert.ok(visible.every(s => s.u > 0 && s.u < 1 && s.v > 0 && s.v < 1))
  }
  assert.equal(sample(map, [plane(15, 20)]).length, 0)
  const clipped = sample(map, [plane(15, 0, 1)])
  assert.ok(clipped.length > 0)
  assert.ok(clipped.every(s => Number.isFinite(s.z) && s.z <= 20))
})

test("base imagery fits the shared page limit and covers every visible mesh", () => {
  const tiles = []
  for (let x = 0; x < 16; x++) {
    for (let y = 0; y < 16; y++) {
      tiles.push({ tileKey: { level: 15, column: 18000 + x, row: 16000 + y } })
    }
  }
  const close = tiles[0]
  const coverage = new Map(
    tiles.map(t => [t, { samples: t === close ? 100 : 1, demand: 15 }]),
  )
  for (const limit of [1, 4, 16, 38]) {
    const levels = selectBase(tiles, coverage, limit)
    const pages = new Set()
    for (const t of tiles) {
      const level = levels.get(t),
        tk = t.tileKey,
        scale = 2 ** (tk.level - level)
      assert.ok(Number.isInteger(level) && level >= 0 && level <= tk.level)
      pages.add(
        [level, Math.floor(tk.column / scale), Math.floor(tk.row / scale)].join(
          "/",
        ),
      )
    }
    assert.ok(pages.size <= limit)
    if (limit >= 16) assert.equal(levels.get(close), 15)
  }
})

test("fine pages respect independent global and per-draw limits", () => {
  const tiles = [plane(15, 0), plane(15, 0), plane(15, 0)]
  tiles.forEach((t, i) => {
    t.tileKey.column += i
  })
  const samples = tiles.flatMap(t =>
    Array.from({ length: 64 }, (_, i) => ({
      tile: t,
      z: 19,
      u: ((i % 8) + 0.5) / 8,
      v: (Math.floor(i / 8) + 0.5) / 8,
    })),
  )
  const { selected, tiles: coverage } = selectPages(samples, 2, 4)
  assert.equal(selected.size, 4)
  assert.ok([...coverage.values()].every(c => c.pages.length <= 2))
  for (const [t, c] of coverage) {
    for (const page of c.pages) {
      const scale = 2 ** (page.z - t.tileKey.level)
      assert.ok(scale > 1)
      assert.equal(Math.floor(page.x / scale), t.tileKey.column)
      assert.equal(Math.floor(page.y / scale), t.tileKey.row)
    }
  }
  assert.equal(selectPages(samples, 0, 0).selected.size, 0)
})

test("missing coverage falls back within the branch and expires", () => {
  const { firstAvailable } = load("imagery-provider")
  const tile = { z: 18, x: 262143, y: 184141 }
  const parent = { z: 17, x: 131071, y: 92070, key: "17/131071/92070" }
  const missing = new Map([["18/262143/184141", { until: 200 }]])
  assert.deepEqual(firstAvailable(tile, 18, 0, missing, 100), parent)
  assert.equal(firstAvailable(tile, 18, 18, missing, 100), undefined)
  assert.equal(firstAvailable(tile, 18, 0, missing, 201).z, 18)
  assert.equal(firstAvailable(tile, 18, 0, missing, 100, "c:").z, 18)
  assert.equal(
    firstAvailable({ ...tile, x: 262142 }, 18, 0, missing, 100).z,
    18,
  )
})

test("uniform water screening preserves coastal texture and neutral ice", () => {
  const { isUniformWater } = load("imagery-provider")
  assert.equal(
    isUniformWater(new Uint8Array([5, 11, 15, 255, 5, 11, 15, 255])),
    true,
  )
  assert.equal(
    isUniformWater(new Uint8Array([5, 11, 15, 255, 9, 11, 15, 255])),
    false,
  )
  assert.equal(
    isUniformWater(new Uint8Array([110, 110, 110, 255, 110, 110, 110, 255])),
    false,
  )
  assert.equal(
    isUniformWater(new Uint8Array([5, 11, 15, 0, 5, 11, 15, 0])),
    false,
  )
})

test("borrowed roof imagery has correctly oriented ancestor and child transforms", () => {
  const lookup = load("imagery-surface").createSurfaceLookup()
  const entry = (z, x, y) => ({
    z,
    x,
    y,
    key: [z, x, y].join("/"),
    texture: {},
    last: 7,
  })
  const tileKey = { level: 14, column: 401, row: 503 }
  const parent = entry(13, 200, 251),
    child = entry(16, 1605, 2014)
  const cache = new Map([
    [parent.key, parent],
    [child.key, child],
  ])
  const state = {
    from: { entry: parent },
    to: { entry: parent },
    mix: 1,
    details: [{ entry: child, alpha: 0.5 }],
  }
  const get = () => lookup.get(tileKey, [state], [], cache)
  const r = get()
  assert.deepEqual(r.base.uv, [0.5, 0.5, 0.5, 0])
  assert.equal(r.base.texture, parent.texture)
  assert.deepEqual(r.details[0].uv, [4, 4, -1, -1])
  assert.equal(r.details[0].fade, 0.5)
  assert.equal(r.details[0].texture, child.texture)
  assert.equal(parent.last, 7)
  assert.equal(child.last, 7)
  cache.delete(child.key)
  lookup.reset()
  assert.deepEqual(get().details, [])
  cache.delete(parent.key)
  lookup.reset()
  assert.equal(get().base, null)
})

test("camera reprojection measures visible motion in viewport heights per second", () => {
  const { screenVelocity } = load("imagery-motion")
  const camera = new THREE.PerspectiveCamera(90, 1, 0.5, 1000)
  const p = camera.projectionMatrix
  const sample = [{ ndcX: 0, ndcY: 0, depth: 10 }]
  assert.equal(screenVelocity(sample, p, p, 1, 100), 0)
  const moved = p.clone().multiply(new THREE.Matrix4().makeTranslation(1, 0, 0))
  assert.ok(Math.abs(screenVelocity(sample, moved, p, 1, 100) - 0.5) < 1e-6)
  assert.equal(screenVelocity(sample, moved, p, 1, 2000), 0)
})

test("uniform texture reduction preserves even single-pixel features", () => {
  const { uniformColor } = load("imagery-provider")
  const solid = new Uint8Array([8, 19, 36, 255, 8, 19, 36, 255])
  assert.deepEqual(uniformColor(solid), [8, 19, 36, 255])
  solid[5]++
  assert.equal(uniformColor(solid), undefined)
})

test("a camera teleport immediately requests its destination preview during motion", () => {
  const { createPreview } = load("imagery-preview")
  const map = {
    target: { latitude: 36, longitude: -112 },
    targetDistance: 8000,
    canvas: { width: 900, height: 620 },
    camera: { fov: 40 },
    zoomLevel: 12,
    tilt: 45,
  }
  const preview = createPreview(map)
  const update = (now, fast) =>
    preview.update("a", new Map(), new Map(), now, false, true, fast)
  const canyon = update(0, false)
  map.target = { latitude: 40.748, longitude: -73.985 }
  const city = update(16, true)
  assert.ok(city && city.key !== canyon.key)
  assert.equal(
    city.x,
    Math.floor(((map.target.longitude + 180) / 360) * 2 ** city.z),
  )
  map.target.longitude += 0.01
  assert.equal(update(32, true).key, city.key)
})

test("the first-frame earth texture has correctly oriented land, ocean and polar ice", () => {
  const texture = load("surface-preview").createSurfacePreview(THREE)
  const { data, width, height } = texture.image
  assert.deepEqual([width, height], [128, 64])
  assert.equal(texture.flipY, false)
  assert.equal(texture.wrapS, THREE.RepeatWrapping)
  function color(latitude, longitude) {
    const x = Math.floor(((longitude + 180) / 360) * width)
    const y = Math.floor(((latitude + 90) / 180) * height)
    const i = (y * width + x) * 4
    assert.equal(data[i + 3], 255)
    return Array.from(data.slice(i, i + 3))
  }
  const desert = color(24, 12)
  const ocean = color(0, -150)
  assert.ok(desert[0] > desert[2] + 25)
  assert.ok(ocean[2] > ocean[0] + 8)
  assert.ok(color(76, -39).every(channel => channel > 140))
  assert.ok(color(-86, 60).every(channel => channel > 140))
  texture.dispose()
})

test("global surface keeps the medium panorama through fast altitude reversals", t => {
  t.mock.timers.enable({ apis: ["setTimeout"] })
  const { createGlobalSurface } = load("global-surface")
  const requests = []
  const loader = {
    load(url, success, _progress, error) {
      requests.push({ url, success, error })
    },
  }
  const map = { renderer: { capabilities: { getMaxAnisotropy: () => 4 } } }
  const make = token =>
    createGlobalSurface(THREE, loader, map, token, {}, () => {})
  const surface = make("token")
  assert.deepEqual(
    requests.map(r => r.url),
    ["/earth-background/surface-medium.webp"],
  )
  const medium = new THREE.Texture()
  requests[0].success(medium)
  surface.update(4)
  t.mock.timers.tick(200)
  surface.update(12)
  t.mock.timers.tick(2000)
  assert.equal(requests.length, 1)
  surface.update(4)
  t.mock.timers.tick(450)
  const full = new THREE.Texture()
  let releases = 0
  full.addEventListener("dispose", () => releases++)
  assert.equal(requests[1].url, "/earth-background/surface.webp")
  assert.equal(surface.base.texture, medium)
  requests[1].success(full)
  surface.update(13)
  t.mock.timers.tick(19000)
  surface.update(4)
  assert.equal(surface.base.texture, full)
  assert.equal(requests.length, 2)
  surface.update(12)
  t.mock.timers.tick(20000)
  assert.equal(surface.base.texture, medium)
  assert.equal(releases, 1)
  surface.dispose()
  const offline = make("")
  assert.equal(requests[2].url, "/earth-background/surface.webp")
  offline.update(14)
  offline.dispose()
})

test("anisotropic demand sharpens grazing surfaces and is rotation independent", () => {
  const { pixelFootprint } = load("imagery-coverage")
  assert.equal(pixelFootprint(1, 0, 0, 8, 1), 8)
  assert.equal(pixelFootprint(1, 0, 0, 8, 4), 2)
  assert.equal(pixelFootprint(0, 8, -1, 0, 4), 2)
  const q = Math.SQRT1_2
  assert.ok(Math.abs(pixelFootprint(q, 8 * q, -q, 8 * q, 4) - 2) < 1e-12)
  assert.equal(pixelFootprint(2, 0, 0, 2, 4), 2)
  assert.equal(pixelFootprint(0, 0, 0, 0, 4), 0)
})

test("imagery target pages leave headroom for prior views and fades", () => {
  const { pageBudgets } = load("imagery-refinement")
  assert.deepEqual(pageBudgets(96 * 1024 ** 2, 160, 349524, true), {
    baseLimit: 76,
    pageLimit: 24,
  })
  assert.deepEqual(pageBudgets(96 * 1024 ** 2, 36, 349524, true), {
    baseLimit: 19,
    pageLimit: 6,
  })
  assert.deepEqual(pageBudgets(96 * 1024 ** 2, 160), {
    baseLimit: 38,
    pageLimit: 12,
  })
  assert.deepEqual(pageBudgets(48 * 1024 ** 2, 80), {
    baseLimit: 19,
    pageLimit: 6,
  })
  assert.deepEqual(pageBudgets(96 * 1024 ** 2, 36), {
    baseLimit: 19,
    pageLimit: 6,
  })
})

test("a handful of large visible terrain meshes can borrow fine slots within the same cap", () => {
  const { splitPageBudget } = load("imagery-refinement")
  const tiles = Array.from({ length: 20 }, () => ({ tile: {} }))
  const small = { baseLimit: 12, pageLimit: 4 }
  assert.deepEqual(splitPageBudget(small, [...tiles.slice(0, 4), tiles[0]]), {
    baseLimit: 8,
    pageLimit: 8,
  })
  assert.deepEqual(splitPageBudget(small, tiles), small)
  const normal = { baseLimit: 38, pageLimit: 12 }
  assert.equal(splitPageBudget(normal, tiles), normal)
})

test("date-line seam samples the shared edge of the adjacent Mercator world", () => {
  const { neighbourTransform } = load("imagery-surface")
  const east = neighbourTransform(
    { z: 3, x: 7, y: 2 },
    { z: 2, x: 0, y: 1 },
    [0, 1, 0, 0],
  )
  const west = neighbourTransform(
    { z: 3, x: 0, y: 2 },
    { z: 2, x: 3, y: 1 },
    [1, 0, 0, 0],
  )
  assert.equal(east[2] + east[0], 0)
  assert.equal(west[2], 1)
})

test("ocean spectra are deterministic, signed and independent", () => {
  const { makeSlopes, SIZE } = load("ocean-spectrum")
  function generate() {
    const spectrum = makeSlopes()
    let step
    do step = spectrum.next()
    while (!step.done)
    return step.value
  }
  const data = generate()
  assert.equal(data.length, 4 * SIZE * SIZE)
  assert.deepEqual(generate(), data)
  const sums = [0, 0, 0, 0],
    squares = [0, 0, 0, 0]
  let correlation = 0
  for (let i = 0; i < data.length; i += 4) {
    for (let c = 0; c < 4; c++) {
      const value = data[i + c] - 127.5
      sums[c] += value
      squares[c] += value * value
    }
    correlation += (data[i] - 127.5) * (data[i + 2] - 127.5)
  }
  for (let c = 0; c < 4; c++) {
    assert.ok(Math.abs(sums[c]) / (SIZE * SIZE) < 0.3)
    assert.ok(Math.sqrt(squares[c] / (SIZE * SIZE)) > 15)
  }
  assert.ok(Math.abs(correlation / Math.sqrt(squares[0] * squares[2])) < 0.17)
})

test("ocean waves meet across mesh levels and the date line", () => {
  const { waveTransform } = load("ocean-surface")
  for (const band of [-4, -1, 0]) {
    const at = (z, x, y, u, v) => {
      const t = waveTransform(
        { level: z, column: x, row: y },
        band,
        new THREE.Vector3(),
      )
      return [u * t.x + t.y, v * t.x + t.z].map(c => ((c % 1) + 1) % 1)
    }
    const z = 19,
      y = 5432
    assert.deepEqual(at(z, 2 ** z - 1, y, 1, 0.375), at(z, 0, y, 0, 0.375))
    assert.deepEqual(at(z, 42, y, 0.25, 0), at(z, 42, y + 1, 0.25, 1))
    assert.deepEqual(
      at(z, 42, y, 0.75, 0.25),
      at(z + 1, 85, 2 * y + 1, 0.5, 0.5),
    )
  }
})

test("an unverified coast limits wave reflections well before its edge", () => {
  const { certifiedRange } = load("ocean-surface")
  const near = { boundingBox: { distanceToPoint: () => 1700 } },
    far = { boundingBox: { distanceToPoint: () => 10000 } }
  const known = { water: true },
    unknown = { water: false },
    cam = { position: new THREE.Vector3() }
  assert.equal(
    certifiedRange(new Map([[near, known]]), [{ tile: near, depth: 700 }], cam),
    36,
  )
  assert.equal(
    certifiedRange(
      new Map([
        [near, known],
        [far, unknown],
      ]),
      [{ tile: far, depth: 6400 }],
      cam,
    ),
    4,
  )
  assert.equal(
    certifiedRange(
      new Map([
        [near, unknown],
        [far, known],
      ]),
      [{ tile: far, depth: 6400 }],
      cam,
    ),
    0,
  )
})

test("provider deadlines support seconds, HTTP dates and Mapbox epoch resets", () => {
  const { retryDelay } = load("imagery-backoff"),
    wall = Date.UTC(2026, 10, 19, 0)
  const retry = v => new Headers({ "retry-after": v })
  assert.equal(retryDelay(retry("3"), 429, wall), 3000)
  assert.equal(
    retryDelay(retry(new Date(wall + 8000).toUTCString()), 503, wall),
    8000,
  )
  assert.equal(
    retryDelay(
      new Headers({ "x-rate-limit-reset": wall / 1000 + 6 }),
      429,
      wall,
    ),
    6000,
  )
  assert.equal(retryDelay(retry("invalid"), 429, wall), undefined)
  assert.equal(
    retryDelay(retry(new Date(wall - 1000).toUTCString()), 429, wall),
    0,
  )
})

test("one recovery probe resumes its own raster provider", () => {
  const { createBackoff } = load("imagery-backoff")
  let time = 0
  const backoff = createBackoff(
    () => {},
    () => time,
  )
  try {
    const first = { key: "a" },
      probe = { key: "b" }
    assert.equal(backoff.failed(first, { status: 429, retryMs: 3000 }), true)
    assert.equal(backoff.canStart("b"), false)
    assert.equal(backoff.canStart("c:a"), true)
    backoff.success(first)
    assert.equal(backoff.canStart("b"), false)
    time = 3000
    assert.equal(backoff.canStart("b"), true)
    backoff.started(probe)
    assert.equal(backoff.canStart("c"), false)
    backoff.cancel(probe)
    assert.equal(backoff.canStart("c"), true)
    backoff.started(probe)
    assert.equal(backoff.failed(probe, { status: 429 }), true)
    assert.equal(backoff.canStart("b"), false)
    time = 7000
    backoff.started(probe)
    backoff.success(probe)
    assert.equal(backoff.state("a"), undefined)
    assert.equal(backoff.canStart("b"), true)
  } finally {
    backoff.dispose()
  }
})

test("authentication and sustained outages pause the affected source", () => {
  const { createBackoff } = load("imagery-backoff")
  const backoff = createBackoff(
    () => {},
    () => 100,
  )
  try {
    assert.equal(backoff.failed({ key: "c:a" }, { status: 500 }), false)
    assert.equal(backoff.failed({ key: "c:b" }, { status: 502 }), false)
    assert.equal(backoff.failed({ key: "c:c" }, { status: 504 }), true)
    assert.equal(backoff.state("c:x").reason, "unavailable")
    assert.equal(backoff.canStart("a"), true)
    assert.equal(backoff.failed({ key: "a" }, { status: 401 }), true)
    assert.equal(backoff.state("b").reason, "authentication")
    backoff.failed({ key: "x" }, { status: 503, retryMs: 8000 })
    assert.equal(backoff.state("b").reason, "authentication")
  } finally {
    backoff.dispose()
  }
})

test("byte-progress watchdog frees stalled raster and decode slots", async t => {
  const { createTextureLoader, drawRaster } = load("textures")
  t.mock.timers.enable({ apis: ["setTimeout"] })
  let now = 0,
    acceptBitmap,
    hangDecode = false,
    closed = 0,
    loaded
  t.mock.method(performance, "now", () => now)
  const tick = ms => {
    now += ms
    t.mock.timers.tick(ms)
  }
  const microtask = () => new Promise(resolve => setImmediate(resolve))
  const requests = [],
    failures = []
  const oldXHR = globalThis.XMLHttpRequest,
    oldBitmap = globalThis.createImageBitmap
  globalThis.XMLHttpRequest = class {
    constructor() {
      requests.push(this)
    }
    open() {}
    send() {}
    abort() {
      this.onabort?.()
      this.onloadend?.()
    }
    complete() {
      this.response = new Blob(["fixture"])
      this.onload()
      this.onloadend()
    }
  }
  globalThis.createImageBitmap = async () => {
    const image = {
      width: 64,
      height: 32,
      close() {
        closed++
      },
    }
    if (hangDecode)
      await new Promise(resolve => {
        acceptBitmap = resolve
      })
    return image
  }
  t.after(() => {
    if (oldXHR) globalThis.XMLHttpRequest = oldXHR
    else delete globalThis.XMLHttpRequest
    if (oldBitmap) globalThis.createImageBitmap = oldBitmap
    else delete globalThis.createImageBitmap
  })
  const loader = createTextureLoader(THREE)
  t.after(() => loader.dispose())
  const loadTile = () =>
    loader.load(
      "https://example.invalid/tile",
      t => {
        loaded = t
      },
      undefined,
      e => failures.push(e.stalled),
      { bitmap: true, stallMs: 100 },
    )
  loadTile()
  tick(60)
  requests[0].onprogress({ loaded: 40 })
  tick(60)
  requests[0].onprogress({ loaded: 80 })
  tick(60)
  requests[0].complete()
  await microtask()
  assert.deepEqual(failures, [])
  assert.ok(loaded && !loaded.flipY)
  const commands = []
  const ctx = new Proxy(
    {},
    {
      get:
        (_, k) =>
        (...args) =>
          commands.push([k, ...args]),
    },
  )
  drawRaster(ctx, loaded, 8, 6, 16, 12, 2, 3, 64, 48)
  assert.deepEqual(
    commands.map(c => c[0]),
    ["save", "translate", "scale", "drawImage", "restore"],
  )
  assert.deepEqual(commands[1], ["translate", 2, 51])
  assert.deepEqual(commands[3].slice(2), [8, 14, 16, 12, 0, 0, 64, 48])
  loaded.dispose()
  loaded.dispose()
  assert.equal(closed, 1)

  loaded = null
  loadTile()
  tick(50)
  requests[1].onprogress({ loaded: 0 })
  tick(51)
  await microtask()
  assert.deepEqual(failures, ["transfer"])
  assert.equal(loaded, null)

  hangDecode = true
  loadTile()
  requests[2].complete()
  await microtask()
  tick(101)
  assert.deepEqual(failures, ["transfer", "decode"])
  acceptBitmap()
  await microtask()
  assert.equal(loaded, null)
  assert.equal(
    closed,
    2,
    "late decoded image closes after the slot has moved on",
  )
})

test("local panorama recovers after both resolutions initially fail", t => {
  t.mock.timers.enable({ apis: ["setTimeout"] })
  const { createGlobalSurface } = load("global-surface"),
    requests = []
  const loader = {
    load(url, success, _, error, options) {
      requests.push({ url, success, error, options })
    },
  }
  const map = { renderer: { capabilities: { getMaxAnisotropy: () => 4 } } }
  const surface = createGlobalSurface(THREE, loader, map, "token", {}, () => {})
  requests[0].error()
  assert.ok(requests[1].url.endsWith("/surface.webp"))
  requests[1].error()
  assert.equal(surface.base.texture.image.width, 128)
  t.mock.timers.tick(30000)
  assert.equal(requests.length, 3)
  assert.ok(requests[2].url.endsWith("surface-medium.webp"))
  assert.ok(requests[2].options.bitmap)
  const medium = new THREE.Texture()
  requests[2].success(medium)
  assert.equal(surface.base.texture, medium)
  surface.retry()
  assert.equal(requests.length, 3)
  surface.dispose()
})

test("one corrupt image retries in JPEG without degrading other pages", () => {
  const formats = load("imagery-provider").createFormatPolicy()
  const bad = Error("Texture image decoding failed")
  assert.equal(formats.rejected("a", "webp", bad, 100), true)
  assert.equal(formats.format("a", 101), "jpg80")
  assert.equal(formats.format("b", 101), "webp")
  assert.equal(formats.rejected("a", "jpg80", bad, 102), false)
  formats.rejected("b", "webp", bad, 103)
  formats.rejected("c", "webp", bad, 104)
  assert.equal(formats.format("d", 105), "jpg80")
  assert.equal(formats.format("d", 1800200), "webp")
  formats.rejected("d", "webp", { status: 415 }, 1800300)
  assert.equal(formats.format("new", 3000000), "jpg80")
  assert.equal(formats.rejected("c:osm", "webp", bad, 1), false)
})

test("a concentrated visible branch can refine even with siblings along its path", () => {
  const focus = { tileKey: { level: 15, column: 15000, row: 13000 } }
  const tiles = [focus]
  for (let z = 1; z <= 14; z++) {
    const div = 2 ** (15 - z)
    tiles.push({
      tileKey: {
        level: z,
        column: Math.floor(15000 / div) ^ 1,
        row: Math.floor(13000 / div),
      },
    })
  }
  const coverage = new Map([[focus, { samples: 300, demand: 15 }]])
  const base = selectBase(tiles, coverage, 3)
  assert.equal(base.get(focus), 15)
  assert.equal(base.size, tiles.length)
})
test("small skyline slivers leave slots for the foreground mesh", () => {
  const { splitPageBudget } = load("imagery-refinement")
  const foreground = { tile: {} },
    skyline = Array.from({ length: 20 }, () => ({ tile: {} }))
  assert.deepEqual(
    splitPageBudget({ baseLimit: 12, pageLimit: 4 }, [
      ...Array(300).fill(foreground),
      ...skyline,
    ]),
    { baseLimit: 8, pageLimit: 8 },
  )
})

test("panorama resolution follows the globe's projected footprint and drawing buffer", () => {
  const { projectedTier } = load("global-surface")
  const R = 6378137
  const camera = new THREE.PerspectiveCamera(40, 1.6, 1, 1e9)
  const map = { camera, canvas: { width: 1280, height: 800 } }
  camera.position.set(0, 0, R + 28000000)
  camera.lookAt(0, 0, 0)
  camera.updateMatrixWorld()
  assert.equal(projectedTier(map), 2048)
  map.canvas.height = 1980
  map.canvas.width = 1072
  assert.equal(projectedTier(map), 4096)
  map.canvas.height = 390
  map.canvas.width = 800
  assert.equal(projectedTier(map), 1024)
  camera.position.set(0, 0, R + 150000)
  camera.rotation.x = 1.4
  camera.fov = 96
  camera.updateMatrixWorld()
  assert.equal(projectedTier(map), 4096)
})

test("offline panorama swaps tiers both ways without unloading the displayed globe", t => {
  t.mock.timers.enable({ apis: ["setTimeout"] })
  const { createGlobalSurface } = load("global-surface")
  const camera = new THREE.PerspectiveCamera(40, 1.6, 1, 1e9)
  const map = {
    camera,
    canvas: { width: 1280, height: 800 },
    renderer: { capabilities: { getMaxAnisotropy: () => 4 } },
  }
  const requests = []
  const loader = {
    load(url, success) {
      requests.push({ url, success })
    },
  }
  const surface = createGlobalSurface(THREE, loader, map, "", {}, () => {})
  const move = distance => {
    camera.position.set(0, 0, 6378137 + distance)
    camera.lookAt(0, 0, 0)
    camera.updateMatrixWorld()
    surface.update(3)
  }
  move(28000000)
  assert.ok(requests[0].url.endsWith("/surface-2k.webp"))
  const two = new THREE.Texture(),
    four = new THREE.Texture()
  requests[0].success(two)
  move(5000000)
  t.mock.timers.tick(450)
  assert.ok(requests[1].url.endsWith("/surface.webp"))
  assert.equal(surface.base.texture, two)
  requests[1].success(four)
  let released = 0
  four.addEventListener("dispose", () => released++)
  move(28000000)
  t.mock.timers.tick(10000)
  move(5000000)
  t.mock.timers.tick(10000)
  assert.equal(surface.base.texture, four)
  assert.equal(requests.length, 2)
  move(28000000)
  t.mock.timers.tick(20000)
  assert.equal(surface.base.texture, two)
  assert.equal(released, 1)
  surface.dispose()
})

test("local page encoding bounds canceling jobs and releases every caller on failure", async t => {
  const { createCompressedPages } = load("compressed-pages")
  t.mock.timers.enable({ apis: ["setTimeout"] })
  const original = globalThis.Worker,
    sent = []
  let worker,
    stopped = 0,
    returnedBitmaps = 0
  globalThis.Worker = class {
    constructor() {
      worker = this
    }
    postMessage(message) {
      sent.push(message)
    }
    terminate() {
      stopped++
    }
  }
  try {
    const map = {
      renderer: {
        extensions: { has: name => name === "WEBGL_compressed_texture_etc" },
      },
    }
    assert.equal(createCompressedPages(THREE, map, "bc7"), undefined)
    const encoder = createCompressedPages(THREE, map, "auto")
    assert.equal(encoder.codec, "etc2")
    const bytes = { size: 10000 },
      jobs = Array.from({ length: 4 }, () => new AbortController())
    const results = jobs.map(j => encoder.prepare(bytes, j.signal))
    jobs[0].abort()
    assert.equal(await results[0], undefined)
    assert.equal(
      encoder.prepare(bytes, new AbortController().signal),
      undefined,
    )
    assert.ok(sent.some(message => message.cancel && message.id === 1))
    worker.onmessage({
      data: {
        id: 1,
        result: {
          image: {
            close() {
              returnedBitmaps++
            },
          },
        },
      },
    })
    assert.equal(returnedBitmaps, 1)
    const fifth = encoder.prepare(bytes, new AbortController().signal)
    assert.ok(fifth instanceof Promise)
    worker.onerror(new Error("decoder crashed"))
    assert.deepEqual(
      await Promise.all([...results, fifth]),
      Array(5).fill(undefined),
    )
    assert.equal(stopped, 1)
    assert.equal(
      encoder.prepare(bytes, new AbortController().signal),
      undefined,
    )
    const hung = createCompressedPages(THREE, map, "etc2")
    const outstanding = hung.prepare(bytes, new AbortController().signal)
    t.mock.timers.tick(6000)
    assert.equal(await outstanding, undefined)
    assert.equal(stopped, 2)
    const disposed = createCompressedPages(THREE, map, "etc2")
    const abandoned = disposed.prepare(bytes, new AbortController().signal)
    disposed.dispose()
    assert.equal(await abandoned, undefined)
    assert.equal(stopped, 3)
  } finally {
    if (original === undefined) delete globalThis.Worker
    else globalThis.Worker = original
  }
})

test("both checked-in page encoders preserve mip lengths, north-up snapshots and source detail", async () => {
  const { source } = require("./lib/earth-source.cjs")
  const fs = require("node:fs/promises"),
    path = require("node:path")
  const { makeTexture } = load("compressed-pages"),
    { decodeETC2, decodeBC7 } = load("page-snapshot")
  const size = 256,
    pixels = new Uint8Array(size * size * 4)
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4
      pixels[i] = 20 + Math.floor((150 * x) / size)
      pixels[i + 1] = 40 + Math.floor((160 * y) / size)
      pixels[i + 2] = 70 + Math.floor((80 * (x + y)) / (size * 2))
      pixels[i + 3] = 255
    }
  for (const codec of ["bc7", "etc2"]) {
    const { instance } = await WebAssembly.instantiate(
      await fs.readFile(
        path.join(source, "resources", "page-" + codec + ".wasm"),
      ),
    )
    const native = instance.exports,
      input = native.__heap_base.value,
      output = input + pixels.byteLength
    const memory = new Uint8Array(native.memory.buffer)
    memory.set(pixels, input)
    const length = native.encode(input, size, size, output, 1)
    const result = {
      width: size,
      height: size,
      bytes: memory.slice(output, output + length),
    }
    const texture = makeTexture(THREE, codec, result)
    assert.equal(texture.mipmaps.length, 9)
    assert.equal(texture.userData.blockBytes, codec === "etc2" ? 43704 : 87408)
    assert.equal(
      makeTexture(THREE, codec, { ...result, bytes: result.bytes.subarray(1) }),
      undefined,
    )
    const decoded = new Uint8ClampedArray(pixels.byteLength)
    ;(codec === "etc2" ? decodeETC2 : decodeBC7)(texture.mipmaps[0], decoded)
    let worst = 0,
      squared = 0
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++)
        for (let c = 0; c < 4; c++) {
          const reference = pixels[((size - y - 1) * size + x) * 4 + c]
          const error = reference - decoded[(y * size + x) * 4 + c]
          squared += error * error
          worst = Math.max(worst, Math.abs(error))
        }
    assert.ok(
      Math.sqrt(squared / (3 * size * size)) < 2 && worst <= 8,
      `${codec}: mip 0 snapshot has error ${worst}`,
    )
    const crop = new Uint8ClampedArray(16 * 12 * 4)
    const decode = codec === "etc2" ? decodeETC2 : decodeBC7
    decode(texture.mipmaps[0], crop, 44, 116, 16, 12)
    for (let y = 0; y < 12; y++) {
      const start = ((116 + y) * size + 44) * 4
      assert.deepEqual(
        crop.subarray(y * 16 * 4, (y + 1) * 16 * 4),
        decoded.subarray(start, start + 16 * 4),
      )
    }
    assert.ok(
      texture.mipmaps.at(-1).data.byteLength === (codec === "etc2" ? 8 : 16),
    )
    texture.dispose()
  }
})

test("unused arrivals wait for the outgoing pinned pages before decoding again", () => {
  const { createReadmission, coversPreviousSample } = load("imagery-admission")
  const admission = createReadmission(200, 2, 380)
  const pages = new Map([["a", { bytes: 120 }], ["b", { bytes: 80 }]])
  admission.evicted({ key: "c", bytes: 100, readyAt: 20 }, 30, 4)
  admission.updatePinned(pages, new Set(["a", "b", "mosaic"]))
  assert.equal(admission.blockedUntil("c", 200, 4), 410)
  assert.equal(admission.blockedUntil("c", 411, 4), Infinity)
  assert.equal(admission.updatePinned(pages, new Set(["b"])), true)
  assert.equal(admission.blockedUntil("c", 412, 4), 0)
  admission.evicted({ key: "c", bytes: 100, readyAt: 500 }, 501, 5)
  admission.updatePinned(pages, new Set(["a", "b"]))
  assert.equal(admission.blockedUntil("c", 1000, 6), 0)
  admission.evicted({ key: "c", bytes: 100, readyAt: 500, drawn: true }, 510, 6)
  assert.equal(admission.blockedUntil("c", 515, 6), 0)
  assert.equal(coversPreviousSample({ z: 2, x: 3, y: 1 }, [{ mx: 0.999, my: 0.25 }]), true)
  assert.equal(coversPreviousSample({ z: 2, x: 0, y: 1 }, [{ mx: 0.999, my: 0.25 }]), false)
})

test("coarsening reserves bounded inherited slots for visible native detail", () => {
  const { carriedPages, selectPages } = load("imagery-coverage")
  const tile = { z: 16, x: 0, y: 0 }
  const page = (z, x, y) => ({ entry: { z, x, y }, alpha: 1 })
  const offscreen = page(20, 15, 15), sharp = page(20, 0, 0), broad = page(18, 1, 0)
  const samples = [
    { mx: 0.4 / 2 ** 20, my: 0.4 / 2 ** 20, z: 20 },
    { mx: 1.4 / 2 ** 18, my: 0.4 / 2 ** 18, z: 19 },
  ]
  const carried = carriedPages([offscreen, broad, sharp], tile, samples, 2, () => 1)
  assert.deepEqual(carried, [sharp, broad])
  const mesh = { tileKey: { level: 16, column: 0, row: 0 } }
  const plan = selectPages([{ tile: mesh, z: 22, u: .1, v: .1 }], 1, 1)
  assert.equal([...plan.selected.values()][0].z, 20)
})

test("reused terrain material releases detail textures when the new cut has no pages", () => {
  const { createRefinement } = load("imagery-refinement")
  const capabilities = { maxTextures: 16, getMaxAnisotropy: () => 1 }
  const refinement = createRefinement(THREE, { renderer: { capabilities } }, {}, {}, {}, {}, true)
  const neutral = new THREE.Texture()
  const texture = new THREE.Texture()
  const tile = { z: 12, x: 1, y: 2 }
  const entry = { key: "13/2/4", z: 13, x: 2, y: 4, texture }
  const cache = new Map([[entry.key, entry]])
  const uniforms = refinement.uniforms(neutral)
  const state = {
    tile, material: { uniforms },
    details: [{ entry, alpha: 1, uv: [2, 2, 0, 0] }],
  }
  refinement.bind(state, [entry], "a", cache, new Set(), neutral, 0, true)
  assert.equal(uniforms.detailMap0.value, texture)
  // A new geometry cut can reuse this material after discarding its old plan.
  state.details = []
  refinement.bind(state, [], "a", cache, new Set(), neutral, 300, true)
  assert.equal(uniforms.detailFade0.value, 0)
  assert.equal(uniforms.detailMap0.value, neutral)
})
