import assert from "node:assert/strict"
import { chromium } from "playwright"

const base = process.env.SITE_URL || "http://localhost:9000"
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || "/usr/bin/google-chrome",
  args: ["--no-sandbox"],
})
try {
  const page = await browser.newPage()
  const errors = []
  page.on("pageerror", e => errors.push(e.message))
  page.setDefaultTimeout(10000)
  for (const width of [1280, 768, 375, 320]) {
    console.log(`Checking ${width}px`)
    await page.setViewportSize({ width, height: 900 })
    await page.goto(`${base}/blog/x11-focus-bug/`)
    await page
      .getByRole("heading", {
        name: "Why Firefox looked focused while Slack got my typing.",
        exact: true,
      })
      .waitFor()
    await page.waitForLoadState("networkidle")
    const diagram = page.locator("#x11-layered-architecture")
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
      `overflow at ${width}`,
    )
    for (const [name, title, sample] of [
      ["Missing argument", "Missing callback argument", "drop-performed"],
      ["Future timestamp", "Future timestamp", "1413247760"],
      ["Real timestamp", "Real X server timestamp", "116326755"],
      ["Key event", "A keyboard event", "keycode: 38"],
      ["WM_TAKE_FOCUS", "WM_TAKE_FOCUS", "WM_PROTOCOLS"],
    ]) {
      const button = diagram.getByRole("button", { name, exact: true })
      await button.click()
      const tooltip = page.getByRole("tooltip")
      await tooltip.waitFor()
      assert.equal(await tooltip.locator("strong").textContent(), title)
      assert.ok((await tooltip.locator("p").textContent()).length > 40)
      assert.ok((await tooltip.locator("code").textContent()).includes(sample))
      const box = await tooltip.boundingBox()
      assert.ok(box.x >= 0 && box.x + box.width <= width + 1)
      await page.keyboard.press("Escape")
      await tooltip.waitFor({ state: "hidden" })
    }
    await diagram
      .getByRole("button", { name: "Missing argument", exact: true })
      .focus()
    await page.getByRole("tooltip").waitFor()
    await page.keyboard.press("Escape")
    await page.screenshot({
      path: `/tmp/x11-post-${width}.png`,
      fullPage: true,
    })
  }
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.evaluate(() => window.__setPreferredTheme("dark"))
  await page
    .locator("#x11-layered-architecture")
    .screenshot({ path: "/tmp/x11-post-dark.png" })
  const underlined = page
    .locator('.desktop-layers [data-example-target="takefocus"] tspan')
    .filter({ hasText: "WM_TAKE_FOCUS" })
    .first()
  await underlined.evaluate(element =>
    element.scrollIntoView({ block: "center" }),
  )
  await underlined.hover()
  await page.getByRole("tooltip").waitFor()
  await page.getByRole("tooltip").hover()
  await page.waitForTimeout(300)
  assert.equal(await page.getByRole("tooltip").isVisible(), true)
  await page.locator("#x11-layered-architecture .legend").hover()
  await page.getByRole("tooltip").waitFor({ state: "hidden" })
  await page
    .getByRole("button", { name: "Missing argument", exact: true })
    .click()
  await page.getByRole("tooltip").waitFor()
  await page.mouse.click(5, 5)
  await page.getByRole("tooltip").waitFor({ state: "hidden" })
  const touch = await browser.newContext({
    viewport: { width: 375, height: 812 },
    hasTouch: true,
    isMobile: true,
  })
  const mobile = await touch.newPage()
  await mobile.goto(`${base}/blog/x11-focus-bug/`)
  await mobile.waitForLoadState("networkidle")
  const tap = mobile.getByRole("button", {
    name: "Missing argument",
    exact: true,
  })
  await tap.tap()
  await mobile.getByRole("tooltip").waitFor()
  await tap.tap()
  await mobile.getByRole("tooltip").waitFor({ state: "hidden" })
  await touch.close()
  // Gatsby client navigation must unmount/remount without stale popovers/listeners.
  await page.goto(base)
  await page
    .getByRole("link", { name: /Why Firefox looked focused/ })
    .first()
    .click()
  await page.locator("#x11-layered-architecture").waitFor()
  await page
    .getByRole("button", { name: "Missing argument", exact: true })
    .click()
  await page.getByRole("tooltip").waitFor()
  await page.goBack()
  await page.getByRole("tooltip").waitFor({ state: "hidden" })
  await page.goForward()
  await page
    .getByRole("button", { name: "Missing argument", exact: true })
    .click()
  await page.getByRole("tooltip").waitFor()
  assert.deepEqual(errors, [])
  const noJS = await browser.newContext({ javaScriptEnabled: false })
  const ssr = await noJS.newPage()
  await ssr.goto(`${base}/blog/x11-focus-bug/`)
  assert.ok(
    (await ssr.locator("#x11-layered-architecture svg text").count()) > 30,
  )
  console.log(
    "Focus article: responsive, examples, keyboard, navigation and SSR checks passed",
  )
} finally {
  await browser.close()
}
