// Keep one close DEM unavailable through all immediate retries, then restore it.
const assert = require("node:assert/strict")
const { chromium } = require("playwright")
const {
  installProbe,
  mapboxToken,
  browserErrors,
  reportFailure,
} = require("./lib/earth-browser.cjs")
async function main() {
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage({
      viewport: { width: 960, height: 720 },
    })
    const errors = browserErrors(page)
    const url = new URL(
      "/harp/rendering_globe-atmosphere.html",
      process.env.EARTH_PREVIEW_URL || "http://localhost:8014",
    )
    url.searchParams.set("mapbox_token", await mapboxToken())
    await installProbe(page)
    let path,
      fail = true,
      attempts = 0
    await page.route("**/mapbox.terrain-rgb/15/**", async route => {
      const pathname = new URL(route.request().url()).pathname
      path ??= pathname
      if (path === pathname) {
        attempts++
        if (fail)
          return route.fulfill({ status: 503, body: "temporarily unavailable" })
      }
      return route.continue()
    })
    await page.goto(url.href)
    await page.waitForFunction(() => window.probe?.map.earth)
    await page.evaluate(() =>
      window.probe.map.lookAt({
        target: { latitude: 34.402, longitude: -119.841, altitude: 8 },
        distance: 750,
        tilt: 0,
        heading: 0,
      }),
    )
    await page.waitForFunction(
      () => {
        const m = window.probe.map,
          source = m.getDataSourceByName("terrain"),
          entry = m.visibleTileSet.dataSourceTileList.find(
            e => e.dataSource === source,
          )
        return (
          source.terrainHealth.fallbackTiles > 0 && entry?.allVisibleTileLoaded
        )
      },
      null,
      { polling: 100, timeout: 90000 },
    )
    const coordinates = path
      .match(/\/(\d+)\/(\d+)\/(\d+)\.pngraw$/)
      .slice(1)
      .map(Number)
    const fallback = await page.evaluate(([z, x, y]) => {
      const m = window.probe.map,
        e = m.visibleTileSet.dataSourceTileList.find(
          e => e.dataSource.name === "terrain",
        )
      const failedTile = [...e.renderedTiles.values()].find(
        ({ tileKey: k }) => k.level === z && k.column === x && k.row === y,
      )
      return {
        geometry: failedTile?.objects.find(o => o.isMesh)?.geometry.uuid,
        health: { ...e.dataSource.terrainHealth },
        levels: [...e.renderedTiles.values()].map(t => t.tileKey.level),
        allCovered: e.visibleTiles.every(t => e.renderedTiles.has(t.uniqueKey)),
      }
    }, coordinates)
    assert.ok(fallback.geometry)
    assert.equal(attempts, 3)
    assert.ok(
      fallback.allCovered &&
        fallback.levels.length &&
        fallback.levels.every(z => z === 15),
    )
    fail = false
    // Exercise the real delayed repair, retaining the drawable child throughout.
    await page.waitForResponse(
      response =>
        new URL(response.url()).pathname === path && response.status() === 200,
      { timeout: 70000 },
    )
    await page.waitForFunction(
      ([z, x, y, original]) => {
        const m = window.probe.map,
          e = m.visibleTileSet.dataSourceTileList.find(
            e => e.dataSource.name === "terrain",
          )
        const repaired = [...e.renderedTiles.values()]
          .find(
            ({ tileKey: k }) => k.level === z && k.column === x && k.row === y,
          )
          ?.objects.find(o => o.isMesh)?.geometry.uuid
        return (
          repaired &&
          repaired !== original &&
          e.allVisibleTileLoaded &&
          e.dataSource.terrainHealth.repairAttempts > 0
        )
      },
      [...coordinates, fallback.geometry],
      { polling: 100, timeout: 30000 },
    )
    assert.equal(attempts, 4)
    assert.deepEqual(errors, [])
    console.log({ path, attempts, fallback })
  } finally {
    await browser.close()
  }
}
main().catch(reportFailure)
