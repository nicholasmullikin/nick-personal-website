// A CDN error page can arrive with HTTP 200. Exercise both the single-tile PNG
// path and a WebP shared by several requested children, including a live repair.
const assert = require("node:assert/strict")
const { chromium, firefox } = require("playwright")
const {
  installProbe,
  mapboxToken,
  previewURL,
  browserErrors,
  reportFailure,
} = require("./lib/earth-browser.cjs")

async function scenario(browser, open) {
  const page = await browser.newPage({ viewport: { width: 720, height: 460 } })
  try {
    await installProbe(page)
    const errors = browserErrors(page)
    let damaged,
      broken = true,
      refused = 0,
      restored = 0
    const route = open
      ? "https://tiles.mapterhorn.com/14/**"
      : "**/mapbox.terrain-rgb/15/**"
    await page.route(route, request => {
      const path = new URL(request.request().url()).pathname
      damaged ??= path
      if (path === damaged) {
        if (broken) {
          refused++
          return request.fulfill({
            status: 200,
            headers: { "Access-Control-Allow-Origin": "*" },
            contentType: "text/html",
            body: "<title>Temporarily unavailable</title>",
          })
        }
        restored++
      }
      return request.continue()
    })
    const url = new URL("/harp/rendering_globe-atmosphere.html", previewURL)
    if (open) url.searchParams.set("terrain", "mapterhorn")
    else url.searchParams.set("mapbox_token", await mapboxToken())
    url.searchParams.set("view", "36.0617,-112.1075,2162,670,72,2")
    await page.goto(url.href)
    await page.waitForFunction(() => window.probe?.map?.earth)
    await page.evaluate(() => {
      const { earth } = window.probe.map
      earth.environment.setClouds(false)
      earth.buildings.setEnabled(false)
    })
    const complete = afterRepair => {
      const map = window.probe.map,
        source = map.getDataSourceByName("terrain")
      const cut = map.visibleTileSet.dataSourceTileList.find(
        entry => entry.dataSource === source,
      )
      return (
        source.terrainHealth.fallbackTiles > 0 &&
        cut?.allVisibleTileLoaded &&
        cut.renderedTiles.size > 0 &&
        (!afterRepair || source.terrainHealth.repairAttempts > 0)
      )
    }
    await page.waitForFunction(complete, false, {
      timeout: 60000,
      polling: 100,
    })
    assert.equal(refused, 1, "siblings should share a damaged page's cooldown")
    broken = false
    const fetched = page.waitForResponse(
      response =>
        new URL(response.url()).pathname === damaged &&
        response.status() === 200,
    )
    // The normal reconnect path wakes the same queue as its timed backoff.
    await page.evaluate(() => window.dispatchEvent(new Event("online")))
    await fetched
    await page.waitForFunction(complete, true, { timeout: 60000, polling: 100 })
    assert.equal(restored, 1)
    assert.deepEqual(errors, [])
    console.log(open ? "Mapterhorn" : "Terrain-RGB", {
      damaged,
      refused,
      restored,
    })
  } finally {
    await page.close()
  }
}

async function main() {
  const browser =
    process.env.EARTH_BROWSER === "firefox"
      ? await firefox.launch({
          firefoxUserPrefs: { "webgl.enable-webgl2": false },
        })
      : await chromium.launch({
          args: [
            "--enable-gpu",
            "--use-angle=vulkan",
            "--enable-features=Vulkan",
            "--use-vulkan=native",
          ],
        })
  try {
    await scenario(browser, false)
    await scenario(browser, true)
  } finally {
    await browser.close()
  }
}
main().catch(reportFailure)
