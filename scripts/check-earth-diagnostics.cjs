const assert = require("node:assert/strict")
const fs = require("node:fs/promises")
const { chromium, firefox } = require("playwright")
const {
  previewURL,
  installProbe,
  browserErrors,
  mapboxToken,
  reportFailure,
} = require("./lib/earth-browser.cjs")
async function main() {
  const browser =
    process.env.EARTH_BROWSER === "firefox"
      ? await firefox.launch({
          firefoxUserPrefs: {
            "webgl.force-enabled": true,
            "webgl.enable-webgl2": false,
          },
        })
      : await chromium.launch({
          args: [
            "--enable-gpu",
            "--use-angle=vulkan",
            "--enable-features=Vulkan",
            "--use-vulkan=native",
          ],
        })
  try {
    const page = await browser.newPage({
      viewport: process.env.EARTH_DIAG_4K
        ? { width: 3840, height: 2160 }
        : { width: 1280, height: 800 },
    })
    const errors = browserErrors(page)
    page.on("pageerror", e => console.error(e.message))
    await installProbe(page)
    const url = new URL("/harp/rendering_globe-atmosphere.html", previewURL)
    const city = process.env.EARTH_DIAG_CITY === "1"
    url.searchParams.set(
      "view",
      city ? "40.751,-73.986,20,320,70,22" : "49.95,-123.04,1650,3500,68,330",
    )
    url.searchParams.set("mapbox_token", await mapboxToken())
    await page.goto(url.href)
    await page.waitForFunction(() => window.probe?.map.earth)
    if (city)
      await page.waitForFunction(
        () => window.probe.map.earth.buildings.stats.buildings > 50,
        null,
        { timeout: 60000 },
      )
    await page.getByRole("button", { name: "Layers", exact: true }).click()
    await page
      .getByRole("button", { name: "Terrain diagnostics", exact: true })
      .click()
    const panel = page.getByRole("region", { name: "Terrain diagnostics" })
    await panel.waitFor()
    await panel.getByRole("button", { name: "Pin center" }).click()
    await page.waitForFunction(() =>
      document
        .querySelector('section[aria-label="Terrain diagnostics"] pre')
        .textContent.match(/Pin (49|40)\./),
    )
    const select = panel.getByRole("combobox")
    for (const mode of await select.locator("option").allTextContents()) {
      await select.selectOption(mode)
      await page.evaluate(
        () =>
          new Promise(resolve => {
            const m = window.probe.map,
              cb = () => {
                m.removeEventListener("didrender", cb)
                resolve()
              }
            m.addEventListener("didrender", cb)
            m.update()
          }),
      )
      assert.deepEqual(errors, [])
      if (
        process.env.EARTH_DIAG_SCREEN &&
        [
          "Terrain source",
          "Hierarchy",
          "Best resident patch",
          "Imagery pages",
          "Overdraw",
          "Depth",
        ].includes(mode)
      )
        await page.screenshot({ path: "/tmp/earth-diag-" + mode + ".jpg" })
    }
    await select.selectOption("Inspector")
    for (const box of await panel.getByRole("checkbox").all()) {
      await box.check()
      assert.ok(await box.isChecked())
    }
    const imageryRequests = await page.evaluate(
      () => window.probe.map.earth.stats.requests,
    )
    await page.evaluate(() => {
      const m = window.probe.map
      m.lookAt({
        target: m.target,
        distance: m.targetDistance,
        tilt: 65,
        heading: m.heading,
      })
      m.update()
    })
    await page.waitForTimeout(400)
    assert.equal(
      await page.evaluate(() => window.probe.map.earth.stats.requests),
      imageryRequests,
    )
    await panel.getByText("Capture last 5 s", { exact: true }).click()
    const download = page.waitForEvent("download")
    await panel.getByText("Export capture", { exact: true }).click()
    const capture = JSON.parse(
      await fs.readFile(await (await download).path(), "utf8"),
    )
    assert.ok(capture.frames.some(f => f.owner !== "—" && f.cam.distance > 0))
    assert.ok(capture.frames.some(f => f.terrainSource && f.terrainSource !== "Unknown"))
    assert.ok(capture.frames.some(f => Number.isFinite(f.step)))
    assert.ok(capture.frames.some(f => f.cullCounts || f.selectionStop))
    if (process.env.EARTH_DIAG_4K)
      assert.deepEqual(capture.frames.at(-1).buffer, [3840, 2160])
    console.log(
      "Captured",
      capture.frames.length,
      "frames",
      await panel.locator("pre").textContent(),
    )
    await panel.getByText("Replay camera", { exact: true }).click()
    await panel.getByText("Replay complete").waitFor()
    await panel.getByRole("button", { name: "Close" }).click()
    assert.equal(await panel.isVisible(), false)
    assert.equal(
      await page.evaluate(
        () => !!window.probe.map.getDataSourceByName("terrain").diagnostic,
      ),
      false,
    )
    assert.deepEqual(errors, [])
  } finally {
    await browser.close()
  }
}
main().catch(reportFailure)
