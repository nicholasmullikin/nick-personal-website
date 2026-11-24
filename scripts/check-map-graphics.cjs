const { openControls } = require("./lib/earth-browser.cjs")
const {
  previewURL,
  reportFailure,
  installProbe,
  browserErrors,
} = require("./lib/earth-browser.cjs")
// Verify the complete page in Firefox with WebGL2 disabled and with all WebGL blocked.
const { chromium, firefox } = require("playwright"),
  assert = require("node:assert/strict"),
  fs = require("node:fs/promises"),
  path = require("node:path")
const base = previewURL,
  output = path.resolve(process.argv[2] || "/tmp/map-graphics")
async function main() {
  await fs.mkdir(output, { recursive: true })
  const results = []
  for (const test of [
    {
      name: "firefox-webgl1",
      engine: firefox,
      options: { firefoxUserPrefs: { "webgl.enable-webgl2": false } },
      fallbacks: 2,
      earth: true,
    },
    {
      name: "firefox-no-webgl",
      engine: firefox,
      options: { firefoxUserPrefs: { "webgl.disabled": true } },
      fallbacks: 4,
      earth: false,
    },
    {
      name: "maplibre-context-rejected",
      engine: chromium,
      options: {},
      fallbacks: 1,
      earth: true,
      rejectMap: true,
    },
    {
      name: "chrome-normal",
      engine: chromium,
      options: {},
      fallbacks: 0,
      earth: true,
    },
  ]) {
    const browser = await test.engine.launch({
      headless: true,
      ...test.options,
    })
    let page,
      errors = []
    try {
      page = await browser.newPage({
        viewport: { width: 1100, height: 850 },
      })
      errors = browserErrors(page)
      if (test.rejectMap)
        await page.addInitScript(() => {
          const original = HTMLCanvasElement.prototype.getContext
          HTMLCanvasElement.prototype.getContext = function (type, ...args) {
            if (
              this.classList.contains("maplibregl-canvas") &&
              /webgl/.test(type)
            )
              return null
            return original.call(this, type, ...args)
          }
        })
      await installProbe(page)
      await page.goto(base + "/blog/maps/")
      await page.waitForFunction(
        () => document.querySelectorAll("h3").length >= 4,
        null,
        { polling: 100, timeout: 60000 },
      )
      for (const viewport of await page.locator("[data-map-viewport]").all()) {
        await viewport.scrollIntoViewIfNeeded()
        await viewport
          .locator("canvas, iframe, [data-testid=map-graphics-fallback]")
          .first()
          .waitFor({ state: "attached" })
      }
      await page.waitForFunction(
        n =>
          document.querySelectorAll('[data-testid="map-graphics-fallback"]')
            .length === n,
        test.fallbacks,
      )
      await page.waitForTimeout(2500)
      let earth = null
      if (test.earth) {
        const iframe = page.locator(
          'iframe[title="harp.gl globe with atmosphere"]',
        )
        await iframe.scrollIntoViewIfNeeded()
        const frame = await iframe.elementHandle().then(e => e.contentFrame())
        await frame.waitForFunction(() => !!window.probe?.map.earth, null, {
          polling: 100,
          timeout: 60000,
        })
        if (test.name === "firefox-webgl1") {
          await openControls(frame, "Explore")
          await frame.getByLabel("Visit a city").selectOption("New York")
          await frame.waitForFunction(
            () => window.probe.map.earth.buildings.stats.buildings > 1000,
            null,
            { timeout: 60000 },
          )
          await openControls(frame, "Environment")
          await frame
            .getByRole("button", { name: "Night", exact: true })
            .click()
        }
        earth = await frame.evaluate(() => {
          const { map } = window.probe,
            gl = map.renderer.getContext()
          return {
            version: gl.getParameter(gl.VERSION),
            buildings: map.earth.buildings.stats.buildings,
          }
        })
        await iframe.screenshot({
          path: path.join(output, test.name + "-earth.png"),
        })
      }
      if (test.fallbacks) {
        const fallback = page.getByTestId("map-graphics-fallback").first()
        await fallback.scrollIntoViewIfNeeded()
        await fallback.getByTitle("Zoom in", { exact: true }).click()
        await page.waitForTimeout(350)
        assert.ok(
          await fallback.locator("canvas").count(),
          "fallback renders a 2D canvas",
        )
      }
      if (test.name === "firefox-webgl1")
        assert.ok(
          await page
            .locator(".maplibregl-canvas")
            .evaluate(c => !!c.getContext("webgl")),
          "MapLibre uses WebGL1",
        )
      assert.deepEqual(
        errors,
        [],
        test.name + " has no unhandled or shader errors",
      )
      assert.ok(
        !(await page.locator("body").innerText()).includes(
          "unhandled runtime error",
        ),
      )
      const result = {
        name: test.name,
        fallbacks: await page.getByTestId("map-graphics-fallback").count(),
        earth,
        errors,
      }
      results.push(result)
      console.log(result)
    } catch (error) {
      console.error(
        test.name,
        JSON.stringify({
          errors,
          body: page
            ? (await page.locator("body").innerText()).slice(-5000)
            : null,
        }),
      )
      if (page)
        await page.screenshot({
          path: path.join(output, test.name + "-failure.png"),
        })
      throw error
    } finally {
      await browser.close()
    }
  }
  await fs.writeFile(
    path.join(output, "results.json"),
    JSON.stringify(results, null, 2),
  )
}
main().catch(reportFailure)
