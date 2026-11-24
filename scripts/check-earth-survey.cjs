// Exercise the actual Gatsby share link, index bounds and recovery of surveyed terrain.
const assert = require("node:assert/strict")
const { chromium } = require("playwright")
const {
  browserErrors,
  installProbe,
  reportFailure,
} = require("./lib/earth-browser.cjs")
const pack = "/terrain-packs/usgs-3dep-v1/manifest.json"
const olympic = "47.802,-123.67,1650,1000,72,90"
const coast = "34.40632,-119.8447,10,260,72,320"

async function open(browser, view, manifest) {
  const page = await browser.newPage({ viewport: { width: 960, height: 720 } })
  const requests = []
  page.on("request", request => {
    const path = new URL(request.url()).pathname
    if (path.includes("/terrain-packs/") || /terrain-rgb\/(16|17)\//.test(path))
      requests.push(path)
  })
  const errors = browserErrors(page)
  await installProbe(page)
  const url = new URL(
    "/blog/earth/",
    process.env.EARTH_PREVIEW_URL || "http://localhost:8014",
  )
  url.searchParams.set("view", view)
  if (manifest) url.searchParams.set("terrain_pack", manifest)
  await page.goto(url.href, { waitUntil: "domcontentloaded" })
  const iframe = await page
    .locator('iframe[title="harp.gl globe with atmosphere"]')
    .elementHandle({ timeout: 25000 })
  const frame = await iframe.contentFrame()
  await frame.waitForFunction(() => window.probe?.map.earth)
  const params = new URL(frame.url()).searchParams
  assert.equal(params.get("terrain_pack"), manifest ?? null)
  assert.equal(params.get("view"), view)
  return { page, frame, requests, errors }
}

async function settle(frame) {
  await frame.waitForFunction(
    () => {
      const entry = window.probe.map.visibleTileSet.dataSourceTileList.find(
        e => e.dataSource.name === "terrain",
      )
      return entry?.allVisibleTileLoaded && entry.renderedTiles.size > 0
    },
    null,
    { timeout: 90000 },
  )
}

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
    for (const src of [undefined, "javascript:invalid-pack"]) {
      const { page, frame, requests, errors } = await open(browser, coast, src)
      await settle(frame)
      assert.equal(
        await frame.evaluate(
          () => !!window.probe.map.getDataSourceByName("terrain").terrainDetail,
        ),
        false,
      )
      assert.deepEqual(requests, [])
      assert.deepEqual(errors, [])
      await page.close()
    }
    const { page, frame, requests, errors } = await open(browser, olympic, pack)
    await settle(frame)
    await frame.waitForFunction(
      () =>
        window.probe.map.getDataSourceByName("terrain").terrainDetail
          .indexedRegions === 4,
    )
    assert.deepEqual(requests, [pack])
    const target = await frame.evaluate(() => {
      const m = window.probe.map
      const eye = m.projection.unprojectPoint(m.camera.position)
      return [eye.latitude, eye.longitude]
    })
    assert.ok(
      Math.abs(target[0] - 47.802) < 0.015 &&
        Math.abs(target[1] + 123.67) < 0.015,
    )
    let unavailable = true
    let failedTile
    await page.route("**/terrain-packs/**/tiles/17/**/*.png", route => {
      const path = new URL(route.request().url()).pathname
      failedTile ??= path
      if (unavailable && path === failedTile)
        return route.fulfill({ status: 503, body: "temporary outage" })
      return route.continue()
    })
    await frame.evaluate(() => {
      const m = window.probe.map
      m.lookAt({
        target: { latitude: 34.40632, longitude: -119.8447, altitude: 10 },
        distance: 260,
        tilt: 72,
        heading: 320,
      })
      m.update()
    })
    await frame.waitForFunction(
      () =>
        window.probe.map.getDataSourceByName("terrain").terrainHealth
          .fallbackTiles > 0,
      null,
      { timeout: 60000 },
    )
    await settle(frame)
    assert.ok(failedTile)
    const index = requests.filter(path => path.includes("/regions/"))
    assert.equal(index.length, 1)
    const surface = await frame.evaluate(() =>
      window.probe.map.earth.elevationProvider.getHeight({
        latitude: 34.40632,
        longitude: -119.8447,
      }),
    )
    assert.ok(Number.isFinite(surface) && surface > 2 && surface < 25)
    unavailable = false
    const repaired = page.waitForResponse(
      r => new URL(r.url()).pathname === failedTile && r.status() === 200,
      { timeout: 60000 },
    )
    await frame.evaluate(() => window.dispatchEvent(new Event("online")))
    await repaired
    await settle(frame)
    assert.ok(requests.every(path => !path.includes("terrain-rgb/")))
    await frame
      .getByRole("button", { name: "Environment", exact: true })
      .click()
    assert.equal(await frame.getByLabel("Elevation source").count(), 0)
    assert.ok(
      await frame.evaluate(
        () =>
          window.probe.map.getDataSourceByName("terrain").terrainDetail.bytes >
          0,
      ),
    )
    assert.equal(new URL(page.url()).searchParams.get("terrain_pack"), pack)
    assert.deepEqual(errors, [])
    console.log(
      "Gatsby survey sharing, bounded manifest traffic, supported regions, fallback and reconnection passed.",
    )
  } finally {
    await browser.close()
  }
}
main().catch(reportFailure)
