// Leave the same camera over a previously unseen city through a real network
// outage. Check that imagery, city geometry, and DEM all recover independently.
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
async function main() {
  const out = path.resolve(process.argv[2] || "/tmp/earth-reconnect")
  await fs.mkdir(out, { recursive: true })
  const browser = await chromium.launch({
    args: [
      "--enable-gpu",
      "--use-angle=vulkan",
      "--enable-features=Vulkan",
      "--use-vulkan=native",
    ],
  })
  try {
    const context = await browser.newContext({
      viewport: { width: 800, height: 600 },
    })
    const page = await context.newPage()
    const errors = browserErrors(page)
    await installProbe(page)
    const url = new URL(
      "/harp/rendering_globe-atmosphere.html",
      process.env.EARTH_PREVIEW_URL || "http://127.0.0.1:8014",
    )
    url.searchParams.set("mapbox_token", await mapboxToken())
    await page.goto(url.href, { waitUntil: "domcontentloaded" })
    await page.waitForFunction(() => window.probe?.map.earth)
    await page.waitForTimeout(2200)
    await context.setOffline(true)
    await page.evaluate(() => {
      const m = window.probe.map
      m.lookAt({
        target: { latitude: 40.751, longitude: -73.986, altitude: 15 },
        distance: 1050,
        tilt: 73,
        heading: 23,
      })
    })
    const sample = () =>
      page.evaluate(() => {
        const m = window.probe.map,
          ds = m.getDataSourceByName("terrain"),
          e = m.earth
        const shown = m.visibleTileSet.dataSourceTileList.find(
          d => d.dataSource === ds,
        )
        return {
          online: navigator.onLine,
          buildings: e.buildings.stats.buildings,
          roofRequests: e.buildings.stats.requests,
          rasterRequests: e.stats.requests,
          satelliteBytes: e.stats.encodedBytes,
          highestPhoto: e.stats.detailHighestZoom,
          repairs: ds.terrainHealth.repairAttempts,
          fallbackTiles: ds.terrainHealth.fallbackTiles,
          visibleTerrain: shown?.renderedTiles.size || 0,
        }
      })
    const timeline = []
    for (let i = 0; i < 5; i++) {
      await page.waitForTimeout(1000)
      timeline.push(await sample())
    }
    await page.screenshot({ path: path.join(out, "offline.jpg") })
    await context.setOffline(false)
    const start = Date.now()
    while (Date.now() - start < 30000) {
      await page.waitForTimeout(500)
      const current = await sample()
      timeline.push({ ...current, elapsed: Date.now() - start })
      if (
        current.buildings > 500 &&
        current.highestPhoto >= 16 &&
        current.repairs > 0
      )
        break
    }
    await fs.writeFile(
      path.join(out, "recovery.json"),
      JSON.stringify({ timeline, errors }, null, 2),
    )
    await page.screenshot({ path: path.join(out, "recovered.jpg") })
    const last = timeline.at(-1)
    console.log({ offline: timeline[4], recovered: last, errors })
    assert.deepEqual(errors, [])
    assert.ok(
      timeline[4].fallbackTiles > 0,
      "outage exercised fallback terrain",
    )
    assert.ok(
      last.repairs > 0 && last.highestPhoto >= 16 && last.buildings > 500,
      "stationary map recovers all three sources",
    )
  } finally {
    await browser.close()
  }
}
main().catch(reportFailure)
