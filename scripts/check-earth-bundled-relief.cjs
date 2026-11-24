// Exercise the last-resort, site-owned DEM with both external elevation services unavailable.
const assert = require("node:assert/strict")
const { chromium, firefox } = require("playwright")
const {
  installProbe,
  browserErrors,
  previewURL,
  reportFailure,
} = require("./lib/earth-browser.cjs")

// Start a fresh page so the failed request cannot use the previous tour's cache.
async function verifyRegionalRepair(browser, damagedBitmap) {
  const page = await browser.newPage({ viewport: { width: 690, height: 440 } })
  const errors = browserErrors(page)
  await installProbe(page)
  let offline = true
  let unavailable = 0
  let repaired = 0
  await page.route("**/terrain-base-v1/4-*.webp", route => {
    if (offline) {
      unavailable++
      if (damagedBitmap) {
        // A valid 1×1 WebP passes the transport and file header checks but
        // cannot represent the expected 1026×1026 source image.
        return route.fulfill({
          contentType: "image/webp",
          body: Buffer.from(
            "UklGRhoAAABXRUJQVlA4TA4AAAAvAAAAAAeQmf0PRET/Aw==",
            "base64",
          ),
        })
      }
      return route.fulfill({ status: 503, body: "Unavailable" })
    }
    repaired++
    return route.continue()
  })
  const url = new URL("/harp/rendering_globe-atmosphere.html", previewURL)
  url.searchParams.set("view", "27.9881,86.925,7600,11000,76,304")
  await page.goto(url.href)
  // The coarse global DEM remains visible while the regional file is missing.
  await page.waitForFunction(
    () => {
      const map = window.probe?.map
      const cut = map?.visibleTileSet?.dataSourceTileList.find(
        s => s.dataSource.name === "terrain",
      )
      if (!cut?.allVisibleTileLoaded) return false
      const h = map.earth.elevationProvider.getHeight({
        latitude: 27.9881,
        longitude: 86.925,
      })
      return h > 3000 && h < 5000
    },
    null,
    { timeout: 90000 },
  )
  assert.ok(unavailable > 0)
  offline = false
  await page.evaluate(() => window.dispatchEvent(new Event("online")))
  await page.waitForFunction(
    () => {
      const map = window.probe.map
      const h = map.earth.elevationProvider.getHeight({
        latitude: 27.9881,
        longitude: 86.925,
      })
      return h > 7800 && h < 8100
    },
    null,
    { timeout: 30000 },
  )
  assert.ok(repaired > 0)
  assert.deepEqual(errors, [])
  console.log({ damagedBitmap, unavailable, repaired })
  await page.close()
}

async function main() {
  const useFirefox = process.env.EARTH_BROWSER === "firefox"
  const browser = useFirefox
    ? await firefox.launch({
        firefoxUserPrefs: {
          "webgl.force-enabled": true,
          "webgl.enable-webgl2": false,
        },
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
    const page = await browser.newPage({
      viewport: { width: 640, height: 400 },
    })
    const errors = browserErrors(page)
    await installProbe(page)
    let paid = 0,
      local = 0,
      world = 0
    const refuse = route =>
      route.fulfill({
        status: 429,
        headers: { "retry-after": "600", "access-control-allow-origin": "*" },
        body: "Unavailable",
      })
    await page.route("**/mapbox.terrain-rgb/**", route => {
      paid++
      return refuse(route)
    })
    await page.route(/https:\/\/[^/]+\.mapterhorn\.com\//, route => {
      world++
      return refuse(route)
    })
    page.on("request", r => {
      if (r.url().includes("/terrain-base-v1/")) local++
    })
    // The open source mode runs without a paid token.
    const url = new URL("/harp/rendering_globe-atmosphere.html", previewURL)
    url.searchParams.set("terrain", "mapterhorn")
    url.searchParams.set("view", "27.9881,86.925,7600,11000,76,304")
    await page.goto(url.href)
    await page.waitForFunction(() => window.probe?.map?.earth)
    await page.evaluate(() => {
      const map = window.probe.map
      map.earth.environment.setClouds(false)
      map.earth.buildings.setEnabled(false)
      map.earth.setMode("c")
    })
    const places = [
      ["Everest", 27.9881, 86.925, 7600, 11000, 6500, 8600],
      ["Pacific Ocean", 0, -145, 0, 2500, -1, 1],
      ["Death Valley", 36.2478, -116.817, -82, 3200, -150, -30],
      ["Greenland interior", 72.581, -38.459, 3216, 2500, 3000, 3400],
    ]
    for (const [
      name,
      latitude,
      longitude,
      altitude,
      distance,
      low,
      high,
    ] of places) {
      const frame = await page.evaluate(
        pose => {
          const map = window.probe.map
          map.lookAt(pose)
          map.update()
          return map.frameNumber
        },
        {
          target: { latitude, longitude, altitude },
          distance,
          tilt: 70,
          heading: 15,
        },
      )
      await page.waitForFunction(
        previous => {
          const map = window.probe.map
          const entry = map.visibleTileSet.dataSourceTileList.find(
            s => s.dataSource.name === "terrain",
          )
          return (
            map.frameNumber > previous &&
            entry?.allVisibleTileLoaded &&
            entry.renderedTiles.size > 0
          )
        },
        frame,
        { timeout: 90000, polling: 100 },
      )
      const height = await page.evaluate(
        point => window.probe.map.earth.elevationProvider.getHeight(point),
        { latitude, longitude },
      )
      assert.ok(height >= low && height <= high, name + " returned " + height)
      console.log(name, Math.round(height) + " m")
    }
    assert.equal(paid, 0)
    assert.ok(world > 0 && world <= 24, "open provider pauses after refusals")
    assert.ok(local > 0 && local < 30, "visible regions share local pages")
    const stats = await page.evaluate(
      () => window.probe.map.getDataSourceByName("terrain").terrainBaseline,
    )
    assert.ok(stats.tiles > 0 && stats.pages < stats.tiles)
    assert.ok(
      stats.bytes < 1024 * 1024,
      "global tour downloads only its local regional pages",
    )
    assert.deepEqual(errors, [])
    console.log({ paid, refused: world, local, ...stats })
    await page.close()
    await verifyRegionalRepair(browser, false)
    await verifyRegionalRepair(browser, true)
  } finally {
    await browser.close()
  }
}
main().catch(reportFailure)
