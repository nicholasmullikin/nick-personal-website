// Replay an exported diagnostics capture at its recorded camera poses and native
// resolution. Use the same projected outline metric as the on-screen inspector.
const fs = require("node:fs/promises")
const path = require("node:path")
const assert = require("node:assert/strict")
const { chromium, firefox } = require("playwright")
const { source } = require("./lib/earth-source.cjs")
const {
  installProbe,
  browserErrors,
  previewURL,
  mapboxToken,
  reportFailure,
} = require("./lib/earth-browser.cjs")
async function main() {
  const { pin, frames } = JSON.parse(await fs.readFile(process.argv[2], "utf8"))
  const [width, height] = frames[0].buffer
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
    const page = await browser.newPage({ viewport: { width, height } })
    await installProbe(page)
    const errors = browserErrors(page)
    const url = new URL("/harp/rendering_globe-atmosphere.html", previewURL)
    url.searchParams.set("mapbox_token", await mapboxToken())
    const c = frames[0].cam
    url.searchParams.set(
      "view",
      [
        c.target.latitude,
        c.target.longitude,
        c.target.altitude,
        c.distance,
        c.tilt,
        c.heading,
      ].join(","),
    )
    await page.goto(url.href)
    await page.waitForFunction(() => window.probe?.map.earth)
    for (const name of [
      "terrain-grid",
      "terrain-sample",
      "diagnostic-surface",
    ]) {
      const js = await fs.readFile(path.join(source, name + ".js"), "utf8")
      await page.addScriptTag({
        content: `{const module={exports:{}};window.surfaceModules??={};const require=n=>window.surfaceModules[n.slice(2)];${js}\nwindow.surfaceModules[${JSON.stringify(name)}]=module.exports;}`,
      })
    }
    await page.waitForFunction(
      ({ pin, level }) => {
        const map = window.probe.map,
          s = window.surfaceModules["diagnostic-surface"]
        const cut = map.visibleTileSet.dataSourceTileList.find(
          e => e.dataSource.name === "terrain",
        )
        return (
          cut &&
          [...cut.renderedTiles.values()].some(
            t => s.contains(t, pin.mx, pin.my) && s.sourceLevel(t) >= level,
          )
        )
      },
      { pin, level: frames[0].elevation },
      { timeout: 90000 },
    )
    await page.waitForTimeout(800)
    const result = await page.evaluate(
      async ({ pin, frames }) => {
        const { map, THREE } = window.probe,
          s = window.surfaceModules["diagnostic-surface"],
          swaps = []
        let previous,
          owner,
          peak = 0,
          minLevel = 99,
          maxCut = 0,
          missing = 0,
          measuredFrames = 0,
          maxSelected = 0
        const ds = map.getDataSourceByName("terrain")
        ds.diagnostic = {}
        let lastDesired
        const start = performance.now()
        for (const f of frames) {
          const delay = start + f.time - frames[0].time - performance.now()
          if (delay > 0) await new Promise(r => setTimeout(r, delay))
          map.lookAt(f.cam)
          await new Promise(resolve => {
            const cb = () => {
              map.removeEventListener("didrender", cb)
              resolve()
            }
            map.addEventListener("didrender", cb)
            map.update()
          })
          const cut = map.visibleTileSet.dataSourceTileList.find(
            e => e.dataSource.name === "terrain",
          )
          const tiles = s.indexTiles(cut.renderedTiles.values())
          const t = tiles.find(t => s.contains(t, pin.mx, pin.my))
          const grid = s.samplePatch(THREE, pin.key, tiles)
          const line = g =>
            s.outline(
              s.projectPatch(THREE, map, g),
              map.canvas.width,
              map.canvas.height,
            )
          const step = previous ? s.difference(line(grid), line(previous)) : 0
          if (previous && Number.isFinite(step)) measuredFrames++
          maxSelected = Math.max(
            maxSelected,
            ds.diagnostic.desired?.length || 0,
          )
          peak = Math.max(peak, step || 0)
          maxCut = Math.max(maxCut, tiles.length)
          if (!t) missing++
          else minLevel = Math.min(minLevel, s.sourceLevel(t))
          const z = t?.tileKey.level
          const desired = ds.diagnostic.desired?.find(e =>
            s.contains(e, pin.mx, pin.my),
          )?.tileKey.level
          if (owner !== z || lastDesired !== desired)
            swaps.push({
              elapsed: f.time - frames[0].time,
              level: z,
              step,
              desired,
            })
          lastDesired = desired
          owner = z
          previous = grid
        }
        return {
          peak,
          minLevel,
          maxCut,
          maxSelected,
          limit: map.visibleTileSet.getNumberOfVisibleTiles(),
          missing,
          measuredFrames,
          swaps,
        }
      },
      { pin, frames },
    )
    console.log(JSON.stringify(result))
    assert.deepEqual(errors, [])
    assert.equal(result.missing, 0)
    assert.ok(result.measuredFrames > 0, "no common visible outline samples")
    assert.ok(
      result.maxSelected <= result.limit,
      "terrain selection exceeded its tile budget",
    )
    if (process.argv[3])
      assert.ok(
        result.peak <= Number(process.argv[3]),
        "outline jump exceeds pixel limit",
      )
  } finally {
    await browser.close()
  }
}
main().catch(reportFailure)
