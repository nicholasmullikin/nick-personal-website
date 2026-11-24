// Automatic elevation through the normal site entry, provider outages and tokenless rendering.
const assert = require("node:assert/strict")
const { chromium } = require("playwright")
const {
  installProbe,
  browserErrors,
  previewURL,
  reportFailure,
} = require("./lib/earth-browser.cjs")

async function main() {
  const browser = await chromium.launch({
    args: [
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
    const errors = browserErrors(page)
    await installProbe(page)
    const mounted = new URL("/blog/earth/", previewURL)
    mounted.searchParams.set("view", "34.40632,-119.8447,10,260,72,320")
    await page.goto(mounted.href, { waitUntil: "domcontentloaded" })
    const handle = await page
      .locator('iframe[title="harp.gl globe with atmosphere"]')
      .elementHandle()
    const frame = await handle.contentFrame()
    await frame.waitForFunction(
      () =>
        window.probe?.map.getDataSourceByName("terrain").worldTerrain?.bytes >
        0,
    )
    assert.equal(new URL(frame.url()).searchParams.has("terrain"), false)
    assert.equal(
      await frame
        .locator('#earth-credits a[href="https://mapterhorn.com/attribution/"]')
        .count(),
      1,
    )
    await frame
      .getByRole("button", { name: "Environment", exact: true })
      .click()
    assert.equal(await frame.getByLabel("Elevation source").count(), 0)
    assert.equal(
      await frame.getByText("US lidar terrain", { exact: true }).count(),
      0,
    )
    await page.close()

    const free = await browser.newPage({
      viewport: { width: 960, height: 720 },
    })
    const freeErrors = browserErrors(free)
    await installProbe(free)
    let paidRequests = 0,
      rejected = 0,
      unavailable = true
    free.on("request", request => {
      if (new URL(request.url()).hostname === "api.mapbox.com") paidRequests++
    })
    await free.route("https://tiles.mapterhorn.com/**", route => {
      if (!unavailable) return route.continue()
      rejected++
      return route.fulfill({
        status: 429,
        headers: {
          "Retry-After": "2",
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Expose-Headers": "Retry-After",
        },
      })
    })
    const direct = new URL("/harp/rendering_globe-atmosphere.html", previewURL)
    direct.searchParams.set("view", "36.0617,-112.1075,2162,270,77,2")
    await free.goto(direct.href)
    await free.waitForFunction(
      () =>
        window.probe?.map.getDataSourceByName("terrain").worldTerrain?.errors >
        0,
    )
    await free.waitForTimeout(750)
    assert.ok(
      rejected > 0 && rejected <= 16,
      `Unexpected initial rejection count: ${rejected}`,
    )
    unavailable = false
    await free.waitForFunction(
      () => {
        const m = window.probe.map,
          terrain = m.getDataSourceByName("terrain"),
          entry = m.visibleTileSet.dataSourceTileList.find(
            e => e.dataSource === terrain,
          )
        const z =
          entry &&
          Math.max(
            ...Array.from(entry.renderedTiles.values(), t => t.tileKey.level),
          )
        const h = m.earth.elevationProvider.getHeight({
          latitude: 36.0617,
          longitude: -112.1075,
        })
        return z >= 16 && h > 2155 && h < 2170
      },
      null,
      { timeout: 60000 },
    )
    await free.evaluate(() => {
      const m = window.probe.map
      m.lookAt({
        target: { latitude: 27.985, longitude: 86.925, altitude: 8500 },
        distance: 2200,
        tilt: 68,
        heading: 220,
      })
      m.update()
    })
    await free.waitForFunction(
      () =>
        window.probe.map.earth.elevationProvider.getHeight({
          latitude: 27.985,
          longitude: 86.925,
        }) > 8000,
      null,
      { timeout: 60000 },
    )
    assert.equal(paidRequests, 0)

    const revoked = await browser.newPage()
    await installProbe(revoked)
    let denied = 0,
      indexRequests = 0
    revoked.on("request", request => {
      if (new URL(request.url()).hostname === "download.mapterhorn.com")
        indexRequests++
    })
    await revoked.route("https://api.mapbox.com/**", route => {
      if (
        new URL(route.request().url()).pathname.includes("/mapbox.terrain-rgb/")
      )
        denied++
      return route.fulfill({
        status: 401,
        headers: { "Access-Control-Allow-Origin": "*" },
      })
    })
    direct.searchParams.set("mapbox_token", "unusable-test-key")
    direct.searchParams.set("view", "27.985,86.925,8500,2200,68,220")
    await revoked.goto(direct.href)
    await revoked.waitForFunction(
      () =>
        window.probe?.map?.earth?.elevationProvider.getHeight({
          latitude: 27.985,
          longitude: 86.925,
        }) > 8000,
      null,
      { timeout: 60000 },
    )
    const indexBytes = await revoked.evaluate(
      () =>
        window.probe.map.getDataSourceByName("terrain").worldTerrain.indexBytes,
    )
    assert.equal(indexBytes, 0)
    assert.ok(
      denied > 0 && denied <= 16,
      `Revoked-token DEM failures: ${denied}`,
    )
    assert.ok(
      indexRequests <= 4,
      `Missing-region directory lookups: ${indexRequests}`,
    )
    console.log(
      `Revoked-key Everest height recovered after ${denied} paid refusals, with ${indexRequests} regional header checks and zero index payload bytes.`,
    )
    assert.deepEqual(errors, [])
    assert.deepEqual(freeErrors, [])
    console.log(
      `Worldwide elevation loaded through the site, recovered after ${rejected} rejected tiles, and sampled the Himalayas with zero paid requests.`,
    )
  } finally {
    await browser.close()
  }
}
main().catch(reportFailure)
