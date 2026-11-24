// Reproduce the wide, short Firefox viewport in the 2026-11-17 screencast.
const assert = require("node:assert/strict")
const fs = require("node:fs/promises")
const { firefox, chromium } = require("playwright")
const base = process.env.EARTH_BACKGROUND_URL || "http://127.0.0.1:8013"
const url = base + "/blog/fedora-43-fixes/"
const bg = "[data-earth-background]"
async function ready(page) {
  await page.waitForSelector(bg + '[data-earth-state="ready"]', {
    timeout: 60000,
  })
  const frame = await (
    await page.locator(bg + " iframe").elementHandle()
  ).contentFrame()
  await frame.evaluate(() => window.probe.background.setPaused(true))
  await page.waitForFunction(
    () =>
      getComputedStyle(document.querySelector("[data-earth-background] iframe"))
        .opacity === "1",
    null,
    { polling: 50 },
  )
  return frame
}
async function camera(frame) {
  return frame.evaluate(() => ({
    fov: window.probe.map.camera.fov,
    aspect: window.probe.map.camera.aspect,
    altitude: window.probe.map.camera.position.length() - 6378137,
    longitude: window.probe.background.state().longitude,
    projection: window.probe.map.camera.projectionMatrix.elements.slice(),
  }))
}
async function main() {
  const results = []
  for (const [name, engine, options] of [
    [
      "firefox",
      firefox,
      { firefoxUserPrefs: { "webgl.enable-webgl2": false } },
    ],
    [
      "chromium",
      chromium,
      { args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] },
    ],
  ]) {
    const browser = await engine.launch(options)
    try {
      const page = await browser.newPage({
        viewport: { width: 2478, height: 1452 },
      })
      const errors = []
      page.on("pageerror", e => errors.push(e.message))
      await page.addInitScript(() =>
        window.addEventListener("earth-ready", event => {
          window.probe = event.detail
        }),
      )
      // Hold the live bundle to inspect the loading state reliably.
      let release
      const gate = new Promise(resolve => {
        release = resolve
      })
      await page.route(/\/earth-background\.bundle(?:\.[a-f0-9]{12})?\.js(?:\?.*)?$/, async route => {
        await gate
        await route.continue()
      })
      await page.goto(url, { waitUntil: "domcontentloaded" })
      await page.waitForSelector(bg + " iframe", { state: "attached" })
      assert.equal(
        await page
          .locator(bg + " img")
          .evaluate(e => getComputedStyle(e).opacity),
        "0",
        "do not show a fixed-pose poster behind a restored live orbit",
      )
      release()
      let frame = await ready(page)
      const original = await camera(frame)
      await frame.evaluate(() => window.probe.background.setPaused(false))
      await page.setViewportSize({ width: 2478, height: 762 })
      await page.waitForTimeout(500)
      frame = await ready(page)
      const resized = await camera(frame)
      await page.screenshot({ path: `/tmp/earth-framing-${name}-resized.png` })
      await page.reload()
      frame = await ready(page)
      const reloaded = await camera(frame)
      assert.ok(
        Math.abs(resized.fov - reloaded.fov) < 0.0001,
        "resize and reload use the same field of view",
      )
      for (let i = 0; i < resized.projection.length; i++)
        assert.ok(
          Math.abs(resized.projection[i] - reloaded.projection[i]) < 0.0001,
          "same viewport must produce the same projection",
        )
      assert.ok(
        Math.abs(resized.altitude - reloaded.altitude) < 1,
        "camera distance does not jump",
      )
      assert.ok(
        Math.abs(resized.longitude - reloaded.longitude) < 1,
        "restored orbit is continuous",
      )
      assert.equal(
        await page
          .locator(bg + " img")
          .evaluate(e => getComputedStyle(e).opacity),
        "0",
        "no second globe during live fade",
      )
      await page.screenshot({ path: `/tmp/earth-framing-${name}-reloaded.png` })
      await page.emulateMedia({ reducedMotion: "reduce" })
      await page.waitForTimeout(300)
      assert.equal(await page.locator(bg + " iframe").count(), 0)
      const poster = await page.locator(bg + " img").evaluate(e => ({
        height: e.getBoundingClientRect().height,
        width: e.getBoundingClientRect().width,
        opacity: getComputedStyle(e).opacity,
      }))
      assert.equal(poster.opacity, "1")
      assert.equal(poster.height, 762)
      assert.ok(
        Math.abs(poster.width - 762 * 1.6) < 1,
        "poster scales by height rather than cover-cropping",
      )
      const nojs = await browser.newPage({
        javaScriptEnabled: false,
        viewport: { width: 2478, height: 762 },
      })
      await nojs.goto(url)
      assert.equal(
        await nojs
          .locator(bg + " img")
          .evaluate(e => getComputedStyle(e).opacity),
        "1",
        "no-JavaScript visitors retain the poster",
      )
      assert.deepEqual(errors, [])
      results.push({ name, original, resized, reloaded, poster, errors })
    } finally {
      await browser.close()
    }
  }
  await fs.writeFile(
    "/tmp/earth-framing-results.json",
    JSON.stringify(results, null, 2),
  )
  console.log(JSON.stringify(results, null, 2))
}
main().catch(error => {
  console.error(error)
  process.exitCode = 1
})
