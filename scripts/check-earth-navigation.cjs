// Replay an orbit-to-ground movement. Write snapshots and timing data in the
// supplied directory; EARTH_RECORD_VIDEO=1 also records the actual frames.
// EARTH_TRACE_UPLOADS=1 captures CPU texture submission per frame. Set it to
// gpu to additionally collect sparse GPU upload queries instead of frame queries.
const fs = require("node:fs/promises")
const path = require("node:path")
const assert = require("node:assert/strict")
const { chromium } = require("playwright")
const {
  installProbe,
  browserErrors,
  mapboxToken,
  reportFailure,
} = require("./lib/earth-browser.cjs")

const mountain = [
  // time (s), latitude, longitude, target height (m), distance (m), tilt, heading
  [0, 44, -124, 0, 4800000, 30, 0],
  [5, 49.8, -123, 0, 210000, 35, 330],
  [10, 49.92, -123.03, 1300, 15000, 58, 335],
  [15, 49.95, -123.04, 1650, 1800, 76, 330],
  [19, 49.95, -123.04, 1650, 1800, 76, 330],
  [23, 49.95, -123.04, 1650, 1800, 76, 55],
  [26, 49.95, -123.04, 1650, 1800, 76, 330],
  [30, 49.95, -123.04, 1650, 1800, 76, 330],
  [35, 49.35, -123.1, 0, 190000, 50, 300],
  [40, 46.0, -124, 0, 3200000, 68, 320],
]
// Each path includes a hold on the detail view, then revisits it from another angle.
const routes = {
  mountain,
  coast: [
    [0, 33.8, -121, 0, 900000, 25, 320],
    [6, 34.38, -119.88, 0, 9000, 55, 320],
    [12, 34.406, -119.846, 8, 370, 78, 320.12],
    [18, 34.406, -119.846, 8, 370, 78, 320.12],
    [23, 34.415, -119.852, 12, 440, 72, 130],
    [29, 34.406, -119.846, 8, 370, 78, 320.12],
    [35, 34.406, -119.846, 8, 370, 78, 320.12],
    [40, 34.6, -120.3, 0, 420000, 60, 300],
  ],
  city: [
    [0, 40.3, -74.3, 0, 300000, 30, 10],
    [7, 40.73, -73.99, 0, 12500, 55, 25],
    [14, 40.751, -73.986, 45, 850, 71, 22],
    [20, 40.751, -73.986, 45, 850, 71, 22],
    [26, 40.757, -73.98, 45, 800, 69, 215],
    [31, 40.751, -73.986, 45, 850, 71, 22],
    [36, 40.751, -73.986, 45, 850, 71, 22],
    [40, 40.8, -74.2, 0, 220000, 30, 10],
  ],
  dateline: [
    [0, -17, 177, 0, 1100000, 45, 80],
    [8, -16.85, 179.8, 0, 75000, 65, 80],
    [15, -16.82, -179.96, 0, 8500, 72, 100],
    [20, -16.82, -179.96, 0, 8500, 72, 100],
    [25, -16.8, 179.97, 0, 6500, 66, 250],
    [30, -16.82, -179.96, 0, 8500, 72, 100],
    [35, -16.82, -179.96, 0, 8500, 72, 100],
    [40, -18.3, -178.8, 0, 1100000, 40, 100],
  ],
}
const launches = {
  discrete: [
    "--enable-gpu",
    "--use-angle=vulkan",
    "--enable-features=Vulkan",
    "--use-vulkan=native",
  ],
  integrated: [
    "--ozone-platform=x11",
    "--enable-gpu",
    "--use-angle=gl-egl",
    "--ignore-gpu-blocklist",
  ],
  software: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
}
function summary(values) {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  return {
    count: values.length,
    p50: sorted[sorted.length >> 1],
    p95: sorted[Math.floor(0.95 * sorted.length)],
    over50: sorted.filter(x => x > 50).length,
  }
}
async function main() {
  const out = path.resolve(process.argv[2] || "/tmp/earth-navigation")
  await fs.mkdir(out, { recursive: true })
  const route = process.env.EARTH_FLIGHT_ROUTE || "mountain"
  assert.ok(Object.hasOwn(routes, route), "unknown EARTH_FLIGHT_ROUTE")
  const engine = process.env.EARTH_FLIGHT_GPU || "discrete",
    args = launches[engine]
  assert.ok(args, "invalid EARTH_FLIGHT_GPU")
  const profile = process.env.EARTH_FLIGHT_CACHE
  let b, context
  try {
    const video = process.env.EARTH_RECORD_VIDEO === "1"
    const options = {
      viewport: { width: 960, height: 720 },
      deviceScaleFactor: Number(process.env.EARTH_FLIGHT_DPR || 1),
      ...(video
        ? { recordVideo: { dir: out, size: { width: 960, height: 720 } } }
        : {}),
    }
    if (profile) {
      context = await chromium.launchPersistentContext(path.resolve(profile), {
        ...options,
        args,
      })
    } else {
      b = await chromium.launch({ args })
      context = await b.newContext(options)
    }
    const p = context.pages()[0] || (await context.newPage()),
      cdp = await context.newCDPSession(p),
      errors = browserErrors(p)
    const requests = new Map(),
      net = {}
    await cdp.send("Network.enable")
    if (process.env.EARTH_FLIGHT_NETWORK === "constrained") {
      await cdp.send("Network.emulateNetworkConditions", {
        offline: false,
        latency: 150,
        downloadThroughput: 500000,
        uploadThroughput: 125000,
      })
    }
    cdp.on("Network.requestWillBeSent", e => {
      const url = new URL(e.request.url)
      const group = url.pathname.includes("/mapbox.satellite/")
        ? "imagery"
        : url.pathname.includes("/mapbox.terrain-rgb/")
          ? "elevation"
          : url.host.includes("openfreemap")
            ? "buildings"
            : url.protocol.startsWith("http")
              ? "other"
              : null
      if (!group) return
      requests.set(e.requestId, group)
      net[group] ||= { started: 0, finished: 0, failed: 0, transferred: 0 }
      net[group].started++
    })
    cdp.on("Network.loadingFinished", e => {
      const group = requests.get(e.requestId)
      if (group) {
        net[group].finished++
        net[group].transferred += e.encodedDataLength
        requests.delete(e.requestId)
      }
    })
    cdp.on("Network.loadingFailed", e => {
      const group = requests.get(e.requestId)
      if (group) {
        net[group].failed++
        requests.delete(e.requestId)
      }
    })
    const uploadMode = process.env.EARTH_TRACE_UPLOADS
    if (uploadMode === "1" || uploadMode === "gpu")
      await require("./lib/earth-upload-probe.cjs").installUploadProbe(
        p,
        uploadMode === "gpu",
      )
    await installProbe(p)
    const url = new URL(
      "/harp/rendering_globe-atmosphere.html",
      process.env.EARTH_PREVIEW_URL || "http://127.0.0.1:8014",
    )
    url.searchParams.set("mapbox_token", await mapboxToken())
    await p.goto(url.href, { waitUntil: "domcontentloaded" })
    await p.waitForFunction(() => window.probe?.map.earth)
    const run = await p.evaluate(async views => {
      const m = window.probe.map,
        frames = [],
        trace = []
      const gl = m.renderer.getContext(),
        ext = gl.getExtension("WEBGL_debug_renderer_info")
      const renderer = ext
        ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)
        : gl.getParameter(gl.RENDERER)
      let previous,
        moving = false
      const start = performance.now()
      const draw = () => {
        const now = performance.now()
        if (previous !== undefined)
          frames.push({ ms: now - previous, t: (now - start) / 1000, moving })
        previous = now
      }
      const uploads = window.earthUploadTrace
      const startFrame = () => {
        uploads.frame++
      }
      if (uploads) m.addEventListener("render", startFrame)
      m.addEventListener("didrender", draw)
      const lerp = (a, b, t) => a + (b - a) * t
      let bucket = -1
      await new Promise(resolve => {
        function tick(now) {
          const t = (now - start) / 1000,
            end = views[views.length - 1][0]
          const i = views.findIndex(v => v[0] > t)
          const to = views[i < 0 ? views.length - 1 : i],
            from = views[i < 0 ? views.length - 1 : Math.max(0, i - 1)]
          let f =
            from === to
              ? 1
              : Math.max(0, Math.min(1, (t - from[0]) / (to[0] - from[0])))
          f = f * f * (3 - 2 * f)
          moving = from.some((v, j) => j > 0 && v !== to[j])
          if (moving || previous === undefined)
            m.lookAt({
              target: {
                latitude: lerp(from[1], to[1], f),
                longitude:
                  ((from[2] +
                    f * (((to[2] - from[2] + 540) % 360) - 180) +
                    540) %
                    360) -
                  180,
                altitude: lerp(from[3], to[3], f),
              },
              distance: Math.exp(lerp(Math.log(from[4]), Math.log(to[4]), f)),
              tilt: lerp(from[5], to[5], f),
              heading: from[6] + f * (((to[6] - from[6] + 540) % 360) - 180),
            })
          if (Math.floor(t) !== bucket) {
            bucket = Math.floor(t)
            const terrain = m.visibleTileSet.dataSourceTileList.find(
              e => e.dataSource.name === "terrain",
            )
            trace.push({
              t,
              sceneScale:
                m.dynamicPixelRatio === undefined
                  ? 1
                  : m.dynamicPixelRatio / m.pixelRatio,
              terrain: terrain?.renderedTiles.size ?? 0,
              imagery: { ...m.earth.stats },
            })
          }
          if (t >= end) resolve()
          else requestAnimationFrame(tick)
        }
        requestAnimationFrame(tick)
      })
      m.removeEventListener("didrender", draw)
      if (uploads) m.removeEventListener("render", startFrame)
      return {
        renderer,
        frames,
        trace,
        ...(uploads ? { uploads } : {}),
        profile: m.earth.performance.snapshot(),
      }
    }, routes[route])
    await p.screenshot({ path: path.join(out, "orbit.jpg") })
    const frames = summary(run.frames.filter(f => f.moving).map(f => f.ms))
    const result = {
      engine,
      route,
      movingIntervalsMs: frames,
      network: net,
      errors,
      ...run,
    }
    if (run.uploads)
      result.uploadSummary =
        require("./lib/earth-upload-probe.cjs").summarizeUploads(run.uploads)
    await fs.writeFile(
      path.join(out, "navigation.json"),
      JSON.stringify(result, null, 2),
    )
    if (video) {
      const recording = p.video()
      await p.close()
      await recording.saveAs(path.join(out, "navigation.webm"))
      await recording.delete()
    }
    console.log(
      JSON.stringify({ renderer: run.renderer, frames, net, errors }, null, 2),
    )
    assert.deepEqual(errors, [])
  } finally {
    if (b) await b.close()
    else await context?.close()
  }
}
main().catch(reportFailure)
