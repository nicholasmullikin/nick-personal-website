// Production mobile page must defer unrelated demo vendors and retain the 2D fallback.
const assert = require("node:assert/strict")
const { chromium } = require("playwright")
const base = process.env.EARTH_BACKGROUND_URL || "http://127.0.0.1:8013"
async function main() {
  const browser = await chromium.launch({ args: ["--disable-gpu", "--use-gl=swiftshader", "--enable-unsafe-swiftshader"] })
  try {
    for (const scenario of ["map", "fallback", "article"]) {
      const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
      const errors = [], scripts = new Map()
      try {
        page.on("pageerror", error => errors.push(error.message))
        page.on("response", async response => {
          const url = new URL(response.url())
          if (url.origin !== base || !url.pathname.endsWith(".js")) return
          try { scripts.set(url.pathname, (await response.body()).length) } catch { /* page may navigate */ }
        })
        await page.route("**/harp/rendering_globe-atmosphere.html?*", route => route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Earth iframe</title>" }))
        if (scenario === "fallback") await page.addInitScript(() => {
          const get = HTMLCanvasElement.prototype.getContext
          HTMLCanvasElement.prototype.getContext = function (type, ...args) {
            return type === "webgl" || type === "webgl2" ? null : get.call(this, type, ...args)
          }
        })
        await page.goto(`${base}${scenario === "article" ? "/blog/maps/" : "/blog/earth/?terrain=mapterhorn"}`, { waitUntil: "networkidle" })
        if (scenario === "map") {
          const frame = page.locator('iframe[title="harp.gl globe with atmosphere"]')
          await frame.waitFor({ timeout: 30000 })
          await page.waitForFunction(() => document.querySelector('iframe[title="harp.gl globe with atmosphere"]')?.getAttribute("src")?.includes("terrain=mapterhorn"), null, { timeout: 10000 })
          assert.ok(![...scripts.keys()].some(name => name.includes("earth-demo-ol")), "full-screen map loaded OpenLayers")
          assert.ok([...scripts.values()].every(bytes => bytes < 250000), "full-screen map loaded an unrelated large demo bundle")
        } else if (scenario === "fallback") {
          await page.locator('[aria-label="Interactive 2D map"]').waitFor({ state: "attached", timeout: 30000 })
          assert.ok([...scripts.keys()].some(name => name.includes("earth-demo-ol")), "fallback did not load OpenLayers")
        } else {
          await page.getByRole("heading", { name: /Three\.js/ }).first().scrollIntoViewIfNeeded()
          await page.waitForTimeout(3000)
          assert.ok([...scripts.keys()].some(name => name.includes("earth-demo-ol")), "visible article demo did not load its map vendor")
        }
        assert.deepEqual(errors, [], `${scenario}: page errors`)
        console.log(`${scenario}: passed (${scripts.size} JavaScript requests)`)
      } finally { await page.close() }
    }
  } finally { await browser.close() }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
