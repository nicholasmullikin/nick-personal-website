const test = require("node:test"),
  assert = require("node:assert/strict")
const { load } = require("./lib/earth-source.cjs")
const { createQualityController, createProfiler } = load("performance.js")
test("baked transmittance is byte-identical to physical integration", () => {
  const { width, height, data } = load("atmosphere-lut.js").generate()
  const baked = load("atmosphere-lut.json")
  assert.equal(baked.width, width)
  assert.equal(baked.height, height)
  assert.deepEqual(Buffer.from(baked.rgba, "base64"), Buffer.from(data))
})
test("higher scattering orders match the offline integration and fade on the night side", () => {
  const { root } = require("./lib/earth-source.cjs")
  const direct = load("atmosphere-lut.js").generate()
  const table = require(
    require("node:path").join(root, "scripts/multiple-scattering.cjs"),
  ).generate(direct)
  const baked = load("multiple-scattering.json")
  assert.equal(baked.width, table.width)
  assert.equal(baked.height, table.height)
  assert.deepEqual(Buffer.from(baked.rgba, "base64"), Buffer.from(table.data))
  assert.ok(table.data[4 * (table.width - 1)] > table.data[0])
})
test("quality ignores startup, reduces sustained load, recovers slowly and does not oscillate", () => {
  const q = createQualityController()
  let now = 0
  const sample = (cpuMs, gpuMs, ready = true) =>
    q.observe({ now: (now += 200), cpuMs, gpuMs, ready, active: false })
  for (let i = 0; i < 100; i++) sample(100, 100, false)
  for (let i = 0; i < 10; i++) sample(100, 100)
  assert.equal(q.level, 0)
  for (let i = 0; i < 40; i++) sample(1, 18)
  assert.ok(
    q.level > 0,
    "GPU cost can lower quality even when CPU submission is cheap",
  )
  const reduced = q.level
  for (let i = 0; i < 30; i++) sample(1, 1)
  assert.equal(
    q.level,
    reduced,
    "short headroom does not immediately raise resolution",
  )
  for (let i = 0; i < 400; i++) sample(1, 1)
  assert.equal(q.level, 0, "quality recovers after sustained headroom")
  q.suspend()
  for (let i = 0; i < 10; i++) sample(100, undefined)
  assert.equal(q.level, 0, "resume warms up again")
})
test("profiler reads only available queries, rejects disjoint data and releases resources", () => {
  const listeners = new Map(),
    canvas = new EventTarget()
  let available = false,
    disjoint = false,
    reads = 0,
    deleted = 0,
    created = 0
  const ext = {
    TIME_ELAPSED_EXT: 1,
    QUERY_RESULT_AVAILABLE_EXT: 2,
    QUERY_RESULT_EXT: 3,
    GPU_DISJOINT_EXT: 4,
    createQueryEXT: () => ({ id: ++created }),
    beginQueryEXT() {},
    endQueryEXT() {},
    getQueryObjectEXT(_q, type) {
      if (type === 2) return available
      reads++
      return 2000000
    },
    deleteQueryEXT() {
      deleted++
    },
  }
  const gl = {
    getExtension: () => ext,
    isContextLost: () => false,
    getParameter: () => disjoint,
  }
  const original = () => {}
  const renderer = {
    render: original,
    capabilities: { isWebGL2: false },
    getContext: () => gl,
  }
  const map = {
    renderer,
    canvas,
    addEventListener: (k, v) => listeners.set(k, v),
    removeEventListener: k => listeners.delete(k),
  }
  const p = createProfiler(map)
  const frame = () => {
    listeners.get("render")()
    renderer.render({ userData: { earthPass: "cloudVolume" } }, {})
    listeners.get("didrender")()
  }
  for (let i = 0; i < 160; i++) frame()
  assert.equal(reads, 0)
  assert.ok(created <= 24, "unavailable queries cannot grow without bound")
  available = true
  frame()
  assert.ok(p.snapshot().gpu.cloudVolume.mean === 2)
  disjoint = true
  frame()
  assert.deepEqual(p.snapshot().gpu, {})
  p.dispose()
  assert.equal(renderer.render, original)
  assert.equal(listeners.size, 0)
  assert.equal(deleted, created)
})
test("texture budget counts decoded pixels and mip levels rather than transfer bytes", () => {
  const { estimatedBytes } = load("textures.js")
  assert.equal(
    estimatedBytes({
      image: { width: 4096, height: 2048 },
      generateMipmaps: false,
    }),
    32 * 1024 * 1024,
  )
  assert.equal(
    estimatedBytes({
      image: { width: 512, height: 512 },
      generateMipmaps: true,
    }),
    1398100,
  )
  assert.equal(
    estimatedBytes({ image: { width: 1, height: 1 }, generateMipmaps: true }),
    4,
  )
  assert.equal(estimatedBytes({}), 0)
})
test("cloud quality reductions bound both pixels and volume samples", () => {
  const { renderBudget } = load("cloud-model.js")
  const normal = renderBudget(1440, 900, "low", true)
  const reduced = renderBudget(1440, 900, "low", true, {
    pixels: 50000,
    steps: 16,
  })
  assert.ok(reduced.width * reduced.height <= 50000)
  assert.equal(reduced.steps, 16)
  assert.ok(
    reduced.width * reduced.height * reduced.steps <
      normal.width * normal.height * normal.steps * 0.3,
  )
  assert.equal(
    renderBudget(100, 100, "low", false, { pixels: 50000, steps: 16 }).steps,
    16,
  )
})

