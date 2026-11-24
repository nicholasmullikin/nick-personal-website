// Fake only the RAF timestamp to exercise a long pre-ready pause without
// sleeping for 30 seconds. Hold the coverage image to keep startup incomplete.
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path")
const { chromium, firefox } = require("playwright")
const base = process.env.EARTH_BACKGROUND_URL || "http://127.0.0.1:8013"
async function main() {
  for (const [name, engine] of [["chromium", chromium], ["firefox", firefox]]) {
    const browser = await engine.launch(name === "chromium" ? { args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] } : {})
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
      let releaseCoverage
      const blocked = new Promise(resolve => { releaseCoverage = resolve })
      await context.route("**/cloud-coverage*.webp", async route => { await blocked; await route.continue() })
      const page = await context.newPage()
      await page.addInitScript(() => {
        const raf = window.requestAnimationFrame.bind(window)
        window.requestAnimationFrame = callback => raf(timestamp => callback(timestamp + (window.testRafOffset || 0)))
        window.addEventListener("earth-ready", event => { window.probe = event.detail })
        window.addEventListener("message", event => {
          if (event.data?.type === "earth-background-failed") window.backgroundFailed = true
        })
      })
      await page.goto(base + "/harp/earth-background.html", { waitUntil: "domcontentloaded" })
      await page.waitForFunction(() => window.probe?.background.state().frame > 1, null, { timeout: 30000 })
      await page.evaluate(() => { window.probe.background.setPaused(true); window.testRafOffset = 35000 })
      const priorFrame = await page.evaluate(() => window.probe.background.state().frame)
      await page.evaluate(() => window.probe.background.setPaused(false))
      await page.waitForFunction(previous => window.backgroundFailed || window.probe.background.state().frame > previous, priorFrame, { timeout: 15000 })
      assert.equal(await page.evaluate(() => !!window.backgroundFailed), false, `${name}: paused startup falsely timed out`)
      releaseCoverage()
      await page.waitForFunction(() => window.probe.imagery.ready && window.probe.environment.status.noiseReady && window.probe.environment.status.cloudReady && window.probe.environment.status.nightReady, null, { timeout: 30000 })
      assert.ok(await page.evaluate(() => window.probe.background.state().frame > 1))
      console.log(`${name}: startup survived a simulated 35s paused interval`)
    } finally { await browser.close() }
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
