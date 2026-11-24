// A settled map may reuse its frustum selection. Data arrivals still get
// processed, and a changed camera, projection size or source must select again.
const assert = require("node:assert/strict")
const { chromium } = require("playwright")
const {
  installProbe,
  browserErrors,
  previewURL,
  reportFailure,
} = require("./lib/earth-browser.cjs")

async function main() {
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage({
      viewport: { width: 420, height: 300 },
    })
    const errors = browserErrors(page)
    await installProbe(page)
    await page.goto(previewURL + "/harp/rendering_globe-atmosphere.html")
    await page.waitForFunction(() => window.probe?.map.earth)
    const counts = await page.evaluate(() => {
      const map = window.probe.map
      map.earth.environment.setClouds(false)
      const intersection = map.visibleTileSet.m_frustumIntersection,
        compute = intersection.compute
      const source = map.visibleTileSet.dataSourceTileList.find(
        x => x.dataSource.name === "terrain",
      ).dataSource
      let count = 0
      intersection.compute = function (...args) {
        count++
        return compute.apply(this, args)
      }
      const render = () => {
        count = 0
        map.renderSync()
        return count
      }
      try {
        map.lookAt({
          target: { latitude: 28, longitude: -110, altitude: 0 },
          distance: 120000,
          tilt: 30,
          heading: 20,
        })
        render()
        const stationary = Array.from({ length: 4 }, render)
        source.stationaryTileSelectionRevision++
        const revised = render(),
          afterRevision = render()
        map.resize(480, 260)
        const resized = render(),
          afterResize = render()
        map.lookAt({
          target: { latitude: 45, longitude: 12, altitude: 0 },
          distance: 190000,
          tilt: 40,
          heading: 60,
        })
        const moved = render(),
          afterMove = render()
        return {
          stationary,
          revised,
          afterRevision,
          resized,
          afterResize,
          moved,
          afterMove,
        }
      } finally {
        intersection.compute = compute
      }
    })
    assert.deepEqual(counts.stationary, [0, 0, 0, 0])
    for (const k of ["revised", "resized", "moved"]) assert.ok(counts[k] > 0, k)
    for (const k of ["afterRevision", "afterResize", "afterMove"])
      assert.equal(counts[k], 0, k)
    assert.deepEqual(errors, [])
    console.log(counts)
  } finally {
    await browser.close()
  }
}
main().catch(reportFailure)