test("navigation resolution follows distinct GPU samples and restores native on stop", () => {
  const { createNavigationQuality } = require("./lib/earth-source.cjs").load(
    "performance.js",
  )
  const oldDocument = global.document
  global.document = { hidden: false }
  try {
    let ms = 30
    const p = { gpuSample: 0, gpuFrameMs: () => ms },
      m = { pixelRatio: 2, cameraIsMoving: true }
    const q = createNavigationQuality(m, p)
    for (let i = 0; i < 25; i++) q.observe(1000 + i)
    assert.equal(
      m.dynamicPixelRatio,
      undefined,
      "one timing cannot lower quality",
    )
    for (let i = 0; i < 4; i++) {
      p.gpuSample++
      q.observe(2000 + i * 100)
    }
    assert.equal(m.dynamicPixelRatio, 1.6)
    m.pixelRatio = 0.35
    q.observe(2410)
    assert.equal(m.dynamicPixelRatio, 0.35, "a small software surface is never supersampled in motion")
    m.pixelRatio = 2
    m.cameraIsMoving = false
    q.observe(2600)
    assert.equal(m.dynamicPixelRatio, undefined)
    m.cameraIsMoving = true
    ms = 4
    for (let i = 0; i < 15; i++) {
      p.gpuSample++
      q.observe(7000 + i * 100)
    }
    assert.equal(m.dynamicPixelRatio, undefined)
  } finally {
    if (oldDocument === undefined) delete global.document
    else global.document = oldDocument
  }
})

test("navigation without GPU timers keeps a lower resolution only when frame delivery improves", () => {
  const { createFrameCadence } = require("./lib/earth-source.cjs").load("frame-cadence.js")
  const control = createFrameCadence()
  let t = 0, level = 0
  const sample = (count, delta) => {
    for (let i = 0; i < count; i++) level = control.observe((t += delta), delta, level, 3)
  }
  sample(16, 33)
  assert.equal(level, 1)
  sample(20, 33)
  assert.equal(level, 0, "constant refresh or CPU bottleneck restores native resolution")
  sample(150, 33)
  assert.equal(level, 0, "cooldown prevents repeated trials")
  control.reset()
  sample(18, 40)
  assert.equal(level, 1)
  sample(28, 23)
  assert.equal(level, 1, "faster delivery preserves the improvement")
})


test("software raster budgeting keeps unknown and hardware renderers at native resolution", () => {
  const { softwareRasterizer, softwarePixelRatio } = require("./lib/earth-source.cjs").load("device-budgets.js")
  const make = (unmasked, masked = "WebKit WebGL") => ({
    RENDERER: 1,
    getParameter: id => id === 1 ? masked : unmasked,
    getExtension: () => unmasked && ({UNMASKED_RENDERER_WEBGL: 2}),
    isContextLost: () => false,
  })
  assert.equal(softwareRasterizer(make("ANGLE (Google, Vulkan (SwiftShader Device (Subzero)))")), true)
  assert.equal(softwareRasterizer(make(undefined, "llvmpipe, or similar")), true)
  assert.equal(softwareRasterizer(make("ANGLE (Intel, Mesa Intel Graphics)")), false)
  assert.equal(softwareRasterizer(make(undefined)), false)
  assert.equal(softwarePixelRatio(320, 280, 1), 1)
  assert.ok(Math.abs(3840 * 2160 * softwarePixelRatio(3840, 2160, 2) ** 2 - 150000) < 1e-6)
})
