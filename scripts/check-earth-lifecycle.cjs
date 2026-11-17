const { openControls } = require("./lib/earth-browser.cjs")
const { chromium } = require("playwright"),
  assert = require("node:assert/strict"),
  fs = require("node:fs/promises"),
  path = require("node:path")
const {
  previewURL,
  mapboxToken,
  installProbe,
  browserErrors,
  reportFailure,
  settleImagery,
} = require("./lib/earth-browser.cjs")
async function main() {
  const browser = await chromium.launch({ headless: true }),
    token = await mapboxToken(),
    output = path.resolve(process.argv[2] || "/tmp/earth-lifecycle")
  await fs.mkdir(output, { recursive: true })
  try {
    const page = await browser.newPage({
        viewport: { width: 1000, height: 650 },
      }),
      errors = browserErrors(page)
    await installProbe(page)
    await page.addInitScript(() => {
      window.liveIntervals = new Set()
      const set = window.setInterval,
        clear = window.clearInterval
      window.setInterval = function (...args) {
        const id = set(...args)
        window.liveIntervals.add(id)
        return id
      }
      window.clearInterval = function (id) {
        window.liveIntervals.delete(id)
        return clear(id)
      }
    })
    const url = `${previewURL}/harp/rendering_globe-atmosphere.html?mapbox_token=${token}`
    for (let cycle = 0; cycle < 2; cycle++) {
      await page.goto(url)
      await page.waitForFunction(() => !!window.probe?.map.earth)
      await settleImagery(page)
      await page.keyboard.press("2")
      await settleImagery(page)
      assert.equal(
        await page.evaluate(() => {
          let count = 0
          for (const e of window.probe.map.visibleTileSet.dataSourceTileList)
            if (e.dataSource.name === "terrain")
              for (const t of e.renderedTiles.values())
                for (const o of t.objects)
                  if (o.isMesh && o.material.uniforms?.overlayMode.value === 1)
                    count++
          return count > 0
        }),
        true,
        "contour mode remains supported",
      )
      await page.keyboard.press("c")
      await page.keyboard.press("1")
      await settleImagery(page)
      await page.evaluate(() => {
        dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true }))
        dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }))
      })
      assert.equal(
        await page.evaluate(() => window.probe.map.disposed),
        false,
        "history-cache page is retained",
      )
      await openControls(page, "Explore")
      await page.getByLabel("Visit a city").selectOption("New York")
      await page.waitForTimeout(400)
      await page.evaluate(() => {
        window.probe.map.dispose()
        window.probe.map.earth.dispose()
      })
      await page.waitForTimeout(2500)
      const after = await page.evaluate(() => ({
        disposed: window.probe.map.disposed,
        intervals: window.liveIntervals.size,
        controls: document.querySelectorAll("#earth-controls").length,
        geometries: window.probe.map.renderer.info.memory.geometries,
      }))
      assert.equal(after.disposed, true)
      assert.equal(after.intervals, 0)
      assert.equal(after.controls, 0)
      assert.equal(
        after.geometries,
        0,
        "all uploaded geometry is released at map disposal",
      )
      console.log({ cycle, ...after })
    }
    assert.deepEqual(errors, [])
    await fs.writeFile(
      path.join(output, "metrics.json"),
      JSON.stringify({ cycles: 2, errors }, null, 2),
    )
  } finally {
    await browser.close()
  }
}
main().catch(reportFailure)
