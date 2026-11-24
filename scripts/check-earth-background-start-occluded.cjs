// An initially visible article demo should defer even fetching the background.
const assert = require("node:assert/strict")
const { chromium, firefox } = require("playwright")
const base = process.env.EARTH_BACKGROUND_URL || "http://127.0.0.1:8013"
const article = "/blog/fedora-43-fixes/"
async function main() {
  for (const [name, engine] of [["chromium", chromium], ["firefox", firefox]]) {
    const browser = await engine.launch()
    try {
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
      const earthRequests = []
      page.on("request", request => {
        const pathname = new URL(request.url()).pathname
        if (/\/harp\/earth-background|\/earth-background\/(?:surface|lights)|\/cloud-(?:noise|coverage)/.test(pathname))
          earthRequests.push(pathname)
      })
      await page.goto(base + article, { waitUntil: "domcontentloaded" })
      await page.waitForSelector("main")
      await page.evaluate(() => {
        const media = document.createElement("canvas")
        media.id = "occlusion-test-media"
        media.style.cssText = "position:fixed;inset:0;width:100vw;height:100vh;z-index:2"
        document.querySelector("main").appendChild(media)
      })
      await page.waitForTimeout(5000)
      assert.equal(await page.locator("[data-earth-background] iframe").count(), 0, `${name}: renderer mounted while article media was visible`)
      assert.deepEqual(earthRequests, [], `${name}: renderer assets fetched while article media was visible`)
      await page.locator("#occlusion-test-media").evaluate(node => node.remove())
      await page.waitForSelector("[data-earth-background] iframe", { timeout: 15000 })
      await page.waitForFunction(() => document.querySelector("[data-earth-background]")?.getAttribute("data-earth-state") === "ready", null, { timeout: 60000 })
      assert.ok(earthRequests.some(url => /earth-background\.bundle(?:\.[a-f0-9]{12})?\.js(?:\?.*)?$/.test(url)), `${name}: renderer did not load after media cleared`)
      await page.goto(base + article, { waitUntil: "domcontentloaded" })
      await page.waitForSelector("main")
      await page.evaluate(() => {
        const media = document.createElement("canvas")
        media.id = "occlusion-test-media"
        media.style.cssText = "position:fixed;inset:0;width:100vw;height:100vh;z-index:2"
        document.querySelector("main").appendChild(media)
      })
      await page.waitForTimeout(2000)
      assert.equal(await page.locator("[data-earth-background] iframe").count(), 0)
      await page.getByRole("button", { name: "Explore Earth", exact: true }).evaluate(button => button.click())
      await page.waitForSelector("[data-earth-background] iframe", { timeout: 15000 })
      await page.waitForFunction(() => document.querySelector("[data-earth-background]")?.getAttribute("data-earth-state") === "ready", null, { timeout: 60000 })
      console.log(`${name}: occluded assets deferred, resumed after media cleared, explicit explore works`)
    } finally { await browser.close() }
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
