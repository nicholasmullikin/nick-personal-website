// Track resident resources across repeated geographic revisits in one live map.
// Usage: node scripts/check-earth-soak.cjs OUTPUT [MINUTES]
const fs = require("node:fs/promises")
const path = require("node:path")
const assert = require("node:assert/strict")
const { chromium } = require("playwright")
const {
  installProbe,
  mapboxToken,
  browserErrors,
  reportFailure,
} = require("./lib/earth-browser.cjs")
const poses = [
  ["pacific", 45, -134, 0, 4200000, 45, 45],
  ["city", 40.751, -73.986, 30, 920, 76, 23],
  ["coast", 34.406, -119.846, 8, 700, 77, 320],
  ["ridge", 49.95, -123.04, 1650, 1800, 82, 330],
  ["ocean", -4, -146, 0, 11000, 78, 15],
  ["dateline", -16.82, 179.98, 0, 13000, 72, 110],
  ["polar", 83.7, -20, 0, 165000, 76, 240],
  ["alps", 45.91, 6.87, 3000, 5200, 75, 185],
]
async function main() {
  const dir = path.resolve(process.argv[2]),
    minutes = Number(process.argv[3] || 30)
  assert.ok(Number.isFinite(minutes) && minutes > 0)
  await fs.mkdir(dir, { recursive: true })
  const context = await chromium.launchPersistentContext(
    path.join(dir, "browser"),
    {
      viewport: { width: 800, height: 600 },
      args: [
        "--enable-gpu",
        "--use-angle=vulkan",
        "--enable-features=Vulkan",
        "--use-vulkan=native",
      ],
    },
  )
  try {
    const page = context.pages()[0] || (await context.newPage())
    await installProbe(page)
    const errors = browserErrors(page),
      cdp = await context.newCDPSession(page)
    let losses = 0
    await page.exposeFunction("reportEarthContextLoss", () => {
      losses++
    })
    await page.addInitScript(() =>
      document.addEventListener(
        "webglcontextlost",
        () => window.reportEarthContextLoss(),
        true,
      ),
    )
    const url = new URL(
      "/harp/rendering_globe-atmosphere.html",
      process.env.EARTH_PREVIEW_URL || "http://127.0.0.1:8014",
    )
    url.searchParams.set("mapbox_token", await mapboxToken())
    await page.goto(url.href, { waitUntil: "domcontentloaded" })
    await page.waitForFunction(() => window.probe?.map.earth)
    const deadline = Date.now() + 60000 * minutes
    let visit = 0
    while (Date.now() < deadline) {
      const pose = poses[visit % poses.length],
        cycle = Math.floor(visit / poses.length)
      await page.evaluate(
        ({ pose, cycle }) => {
          const m = window.probe.map
          m.earth.setSunHour(cycle % 2 ? 23 : 14)
          m.lookAt({
            target: {
              latitude: pose[1],
              longitude: pose[2],
              altitude: pose[3],
            },
            distance: pose[4],
            tilt: pose[5],
            heading: pose[6],
          })
        },
        { pose, cycle },
      )
      await page.waitForTimeout(12000)
      const snapshot = await page.evaluate(() => {
        const m = window.probe.map,
          e = m.earth
        let tiles = 0,
          bytes = 0
        m.visibleTileSet.forEachCachedTile(tile => {
          tiles++
          bytes += tile.memoryUsage
        })
        return {
          frame: m.frameNumber,
          tiles,
          geometryCacheBytes: bytes,
          rasterCacheBytes: e.stats.cacheBytes,
          buildings: { ...e.buildings.stats },
          objects: { ...m.renderer.info.memory },
          programs: m.renderer.info.programs.length,
          visible: m.visibleTileSet.dataSourceTileList.map(s => [
            s.dataSource.name,
            s.renderedTiles.size,
          ]),
        }
      })
      // Compare retained memory at the same orbit on every loop. Leave other
      // samples unforced so the log also shows the browser's natural GC peaks.
      const collected = visit % poses.length === 0
      if (collected) await cdp.send("HeapProfiler.collectGarbage")
      const heap = await cdp.send("Runtime.getHeapUsage")
      if (cycle === 0 || visit % 24 === 1)
        await page.screenshot({
          path: path.join(dir, cycle + "-" + pose[0] + ".jpg"),
        })
      await fs.appendFile(
        path.join(dir, "visits.jsonl"),
        JSON.stringify({
          visit,
          cycle,
          pose: pose[0],
          utc: new Date().toISOString(),
          collected,
          heap,
          losses,
          errors: [...errors],
          ...snapshot,
        }) + "\n",
      )
      assert.deepEqual(errors, [])
      assert.equal(losses, 0, "WebGL context lost during soak")
      visit++
      await page.waitForTimeout(3000)
    }
  } finally {
    await context.close()
  }
}
main().catch(reportFailure)
