const { openControls } = require("./lib/earth-browser.cjs")
const {
  previewURL,
  mapboxToken,
  reportFailure,
  installProbe,
  browserErrors,
} = require("./lib/earth-browser.cjs")
// Browser regression: real OSM buildings, failure recovery, night emission, and clouds.
const { chromium } = require("playwright"),
  fs = require("node:fs/promises"),
  path = require("node:path"),
  assert = require("node:assert/strict"),
  { createRequire } = require("node:module")
const sharp = createRequire(require.resolve("gatsby-plugin-sharp"))("sharp")
const base = previewURL,
  output = path.resolve(process.argv[2] || "/tmp/earth-layers")
async function main() {
  await fs.mkdir(output, { recursive: true })
  const token = await mapboxToken()
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage({
        viewport: { width: 1100, height: 750 },
      }),
      errors = browserErrors(page),
      observations = { maxPending: 0, maxCache: 0, requestsAtOrbit: 0 }
    await installProbe(page)
    let injected = false
    await page.route("**/planet/**/*.pbf", async r => {
      if (!injected) {
        injected = true
        await r.abort("failed")
      } else {
        await new Promise(r => setTimeout(r, 80))
        await r.continue()
      }
    })
    await page.goto(
      `${base}/harp/rendering_globe-atmosphere.html?mapbox_token=${token}`,
    )
    await page.waitForFunction(
      () =>
        window.probe?.map.earth?.environment.status.nightReady &&
        window.probe.map.earth.environment.status.cloudReady,
    )
    await page.evaluate(() => {
      window.layerSamples = []
      window.layerTimer = setInterval(
        () =>
          window.layerSamples.push({
            ...window.probe.map.earth.buildings.stats,
          }),
        100,
      )
    })
    const shot = async name => {
      await page.waitForTimeout(1200)
      const b = await page.screenshot({
        path: path.join(output, name + ".png"),
      })
      return b
    }
    const settle = () =>
      page.waitForFunction(
        () => {
          const map = window.probe.map,
            stats = map.earth.buildings.stats
          const entry = map.visibleTileSet.dataSourceTileList.find(
            e => e.dataSource.name === "buildings",
          )
          return (
            stats.pending === 0 &&
            stats.buildings > 1000 &&
            entry?.allVisibleTileLoaded
          )
        },
        null,
        { polling: 100, timeout: 60000 },
      )
    await openControls(page, "Explore")
    await page.getByLabel("Visit a city").selectOption("New York")
    await settle()
    await page.waitForTimeout(17000)
    await settle()
    assert.ok(injected, "failed request was injected")
    const city = await page.evaluate(() => ({
      ...window.probe.map.earth.buildings.stats,
    }))
    const rendering = await page.evaluate(() => ({
      ...window.probe.map.renderer.info.render,
      geometryCount: window.probe.map.renderer.info.memory.geometries,
      buildingVertices: (() => {
        let count = 0
        window.probe.map.scene.traverse(o => {
          if (o.material?.uniforms?.groundMap)
            count += o.geometry.attributes.position.count
        })
        return count
      })(),
    }))
    assert.ok(city.buildings > 10000)
    assert.equal(city.failures, 1)
    assert.ok(
      city.tiles >= 12,
      "native tile selection recovered the failed request",
    )
    await shot("new-york-day")
    await openControls(page, "Environment")
    await page.getByRole("button", { name: "Night", exact: true }).click()
    await shot("new-york-night")
    await openControls(page, "Environment")
    await page.getByRole("button", { name: "Buildings", exact: true }).click()
    await page.waitForTimeout(600)
    assert.equal(
      await page.evaluate(() => window.probe.map.earth.buildings.stats.tiles),
      0,
    )
    await openControls(page, "Environment")
    await page.getByRole("button", { name: "Buildings", exact: true }).click()
    await settle()
    // Travel across cities, including mid-load changes, to exercise cancellation and cache eviction.
    await openControls(page, "Explore")
    await page.getByLabel("Visit a city").selectOption("London")
    await page.waitForTimeout(400)
    await openControls(page, "Explore")
    await page.getByLabel("Visit a city").selectOption("Tokyo")
    await settle()
    await page.waitForTimeout(2500)
    await shot("tokyo-day")
    const cacheState = await page.evaluate(() => ({
      ...window.probe.map.earth.buildings.stats,
    }))
    assert.ok(
      cacheState.cacheBytes <=
        Math.max(200 * 1024 * 1024, cacheState.visibleBytes) + 1024 * 1024,
      "native cache retains only its budget or the required visible geometry",
    )
    await page.getByRole("button", { name: "Earth", exact: true }).click()
    await page.waitForTimeout(3500)
    assert.equal(
      await page.evaluate(() => window.probe.map.earth.buildings.stats.tiles),
      0,
    )
    const before = await page.evaluate(
      () => window.probe.map.earth.buildings.stats.requests,
    )
    await page.waitForTimeout(1000)
    assert.equal(
      await page.evaluate(
        () => window.probe.map.earth.buildings.stats.requests,
      ),
      before,
      "no building requests from orbit",
    )
    await openControls(page, "Environment")
    await page.getByRole("button", { name: "Night", exact: true }).click()
    await openControls(page, "Environment")
    await page.getByRole("button", { name: "Clouds", exact: true }).click()
    const lights = await shot("orbit-night-lights")
    await openControls(page, "Environment")
    await page.getByRole("button", { name: "Lights", exact: true }).click()
    const dark = await shot("orbit-night-unlit")
    await openControls(page, "Environment")
    await page.getByRole("button", { name: "Lights", exact: true }).click()
    const diff = async (a, b) => {
      const aa = await sharp(a).raw().toBuffer(),
        bb = await sharp(b).raw().toBuffer()
      let sum = 0,
        changed = 0
      for (let i = 0; i < aa.length; i++) {
        const d = Math.abs(aa[i] - bb[i])
        sum += d
        if (d > 15) changed++
      }
      return { mean: sum / aa.length, changed }
    }
    const nightDiff = await diff(lights, dark)
    assert.ok(nightDiff.changed > 1000, "night lights change rendered pixels")
    await openControls(page, "Environment")
    await page.getByRole("button", { name: "Day", exact: true }).click()
    const clear = await shot("orbit-day-clear")
    await openControls(page, "Environment")
    await page.getByRole("button", { name: "Clouds", exact: true }).click()
    const cloudy = await shot("orbit-day-clouds")
    const cloudDiff = await diff(clear, cloudy)
    assert.ok(cloudDiff.changed > 5000, "cloud layer changes rendered pixels")
    const wind = await page.evaluate(
      () => window.probe.map.earth.environment.uniforms.cloudTime.value,
    )
    await page.waitForTimeout(500)
    assert.ok(
      (await page.evaluate(
        () => window.probe.map.earth.environment.uniforms.cloudTime.value,
      )) > wind,
    )
    await page.setViewportSize({ width: 390, height: 844 })
    await openControls(page, "Explore")
    await page.getByLabel("Visit a city").selectOption("Boston")
    await settle()
    await shot("mobile-boston")
    const samples = await page.evaluate(() => {
      clearInterval(window.layerTimer)
      return window.layerSamples
    })
    observations.maxPending = Math.max(...samples.map(s => s.pending))
    observations.maxCache = Math.max(...samples.map(s => s.cache))
    observations.maxCacheBytes = Math.max(
      ...samples.map(s => s.cacheBytes || 0),
    )
    assert.ok(observations.maxPending <= 4)
    for (const state of samples)
      assert.ok(
        (state.cacheBytes || 0) <=
          Math.max(200 * 1024 * 1024, state.visibleBytes || 0) + 1024 * 1024,
        "native cache does not retain excess offscreen buildings",
      )
    assert.deepEqual(errors, [])
    const report = {
      city,
      rendering,
      nightDiff,
      cloudDiff,
      observations,
      errors,
    }
    await fs.writeFile(
      path.join(output, "metrics.json"),
      JSON.stringify(report, null, 2),
    )
    console.log(JSON.stringify(report, null, 2))
  } finally {
    await browser.close()
  }
}
main().catch(reportFailure)
