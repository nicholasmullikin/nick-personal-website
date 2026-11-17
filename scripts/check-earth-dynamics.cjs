const {
  previewURL,
  mapboxToken,
  reportFailure,
  installProbe,
  browserErrors,
  settleImagery,
} = require("./lib/earth-browser.cjs")
// Exercise the hosted Earth preview while imagery is delayed and one request fails.
// Run with the preview running: node scripts/check-earth-dynamics.cjs
const { chromium } = require("playwright")
const fs = require("node:fs/promises"),
  path = require("node:path"),
  assert = require("node:assert/strict")
const base = previewURL
const output = path.resolve(process.argv[2] || "/tmp/earth-dynamics")
async function main() {
  await fs.mkdir(output, { recursive: true })
  const token = await mapboxToken()
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage({
        viewport: { width: 1000, height: 650 },
      }),
      errors = browserErrors(page)
    await installProbe(page)
    let injectedFailure = false
    await page.route("**/mapbox.satellite/**", async route => {
      const z = Number(new URL(route.request().url()).pathname.split("/")[3])
      if (z >= 5) await new Promise(r => setTimeout(r, 250))
      if (z >= 8 && !injectedFailure) {
        injectedFailure = true
        await route.abort("failed")
        return
      }
      await route.continue()
    })
    await page.goto(
      `${base}/harp/rendering_globe-atmosphere.html?mapbox_token=${token}`,
    )
    await page.waitForFunction(() => window.probe?.map.earth)
    await page.evaluate(() => {
      window.observations = {
        samples: 0,
        greenFrames: 0,
        intermediateFades: 0,
        fallbackFrames: 0,
        maxPending: 0,
        minFar: Infinity,
        maxFar: 0,
        logDepth: window.probe.map.renderer.capabilities.logarithmicDepthBuffer,
      }
      window.sampling = setInterval(() => {
        const { map } = window.probe,
          o = window.observations,
          s = map.earth.stats
        o.samples++
        o.maxPending = Math.max(o.maxPending, s.pending)
        if (s.fallback > 0) o.fallbackFrames++
        o.minFar = Math.min(o.minFar, map.camera.far)
        o.maxFar = Math.max(o.maxFar, map.camera.far)
        for (const e of map.visibleTileSet.dataSourceTileList)
          if (e.dataSource.name === "terrain")
            for (const t of e.renderedTiles.values())
              for (const mesh of t.objects)
                if (mesh.isMesh) {
                  const m = mesh.material
                  if (m.color?.getHex() === 0x558855) o.greenFrames++
                  const u = m.uniforms
                  if (
                    u?.blend?.value > 0 &&
                    u.blend.value < 1 &&
                    u.fromMap.value !== u.toMap.value
                  )
                    o.intermediateFades++
                }
      }, 80)
    })
    const settle = () => settleImagery(page)
    await settle()
    const move = async view =>
      page.evaluate(v => window.probe.map.lookAt(v), view)
    for (const zoom of [
      8.5, 9, 9.5, 10, 10.5, 11, 11.5, 11, 10.5, 10, 9.5, 9,
    ]) {
      await move({
        target: { latitude: 36.1, longitude: -112.15, altitude: 1600 },
        zoomLevel: zoom,
        tilt: 68,
        heading: 28,
      })
      await page.waitForTimeout(250)
    }
    await settle()
    await page.screenshot({ path: path.join(output, "canyon.png") })
    await page.evaluate(() => window.probe.map.earth.setSunHour(2))
    await move({
      target: { latitude: 27.9, longitude: 86.8, altitude: 4800 },
      zoomLevel: 13.5,
      tilt: 85,
      heading: 0,
    })
    await settle()
    const ground = []
    for (const heading of [-0.4, -0.2, 0, 0.2, 0.4, 0]) {
      await move({
        target: { latitude: 27.9, longitude: 86.8, altitude: 4800 },
        zoomLevel: 13.5,
        tilt: 85,
        heading,
      })
      await page.waitForTimeout(200)
      ground.push(
        await page.evaluate(() => ({
          altitude: window.probe.map.camera.position.length() - 6378137,
          near: window.probe.map.camera.near,
          far: window.probe.map.camera.far,
          tiles: window.probe.map.visibleTileSet.dataSourceTileList.find(
            e => e.dataSource.name === "terrain",
          )?.renderedTiles.size,
        })),
      )
    }
    await settle()
    await page.screenshot({ path: path.join(output, "ground-himalayas.png") })
    await page.evaluate(() => window.probe.map.earth.setSunHour(16.8))
    await move({
      target: { latitude: 36.1, longitude: -112.15, altitude: 1600 },
      zoomLevel: 12.5,
      tilt: 86,
      heading: 250,
    })
    await settle()
    await page.screenshot({ path: path.join(output, "sunset.png") })
    await page.evaluate(() => window.probe.map.earth.setSunHour(6))
    await move({
      target: { latitude: 20, longitude: 0 },
      zoomLevel: 2.4,
      tilt: 0,
      heading: 0,
    })
    await settle()
    await page.screenshot({ path: path.join(output, "orbit.png") })
    const result = await page.evaluate(() => {
      clearInterval(window.sampling)
      return { ...window.observations, final: window.probe.map.earth.stats }
    })
    assert.ok(injectedFailure, "failure injection must execute")
    assert.equal(result.greenFrames, 0, "no green terrain placeholder frames")
    assert.ok(
      result.intermediateFades > 0,
      "observe actual intermediate shader blends",
    )
    assert.ok(
      result.fallbackFrames > 0,
      "observe ancestor imagery during delayed loads",
    )
    assert.ok(result.maxPending <= 8, "bounded imagery concurrency")
    assert.ok(result.logDepth, "logarithmic depth enabled")
    for (const g of ground) {
      assert.ok(g.far > 300000, "retain distant mountains near ground")
      assert.ok(g.tiles > 0)
      assert.ok(
        g.altitude > 4000,
        "camera stays above the Himalayan surface while turning",
      )
      assert.ok(g.near <= 10, "nearby terrain remains visible")
    }
    assert.equal(result.final.pending, 0)
    assert.ok(
      result.final.cache <= 160,
      "cache bound restored after refinement",
    )
    assert.deepEqual(errors, [], "no page or shader errors")
    await fs.writeFile(
      path.join(output, "metrics.json"),
      JSON.stringify({ result, ground }, null, 2) + "\n",
    )
    console.log(JSON.stringify({ result, ground }, null, 2))
  } finally {
    await browser.close()
  }
}
main().catch(reportFailure)
