// Exercise a close view with large windows. Hashing an interpolated seed without
// restoring its 16-bit value produces thousands of pixel-sized holes in panes.
const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const { createRequire } = require("node:module")
const sharp = createRequire(require.resolve("gatsby-plugin-sharp"))("sharp")
const { firefox } = require("playwright")
const { mapboxToken, installProbe, previewURL, reportFailure } = require("./lib/earth-browser.cjs")
async function main() {
  const browser = await firefox.launch({ firefoxUserPrefs: { "webgl.enable-webgl2": false } })
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 850 } })
    const assets = process.env.EARTH_ASSET_DIR
    if (assets) {
      const shared = fs.readdirSync(assets).find(name => /^earth-shared\..*\.js$/.test(name))
      assert.ok(shared, "staged shared bundle exists")
      await context.route("**/harp/*.js*", route => {
        let name = new URL(route.request().url()).pathname.split("/").pop()
        if (name.startsWith("earth-shared.")) name = shared
        const file = path.join(assets, name)
        return fs.existsSync(file)
          ? route.fulfill({ path: file, contentType: "application/javascript" })
          : route.continue()
      })
    }
    const page = await context.newPage(), errors = []
    page.on("pageerror", error => errors.push(error.message))
    await installProbe(page)
    const token = await mapboxToken()
    await page.goto(`${previewURL}/harp/rendering_globe-atmosphere.html?mapbox_token=${token}`)
    await page.waitForFunction(() => window.probe?.map.earth.environment.status.noiseReady, null, { timeout: 60000 })
    await page.evaluate(() => {
      window.probe.map.lookAt({ target: { latitude: 40.751, longitude: -73.986, altitude: 20 }, distance: 320, tilt: 70, heading: 22 })
      window.probe.map.update()
    })
    await page.waitForFunction(() => {
      const map = window.probe.map
      const entry = map.visibleTileSet.dataSourceTileList.find(e => e.dataSource.name === "buildings")
      return map.earth.buildings.stats.buildings > 50 && entry?.allVisibleTileLoaded
    }, null, { timeout: 90000 })
    await page.waitForTimeout(4000)
    await page.getByRole("button", { name: "Environment", exact: true }).click()
    await page.getByRole("button", { name: "Night", exact: true }).click()
    await page.waitForTimeout(1400)
    const screenshot = await page.screenshot()
    if (process.env.EARTH_TEST_SCREENSHOT) fs.writeFileSync(process.env.EARTH_TEST_SCREENSHOT, screenshot)
    const pixels = await sharp(screenshot).extract({ left: 420, top: 300, width: 600, height: 500 }).removeAlpha().raw().toBuffer()
    let bright = 0, transitions = 0
    for (let y = 0; y < 500; y++) {
      let previous = false
      for (let x = 0; x < 600; x++) {
        const i = (y * 600 + x) * 3
        const lit = pixels[i] + pixels[i + 1] + pixels[i + 2] > 210
        bright += Number(lit)
        if (x && lit !== previous) transitions++
        previous = lit
      }
    }
    assert.equal(errors.length, 0, errors.join("\n"))
    assert.ok(bright > 2000 && bright < 150000, `expected lit and dark window pixels, got ${bright}`)
    assert.ok(transitions < 18000, `window panes show pixel noise: ${transitions} transitions`)
    console.log(`WebGL1 night panes: ${bright} bright pixels, ${transitions} transitions`)
  } finally {
    await browser.close()
  }
}
main().catch(reportFailure)
