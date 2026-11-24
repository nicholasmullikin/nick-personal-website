const assert = require("node:assert/strict")
const { firefox, chromium } = require("playwright")
const base = process.env.EARTH_BACKGROUND_URL || "http://127.0.0.1:8013"
const selector = "[data-earth-background]"
const state = frame => frame.evaluate(() => window.probe.background.state())
async function enter(page) {
  await page.getByRole("button", { name: "Explore Earth", exact: true }).click()
  await page.waitForSelector(selector + '[data-earth-state="ready"]')
  const frame = await (
    await page.locator(selector + " iframe").elementHandle()
  ).contentFrame()
  await frame.waitForFunction(
    () => window.probe?.background.state().interactive,
    null,
    { polling: 50 },
  )
  return frame
}
async function main() {
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
        viewport: { width: 1280, height: 800 },
      })
      page.setDefaultTimeout(60000)
      const errors = []
      page.on("pageerror", e => errors.push(e.message))
      await page.addInitScript(() =>
        addEventListener("earth-ready", e => (window.probe = e.detail)),
      )
      await page.goto(base + "/blog/fedora-43-fixes/")
      await page.mouse.wheel(0, 300)
      await page.waitForTimeout(500)
      const scroll = await page.evaluate(() => scrollY)
      assert.ok(scroll > 0, "reading mode preserves ordinary page scrolling")
      const frame = await enter(page)
      assert.equal(
        await page.locator("main").evaluate(e => !!e.closest("[inert]")),
        true,
      )
      const before = await state(frame)
      await page.mouse.move(640, 390)
      await page.mouse.down()
      await page.mouse.move(800, 450, { steps: 20 })
      await page.mouse.up()
      await page.waitForTimeout(500)
      const dragged = await state(frame)
      assert.ok(
        Math.abs(dragged.longitude - before.longitude) > 2,
        "native drag rotates Earth",
      )
      for (let i = 0; i < 15; i++) {
        await page.mouse.wheel(0, -30)
        await page.waitForTimeout(30)
      }
      await page.waitForTimeout(500)
      const zoomed = await state(frame)
      assert.ok(
        zoomed.distance < dragged.distance,
        "trackpad zoom changes camera distance",
      )
      assert.ok(
        zoomed.frame > dragged.frame + 2,
        "continuous wheel events do not starve rendering",
      )
      assert.equal(
        await page.evaluate(() => scrollY),
        scroll,
        "exploration does not scroll the article",
      )
      await page.getByRole("button", { name: "Zoom in", exact: true }).click()
      await page.waitForTimeout(400)
      assert.ok((await state(frame)).distance < zoomed.distance)
      await page
        .getByRole("button", { name: "Reset view", exact: true })
        .click()
      await page.waitForTimeout(400)
      const reset = await state(frame)
      assert.ok(Math.abs(reset.distance - 11000000) < 1)
      assert.ok(Math.abs(reset.longitude + 30) < 0.001)
      await frame.locator("canvas").focus()
      await page.keyboard.press("ArrowRight")
      await page.waitForTimeout(300)
      const keyed = await state(frame)
      assert.ok(keyed.longitude > reset.longitude + 2)
      await page.keyboard.press("Tab")
      await page.waitForTimeout(100)
      assert.equal(
        await page
          .getByRole("button", { name: "Back to article" })
          .evaluate(e => e === document.activeElement),
        true,
      )
      await page.getByRole("button", { name: "Reset view" }).focus()
      await page.keyboard.press("Tab")
      await page.keyboard.press("Escape")
      await page.waitForSelector('[data-earth-interactive="false"]')
      await page.waitForTimeout(400)
      assert.equal(
        await page
          .getByRole("button", { name: "Explore Earth", exact: true })
          .evaluate(e => e === document.activeElement),
        true,
      )
      assert.equal(
        await page.locator("main").evaluate(e => !!e.closest("[inert]")),
        false,
      )
      const returned = await state(frame)
      assert.ok(
        Math.abs(returned.longitude - keyed.longitude) < 1,
        "camera pose survives returning to article",
      )
      assert.equal(
        frame,
        await (
          await page.locator(selector + " iframe").elementHandle()
        ).contentFrame(),
        "same renderer survives mode switch",
      )
      assert.equal(returned.interactive, false)
      await page.emulateMedia({ reducedMotion: "reduce" })
      await page.waitForSelector(selector + " iframe", { state: "detached" })
      await page.setViewportSize({ width: 390, height: 844 })
      const mobile = await enter(page)
      assert.ok(
        (await state(mobile)).interactive,
        "static-default devices can explicitly opt in",
      )
      if (name === "chromium") {
        const cdp = await page.context().newCDPSession(page)
        await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true })
        const touch = (type, points) =>
          cdp.send("Input.dispatchTouchEvent", {
            type,
            touchPoints: points.map(([x, y], id) => ({ x, y, id })),
          })
        const beforeTouch = await state(mobile)
        await touch("touchStart", [[170, 400]])
        for (let i = 1; i <= 10; i++) {
          await touch("touchMove", [[170 + i * 6, 400]])
          await page.waitForTimeout(30)
        }
        await touch("touchEnd", [])
        await page.waitForTimeout(300)
        const afterTouch = await state(mobile)
        assert.ok(
          Math.abs(afterTouch.longitude - beforeTouch.longitude) > 2,
          "touch drag rotates Earth",
        )
        await touch("touchStart", [
          [160, 400],
          [230, 400],
        ])
        for (let i = 1; i <= 10; i++) {
          await touch("touchMove", [
            [160 - i * 4, 400],
            [230 + i * 4, 400],
          ])
          await page.waitForTimeout(30)
        }
        await touch("touchEnd", [])
        await page.waitForTimeout(300)
        assert.ok(
          (await state(mobile)).distance < afterTouch.distance,
          "pinch zoom changes camera distance",
        )
        await cdp.detach()
      }
      await page.screenshot({
        path: `/tmp/earth-interactive-${name}-mobile.png`,
      })
      await page.getByRole("button", { name: "Back to article" }).click()
      await page.waitForSelector(selector + " iframe", { state: "detached" })
      assert.equal(
        await page
          .locator(selector + " img")
          .evaluate(e => getComputedStyle(e).opacity),
        "1",
      )
      assert.deepEqual(errors, [])
      console.log(
        `${name}: drag, continuous wheel, zoom, reset, keyboard, focus, scroll, preserved renderer, mobile opt-in/disposal passed`,
      )
    } finally {
      await browser.close()
    }
  }
}
main().catch(error => {
  console.error(error)
  process.exitCode = 1
})
