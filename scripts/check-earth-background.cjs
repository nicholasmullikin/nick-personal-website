const assert = require("node:assert/strict")
const fs = require("node:fs/promises")
const { chromium, firefox } = require("playwright")
const base = process.env.EARTH_BACKGROUND_URL || "http://127.0.0.1:8013"
const article = "/blog/fedora-43-fixes/"
const selector = "[data-earth-background]"
async function setup(page, options = {}) {
  await page.addInitScript(options => {
    window.addEventListener("earth-ready", event => {
      window.probe = event.detail
    })
    if (options.saveData)
      Object.defineProperty(navigator, "connection", {
        value: {
          saveData: true,
          addEventListener() {},
          removeEventListener() {},
        },
      })
    if (options.lowMemory)
      Object.defineProperty(navigator, "deviceMemory", { value: 2 })
    if (options.noGL) {
      const get = HTMLCanvasElement.prototype.getContext
      HTMLCanvasElement.prototype.getContext = function (type, ...args) {
        return /webgl/.test(type) ? null : get.call(this, type, ...args)
      }
    }
  }, options)
}
async function ready(page) {
  await page.waitForSelector(selector + '[data-earth-state="ready"]', {
    timeout: 60000,
  })
  return (
    await page.locator(selector + " iframe").elementHandle()
  ).contentFrame()
}
const state = frame => frame.evaluate(() => window.probe.background.state())
async function paused(frame, reason) {
  await frame.page().waitForTimeout(300)
  const before = await state(frame)
  await frame.page().waitForTimeout(700)
  assert.deepEqual(await state(frame), before, reason)
  return before
}
async function main() {
  const results = []
  for (const [name, engine, config] of [
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
    const browser = await engine.launch(config)
    try {
      const page = await browser.newPage({
        viewport: { width: 1440, height: 900 },
        deviceScaleFactor: 2,
      })
      const errors = [],
        requests = []
      page.on("pageerror", e => errors.push(e.message))
      page.on("request", r => requests.push(r.url()))
      await setup(page)
      await page.goto(base + article)
      let frame = await ready(page)
      await page.evaluate(() => {
        window.originalBackground = document.querySelector(
          "[data-earth-background] iframe",
        )
      })
      const cloudDrawsBefore = await frame.evaluate(
        () => window.probe.environment.cloudStats.draws,
      )
      const before = await state(frame)
      await page.waitForTimeout(3000)
      const after = await state(frame)
      assert.ok(
        after.frame - before.frame <= 19 && after.frame > before.frame,
        "six FPS ceiling",
      )
      assert.ok(after.longitude > before.longitude, "globe spins")
      assert.ok(
        after.pixels > 650000 && after.pixels <= 1200000,
        "sharp resolution with a DPR-independent budget",
      )
      assert.ok(
        requests.some(url => /\/harp\/earth-background\.bundle(?:\.[a-f0-9]{12})?\.js(?:\?.*)?$/.test(url)),
        "runs the source-built Earth renderer",
      )
      assert.ok(
        requests.some(url => url.endsWith("/earth-background/surface.webp")),
        "loads 4096px surface",
      )
      assert.equal(
        requests.some(url => /decoder.bundle|mapbox|\.pbf(?:\?|$)/.test(url)),
        false,
        "orbital view does not stream terrain or building tiles",
      )
      const cloudStats = await frame.evaluate(
        () => window.probe.environment.cloudStats,
      )
      assert.ok(
        cloudStats.draws - cloudDrawsBefore <=
          (after.frame - before.frame + 1) * 2,
        "cloud volume and reconstruction run once per displayed frame",
      )
      assert.equal(cloudStats.steps, 24, "actual volumetric cloud renderer")
      assert.equal(
        await page
          .locator(selector)
          .evaluate(e => getComputedStyle(e).pointerEvents),
        "none",
      )
      await page.screenshot({
        path: `/tmp/earth-real-background-${name}-light.png`,
      })
      await page
        .getByRole("button", { name: "Dark theme", exact: true })
        .click()
      await page.screenshot({
        path: `/tmp/earth-real-background-${name}-dark.png`,
      })
      assert.ok(
        (await state(frame)).longitude >= after.longitude,
        "theme does not reset orbit",
      )
      await page.setViewportSize({ width: 1366, height: 768 })
      await page.waitForTimeout(600)
      assert.ok(
        (await state(frame)).longitude >= after.longitude,
        "resize does not reset orbit",
      )
      await frame.evaluate(() =>
        dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true })),
      )
      const cached = await paused(
        frame,
        "pagehide pauses before bfcache freeze",
      )
      await frame.evaluate(() =>
        dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true })),
      )
      await page.waitForTimeout(500)
      assert.ok((await state(frame)).frame > cached.frame, "pageshow resumes")
      await page.evaluate(() => {
        window.scrolling = setInterval(
          () => dispatchEvent(new Event("scroll")),
          80,
        )
      })
      await paused(frame, "scroll pauses without resetting")
      await page.evaluate(() => clearInterval(window.scrolling))
      await page.waitForTimeout(500)
      await page
        .getByRole("button", { name: "Pause Earth background", exact: true })
        .click()
      const stopped = await paused(frame, "explicit pause retains view")
      const programs = await frame.evaluate(
        () => window.probe.map.renderer.info.programs.length,
      )
      const backgroundRequests = requests.filter(url =>
        /\/earth-background\/|\/harp\//.test(url),
      ).length
      await frame.evaluate(() => {
        dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true }))
        dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }))
      })
      await paused(frame, "pageshow respects the user's explicit pause")
      await page
        .getByRole("button", { name: "Animate Earth background", exact: true })
        .click()
      await page.evaluate(() => scrollTo(0, 0))
      await page.waitForTimeout(700)
      assert.ok(
        (await state(frame)).longitude >= stopped.longitude,
        "resume preserves longitude",
      )
      assert.ok(
        (await state(frame)).frame > stopped.frame,
        "resume continues existing renderer",
      )
      assert.equal(
        await frame.evaluate(
          () => window.probe.map.renderer.info.programs.length,
        ),
        programs,
        "resume reuses compiled shaders",
      )
      assert.equal(
        requests.filter(url => /\/earth-background\/|\/harp\//.test(url))
          .length,
        backgroundRequests,
        "resume does not fetch Earth resources again",
      )
      await page.evaluate(() => window.___navigate("/blog/nanlite-fs300b/"))
      await page.waitForURL("**/blog/nanlite-fs300b/")
      await page.waitForTimeout(700)
      assert.equal(
        await page.evaluate(
          () =>
            window.originalBackground ===
            document.querySelector("[data-earth-background] iframe"),
        ),
        true,
        "article navigation retains the iframe itself",
      )
      assert.ok(
        (await state(frame)).longitude >= stopped.longitude,
        "article navigation keeps orbit",
      )
      await page.evaluate(() => {
        Object.defineProperty(document, "hidden", {
          configurable: true,
          value: true,
        })
        document.dispatchEvent(new Event("visibilitychange"))
      })
      await paused(frame, "hidden tab pauses")
      await page.evaluate(() => {
        delete document.hidden
        document.dispatchEvent(new Event("visibilitychange"))
      })
      await page.evaluate(() => {
        const canvas = document.createElement("canvas")
        canvas.id = "busy-article"
        canvas.style.cssText =
          "position:fixed;inset:100px;width:300px;height:300px"
        document.querySelector("main").append(canvas)
      })
      await paused(frame, "visible interactive content pauses")
      await page.evaluate(() =>
        document.getElementById("busy-article").remove(),
      )
      await page.waitForTimeout(500)
      const saved = await state(frame)
      await page.getByRole("link", { name: "Home", exact: true }).click()
      await page.waitForTimeout(300)
      assert.equal(await page.locator(selector).count(), 0)
      await page.goBack()
      frame = await ready(page)
      assert.ok(
        Math.abs((await state(frame)).longitude - saved.longitude) < 2,
        "re-created view restores session orbit",
      )
      assert.deepEqual(errors, [])
      results.push({
        browser: name,
        before,
        after,
        cloudStats,
        persistence: "passed",
        errors,
      })
      await page.close()
      for (const scenario of [
        "reducedMotion",
        "mobile",
        "saveData",
        "lowMemory",
        "noGL",
        "assetFailure",
      ]) {
        const context = await browser.newContext({
          viewport:
            scenario === "mobile"
              ? { width: 390, height: 844 }
              : { width: 1440, height: 900 },
          reducedMotion:
            scenario === "reducedMotion" ? "reduce" : "no-preference",
        })
        const p = await context.newPage()
        await setup(p, { [scenario]: true })
        if (scenario === "assetFailure")
          await p.route("**/harp/resources/earth/cloud-coverage*.webp", route =>
            route.fulfill({ status: 404, body: "unavailable" }),
          )
        await p.goto(base + article)
        await p.waitForTimeout(3000)
        assert.equal(
          await p.locator(selector).getAttribute("data-earth-state"),
          "static",
          name + " " + scenario,
        )
        if (scenario !== "noGL" && scenario !== "assetFailure")
          assert.equal(
            await p.locator(selector + " iframe").count(),
            0,
            "constrained devices do not load the renderer",
          )
        if (scenario === "mobile")
          await p.screenshot({
            path: `/tmp/earth-real-background-${name}-mobile.png`,
          })
        results.push({ browser: name, scenario, passed: true })
        await context.close()
      }
    } finally {
      await browser.close()
    }
  }
  await fs.writeFile(
    "/tmp/earth-real-background-results.json",
    JSON.stringify(results, null, 2),
  )
  console.log(JSON.stringify(results, null, 2))
}
main().catch(error => {
  console.error(error)
  process.exitCode = 1
})
