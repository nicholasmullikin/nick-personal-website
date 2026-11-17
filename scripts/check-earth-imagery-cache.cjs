// A stationary fullscreen city must stop requesting evicted ancestor imagery.
const { firefox } = require("playwright"),
  assert = require("node:assert/strict")
const {
  previewURL,
  mapboxToken,
  installProbe,
  browserErrors,
  settleImagery,
  openControls,
  reportFailure,
} = require("./lib/earth-browser.cjs")
async function main() {
  const browser = await firefox.launch({
    headless: true,
    firefoxUserPrefs: { "webgl.enable-webgl2": false },
  })
  try {
    const page = await browser.newPage({
        viewport: { width: 1000, height: 500 },
      }),
      errors = browserErrors(page)
    await installProbe(page)
    await page.goto(
      `${previewURL}/harp/rendering_globe-atmosphere.html?mapbox_token=${await mapboxToken()}`,
    )
    await page.waitForFunction(() => !!window.probe?.map.earth, null, {
      polling: 100,
    })
    await openControls(page, "Explore")
    await page.getByLabel("Visit a city").selectOption("New York")
    await settleImagery(page)
    await page.setViewportSize({ width: 1366, height: 768 })
    await settleImagery(page)
    const before = await page.evaluate(() => ({
      ...window.probe.map.earth.stats,
    }))
    await page.waitForTimeout(3000)
    const after = await page.evaluate(() => ({
      ...window.probe.map.earth.stats,
    }))
    assert.equal(
      after.requests,
      before.requests,
      "loaded views must not refill evicted lower-resolution ancestors",
    )
    assert.equal(after.pending, 0)
    assert.equal(after.untextured, 0)
    assert.deepEqual(errors, [])
    console.log({ before, after, errors })
  } finally {
    await browser.close()
  }
}
main().catch(reportFailure)
