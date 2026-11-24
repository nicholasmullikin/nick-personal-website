// Verify independent satellite sampling and missing-tile recovery in the real
// material, then check a provider-confirmed all-water view at the same scale.
const assert = require("node:assert/strict")
const { chromium } = require("playwright")
const {
  previewURL,
  mapboxToken,
  installProbe,
  browserErrors,
  reportFailure,
} = require("./lib/earth-browser.cjs")
async function main() {
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage({
      viewport: { width: 900, height: 620 },
    })
    await installProbe(page)
    const errors = browserErrors(page),
      requested = new Map()
    let absent
    await page.route("**/mapbox.satellite/**", async route => {
      const path = new URL(route.request().url()).pathname
      const match = path.match(/satellite\/(\d+)\/(\d+)\/(\d+)@2x\./)
      if (!match) return route.continue()
      const [, z, x, y] = match
      const key = [z, x, y].join("/")
      requested.set(key, (requested.get(key) || 0) + 1)
      if (!absent && +z >= 17) absent = { key, z: +z, x: +x, y: +y }
      if (key === absent?.key)
        return route.fulfill({ status: 404, body: "Tile not found" })
      return route.continue()
    })
    const url = new URL("/harp/rendering_globe-atmosphere.html", previewURL)
    url.searchParams.set("mapbox_token", await mapboxToken())
    await page.goto(url.href, { waitUntil: "domcontentloaded" })
    await page.waitForFunction(() => !!window.probe?.map.earth)
    const coast = {
      target: { latitude: 34.4102, longitude: -119.8478, altitude: 10 },
      heading: 320,
      tilt: 50,
      distance: 380,
    }
    await page.evaluate(pose => {
      const m = window.probe.map
      m.earth.environment.setClouds(false)
      const metrics = (window.streamCheck = { maxPending: 0, intermediate: 0 })
      m.addEventListener("didrender", () => {
        metrics.maxPending = Math.max(metrics.maxPending, m.earth.stats.pending)
        for (const t of m.visibleTileSet.dataSourceTileList
          .find(e => e.dataSource.name === "terrain")
          ?.renderedTiles.values() || []) {
          for (const o of t.objects)
            for (
              let i = 0;
              i < (o.material?.defines?.EARTH_DETAIL_SLOTS || 0);
              i++
            ) {
              const f = o.material.uniforms["detailFade" + i].value
              if (f > 0 && f < 1) metrics.intermediate++
            }
        }
      })
      m.lookAt(pose)
    }, coast)
    await page.waitForFunction(
      () => {
        const m = window.probe.map,
          s = m.earth.stats
        return (
          s.detailHighestZoom >= 17 &&
          s.unavailable > 0 &&
          !s.pending &&
          !s.fading &&
          m.visibleTileSet.dataSourceTileList.find(
            e => e.dataSource.name === "terrain",
          )?.allVisibleTileLoaded
        )
      },
      null,
      { timeout: 90000, polling: 100 },
    )
    assert.ok(absent)
    const parent = [
      absent.z - 1,
      Math.floor(absent.x / 2),
      Math.floor(absent.y / 2),
    ].join("/")
    assert.ok(
      requested.has(parent),
      "try the available parent of the missing detail page",
    )
    const before = await page.evaluate(() => ({
      ...window.probe.map.earth.stats,
    }))
    for (let i = 0; i < 3; i++) {
      await page.evaluate(() => window.probe.map.update())
      await page.waitForTimeout(200)
    }
    const after = await page.evaluate(() => ({
      ...window.probe.map.earth.stats,
    }))
    assert.equal(
      requested.get(absent.key),
      1,
      "a missing page is not redownloaded",
    )
    assert.equal(
      before.requests,
      after.requests,
      "a settled coast makes no new requests",
    )
    assert.equal(
      before.feedbackRuns,
      after.feedbackRuns,
      "stationary camera reuses its feedback",
    )
    assert.ok(after.idleSkips > before.idleSkips)
    assert.ok(after.detailBindings > 0 && after.detailWanted <= 12)
    await page.evaluate(() =>
      window.probe.map.lookAt({
        target: { latitude: 0, longitude: -140, altitude: 0 },
        heading: 0,
        tilt: 0,
        distance: 350,
      }),
    )
    await page.waitForFunction(
      () => {
        const m = window.probe.map,
          s = m.earth.stats
        return (
          s.oceanSuppressed > 0 &&
          // Wave textures finish independently of imagery and DEM requests.
          s.oceanTiles > 0 &&
          !s.pending &&
          !s.fading &&
          !s.detailBindings &&
          m.visibleTileSet.dataSourceTileList.find(
            e => e.dataSource.name === "terrain",
          )?.allVisibleTileLoaded
        )
      },
      null,
      { timeout: 90000, polling: 100 },
    )
    const water = await page.evaluate(() => ({
      ...window.probe.map.earth.stats,
    }))
    assert.ok(water.uniformPages > 0)
    assert.equal(after.oceanTiles, 0, "photographic coastal water stays intact")
    assert.ok(
      water.oceanTiles > 0,
      "verified open sea uses its dedicated shader",
    )
    const observations = await page.evaluate(() => window.streamCheck)
    assert.ok(observations.maxPending <= 8)
    assert.ok(
      observations.intermediate > 0,
      "fine imagery fades through intermediate opacity",
    )
    assert.deepEqual(errors, [])
    console.log(
      JSON.stringify({ coast: after, openWater: water, observations }, null, 2),
    )
  } finally {
    await browser.close()
  }
}
main().catch(reportFailure)
