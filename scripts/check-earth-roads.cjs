// Optional roads must stay cold by default/day, then load and dispose on demand.
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path")
const { chromium, firefox } = require("playwright")
const { createRequire } = require("node:module")
const sharp = createRequire(require.resolve("gatsby-plugin-sharp"))("sharp")
const { mapboxToken, installProbe, previewURL, reportFailure, browserErrors } = require("./lib/earth-browser.cjs")
async function main() {
  const token = await mapboxToken()
  for (const [name, engine, launch] of [
    ["chromium", chromium, { args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] }],
    ["firefox-webgl1", firefox, { firefoxUserPrefs: { "webgl.enable-webgl2": false } }],
  ]) {
    const browser = await engine.launch(launch)
    try {
      const context = await browser.newContext({ viewport: { width: 960, height: 720 } })
      const assets = process.env.EARTH_ASSET_DIR
      if (assets) {
        const shared = fs.readdirSync(assets).find(name => /^earth-shared\..*\.js$/.test(name))
        assert.ok(shared)
        await context.route("**/harp/*.js*", route => {
          let name = new URL(route.request().url()).pathname.split("/").pop()
          if (name.startsWith("earth-shared.")) name = shared
          const file = path.join(assets, name)
          return fs.existsSync(file) ? route.fulfill({ path: file, contentType: "application/javascript" }) : route.continue()
        })
      }
      const page = await context.newPage(), errors = browserErrors(page), requests = []
      page.on("request", request => { if (request.url().includes("earth-road-worker")) requests.push(request.url()) })
      await installProbe(page)
      await page.goto(`${previewURL}/harp/rendering_globe-atmosphere.html?mapbox_token=${token}`)
      await page.waitForFunction(() => window.probe?.map.earth.environment.status.noiseReady, null, { timeout: 60000 })
      await page.evaluate(() => {
        const map = window.probe.map
        map.earth.setSunHour(14)
        map.earth.environment.setClouds(false)
        map.lookAt({ target: { latitude: 40.751, longitude: -73.986, altitude: 45 }, distance: 5000, tilt: 60, heading: 22 })
        map.update()
      })
      await page.waitForTimeout(1500)
      assert.equal(await page.evaluate(() => window.probe.map.earth.roads.stats.enabled), false)
      assert.equal(requests.length, 0, `${name}: worker loaded by default`)
      await page.getByRole("button", { name: "Environment", exact: true }).click()
      const toggle = page.getByRole("button", { name: "Stylized night roads", exact: true })
      assert.equal(await toggle.getAttribute("aria-pressed"), "false")
      if (await toggle.isDisabled()) { console.log(`${name}: capability fallback disabled the control`); continue }
      await toggle.click()
      await page.waitForTimeout(1000)
      assert.equal(await page.evaluate(() => window.probe.map.earth.roads.stats.requests), 0, `${name}: day requested road tiles`)
      assert.equal(requests.length, 0, `${name}: worker loaded during daylight`)
      await page.evaluate(() => {
        window.probe.map.earth.buildings.setEnabled(false)
        window.probe.map.earth.setSunHour(23)
      })
      await page.waitForFunction(() => window.probe.map.earth.roads.stats.active, null, { timeout: 60000 })
      const active = await page.evaluate(() => ({ ...window.probe.map.earth.roads.stats }))
      assert.ok(active.features > 0 && active.requests > 0 && active.cache <= 20, JSON.stringify(active))
      assert.equal(await page.evaluate(() => window.probe.map.earth.buildings.stats.active), false, `${name}: road test should work without buildings`)
      assert.ok(requests.length > 0, `${name}: lazy worker request missing`)
      await page.waitForFunction(() => {
        let found=false
        window.probe.map.scene.traverse(object => { if (object.material?.defines?.EARTH_STYLIZED_ROADS) found=true })
        return found
      }, null, { timeout: 15000 })
      await page.evaluate(() => window.probe.map.renderSync())
      const on = await page.screenshot({ path: `/tmp/earth-roads-${name}.png` })
      await page.evaluate(() => { window.probe.map.earth.roads.setEnabled(false); window.probe.map.renderSync() })
      await page.waitForTimeout(300)
      const offImage = await page.screenshot()
      const pixels = image => sharp(image).extract({left:330,top:100,width:600,height:550}).removeAlpha().raw().toBuffer()
      const a=await pixels(on), b=await pixels(offImage)
      let changed=0
      for(let i=0;i<a.length;i+=3) if(Math.max(Math.abs(a[i]-b[i]),Math.abs(a[i+1]-b[i+1]),Math.abs(a[i+2]-b[i+2]))>2) changed++
      assert.ok(changed>100, `${name}: road mask did not visibly affect the ground (${changed} pixels)`)
      await page.evaluate(() => window.probe.map.earth.roads.setEnabled(true))
      await page.waitForFunction(() => window.probe.map.earth.roads.stats.active, null, { timeout: 60000 })
      const beforePan = await page.evaluate(() => window.probe.map.earth.roads.stats.uploads)
      await page.evaluate(() => {
        const map=window.probe.map
        map.lookAt({ target: { latitude: 40.751, longitude: -73.94, altitude: 45 }, distance: 5000, tilt: 60, heading: 22 })
        map.update()
      })
      await page.waitForFunction(previous => window.probe.map.earth.roads.stats.uploads > previous, beforePan, { timeout: 60000 })
      assert.ok(await page.evaluate(() => window.probe.map.earth.roads.stats.cache <= 20), `${name}: pan exceeded the road cache bound`)
      await page.evaluate(() => window.probe.map.earth.setSunHour(14))
      await page.waitForFunction(() => !window.probe.map.earth.roads.stats.active)
      const afterDay = await page.evaluate(() => ({ ...window.probe.map.earth.roads.stats }))
      assert.equal(afterDay.enabled, true); assert.equal(afterDay.active, false)
      await toggle.click()
      await page.waitForFunction(() => !window.probe.map.earth.roads.stats.enabled)
      const off = await page.evaluate(() => ({ ...window.probe.map.earth.roads.stats }))
      assert.equal(off.cache, 0); assert.equal(off.enabled, false)
      assert.deepEqual(errors, [])
      console.log(`${name}: day idle, ${active.features} mapped features, bounded cache, disabled cleanly`)
    } finally { await browser.close() }
  }
}
main().catch(reportFailure)
