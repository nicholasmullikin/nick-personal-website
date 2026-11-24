// Exercise the public elevation provider on measured coastal terrain, including
// rays through holes and the handoff when the survey is removed.
const assert = require("node:assert/strict")
const { chromium, firefox } = require("playwright")
const {
  mapboxToken,
  installProbe,
  browserErrors,
  previewURL,
  reportFailure,
} = require("./lib/earth-browser.cjs")
async function check() {
  for (const engine of ["chromium", "firefox"]) {
    const browser =
      engine === "firefox"
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
      const page = await browser.newPage({
        viewport: { width: 980, height: 720 },
      })
      const errors = browserErrors(page)
      await installProbe(page)
      // Where a finer raster is unavailable the automatic close-range path
      // should discover an actual USGS survey without a layer toggle.
      await page.route("https://download.mapterhorn.com/**", route =>
        route.fulfill({
          status: 404,
          headers: { "Access-Control-Allow-Origin": "*" },
        }),
      )
      await page.goto(
        previewURL +
          "/harp/rendering_globe-atmosphere.html?layer=relief&view=34.40632,-119.8447,10,260,72,320&mapbox_token=" +
          (await mapboxToken()),
      )
      await page.waitForFunction(() => window.probe?.map.earth.stats.cache > 0)
      await page.waitForFunction(
        () => window.probe.map.earth.survey.stats.visible >= 4,
        null,
        { timeout: 100000 },
      )
      await page.waitForTimeout(1200)
      await page.keyboard.press("d")
      const panel = page.getByRole("region", { name: "Terrain diagnostics" })
      await panel.getByRole("combobox").selectOption("Terrain source")
      await panel.getByRole("button", { name: "Pin center" }).click()
      await page.waitForFunction(() =>
        document.querySelector('section[aria-label="Terrain diagnostics"] pre')
          ?.textContent.includes("Terrain source USGS lidar"),
      )
      if (process.env.EARTH_DIAG_SCREEN)
        await page.screenshot({ path: "/tmp/earth-lidar-source-" + engine + ".jpg" })
      await panel.getByRole("button", { name: "Close" }).click()
      const result = await page.evaluate(() => {
        const map = window.probe.map,
          provider = map.earth.elevationProvider,
          survey = map.earth.survey,
          rect = map.canvas.getBoundingClientRect()
        const hits = [],
          before = map.camera.position.clone()
        for (let y = 0.45; y <= 0.96; y += 0.05)
          for (let x = 0.06; x <= 0.96; x += 0.06) {
            const point = provider.rayCast(x * rect.width, y * rect.height)
            if (!point) continue
            const geo = map.projection.unprojectPoint(point),
              mx = (geo.longitude + 180) / 360,
              my =
                (1 -
                  Math.asinh(Math.tan((geo.latitude * Math.PI) / 180)) /
                    Math.PI) /
                2
            const measured = survey.groundAt(mx, my)
            if (measured === undefined) continue
            hits.push({
              geo,
              elevation: provider.getHeight(geo),
              error: Math.abs(geo.altitude - measured),
            })
          }
        const central = provider.getCameraTarget(map.camera),
          screen = provider.rayCast(rect.width / 2, rect.height / 2)
        const pivot = central && screen ? central.distanceTo(screen) : null
        const cam = map.projection.unprojectPoint(map.camera.position),
          clearance = cam.altitude - provider.getHeight(cam)
        survey.setLidarEnabled(false)
        const deltas = hits
          .map(hit => Math.abs(hit.elevation - provider.getHeight(hit.geo)))
          .sort((a, b) => a - b)
        return {
          count: hits.length,
          p90: hits.map(h => h.error).sort((a, b) => a - b)[
            Math.floor(hits.length * 0.9)
          ],
          pivot,
          clearance,
          maxDelta: deltas.at(-1),
          cameraShift: map.camera.position.distanceTo(before),
          gl: map.renderer.getContext().getError(),
        }
      })
      console.log(engine, result)
      assert.ok(
        result.count >= 15 && result.p90 < 1.4,
        "rays agree with measured ground within mesh simplification error",
      )
      assert.ok(
        result.pivot !== null &&
          result.pivot < 0.2 &&
          result.cameraShift < 0.01,
      )
      assert.ok(result.clearance >= 39 && result.maxDelta > 0.4)
      assert.equal(result.gl, 0)
      assert.deepEqual(errors, [])
    } finally {
      await browser.close()
    }
  }
}
check().catch(reportFailure)
