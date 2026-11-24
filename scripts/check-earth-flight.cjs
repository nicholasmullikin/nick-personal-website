// Play back a globe-to-mountain approach, a turn, and a return to the first view.
// Supply an output directory to retain the real frames alongside the timing trace.
const assert = require("node:assert/strict")
const fs = require("node:fs/promises")
const path = require("node:path")
const { chromium } = require("playwright")
const {
  mapboxToken,
  installProbe,
  browserErrors,
  reportFailure,
} = require("./lib/earth-browser.cjs")

const poses = [
  ["orbit", 44, -124, 0, 4800000, 30, 0],
  ["regional", 49.8, -123, 0, 210000, 48, 335],
  ["approach", 49.92, -123.03, 1300, 15000, 58, 335],
  ["ridge", 49.95, -123.04, 1650, 1800, 72, 330],
  ["turn", 49.95, -123.04, 1650, 1800, 72, 100],
  ["return", 49.95, -123.04, 1650, 1800, 72, 330],
]

async function main() {
  const out = path.resolve(process.argv[2] || "/tmp/earth-flight")
  await fs.mkdir(out, { recursive: true })
  const base = process.env.EARTH_PREVIEW_URL || "http://127.0.0.1:8014"
  const url = new URL("/harp/rendering_globe-atmosphere.html", base)
  url.searchParams.set("mapbox_token", await mapboxToken())
  const browser = await chromium.launch({
    args: process.env.EARTH_FLIGHT_SOFTWARE
      ? []
      : [
          "--enable-gpu",
          "--use-angle=vulkan",
          "--enable-features=Vulkan",
          "--use-vulkan=native",
        ],
  })
  try {
    const page = await browser.newPage({
      viewport: { width: 960, height: 720 },
    })
    const constrained = process.env.EARTH_FLIGHT_NETWORK === "constrained"
    if (constrained) {
      const cdp = await page.context().newCDPSession(page)
      await cdp.send("Network.enable")
      await cdp.send("Network.emulateNetworkConditions", {
        offline: false,
        latency: 150,
        downloadThroughput: 500000,
        uploadThroughput: 125000,
      })
    }
    const navigationStart = Date.now()
    await installProbe(page)
    const errors = browserErrors(page)
    const network = []
    function record(req, status) {
      const url = new URL(req.url())
      if (!["http:", "https:"].includes(url.protocol)) return
      network.push({
        host: url.host,
        path: url.pathname,
        status,
        time: Date.now(),
      })
    }
    page.on("response", response =>
      record(response.request(), response.status()),
    )
    page.on("requestfailed", req =>
      record(req, req.failure()?.errorText || "failed"),
    )
    await page.goto(url.href, { waitUntil: "domcontentloaded" })
    await page.waitForFunction(() => window.probe?.map.earth)
    const readyMs = Date.now() - navigationStart
    const renderer = await page.evaluate(() => {
      const gl = window.probe.map.renderer.getContext()
      const ext = gl.getExtension("WEBGL_debug_renderer_info")
      return ext
        ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)
        : gl.getParameter(gl.RENDERER)
    })
    const results = []
    for (const [
      name,
      latitude,
      longitude,
      altitude,
      distance,
      tilt,
      heading,
    ] of poses) {
      const start = Date.now()
      const frame = await page.evaluate(
        pose => {
          const map = window.probe.map
          map.earth.performance.reset()
          map.lookAt(pose)
          map.update()
          return map.frameNumber
        },
        { target: { latitude, longitude, altitude }, distance, tilt, heading },
      )
      await page.waitForFunction(f => window.probe.map.frameNumber > f, frame)
      for (const seconds of [1, 8]) {
        await page.waitForTimeout(
          Math.max(0, start + seconds * 1000 - Date.now()),
        )
        const state = await page.evaluate(() => {
          const map = window.probe.map
          const terrain = map.visibleTileSet.dataSourceTileList.find(
            e => e.dataSource.name === "terrain",
          )
          return {
            frame: map.frameNumber,
            zoom: map.zoomLevel,
            terrain: terrain?.renderedTiles.size || 0,
            imagery: { ...map.earth.stats },
            profile: map.earth.performance.snapshot(),
          }
        })
        results.push({ name, seconds, elapsed: Date.now() - start, ...state })
        await page.screenshot({
          path: path.join(out, name + "-" + seconds + ".jpg"),
          quality: 88,
        })
      }
      console.log(name, JSON.stringify(results.at(-1).imagery))
    }
    await fs.writeFile(
      path.join(out, "flight.json"),
      JSON.stringify(
        { renderer, readyMs, constrained, results, network, errors },
        null,
        2,
      ),
    )
    assert.deepEqual(errors, [])
    assert.ok(results.every(s => s.frame > 0))
    console.log(renderer)
  } finally {
    await browser.close()
  }
}
main().catch(reportFailure)
