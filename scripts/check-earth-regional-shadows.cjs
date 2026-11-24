// A low morning sun reaches Yosemite through terrain beyond the local shadow map.
const assert = require("node:assert/strict")
const { chromium, firefox } = require("playwright")
const {
  installProbe,
  browserErrors,
  mapboxToken,
  previewURL,
  reportFailure,
  settleImagery,
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
      viewport: { width: 680, height: 440 },
    })
    const errors = browserErrors(page),
      started = []
    page.on("request", r => {
      if (r.url().includes("/terrain-base-v1/")) started.push(r.url())
    })
    await installProbe(page)
    const url = new URL("/harp/rendering_globe-atmosphere.html", previewURL)
    url.searchParams.set("mapbox_token", await mapboxToken())
    url.searchParams.set("view", "37.7445,-119.5943,1215,1900,78,32")
    await page.goto(url.href)
    await page.waitForFunction(() => !!window.probe?.map?.earth)
    await page.evaluate(() => {
      const { map } = window.probe
      map.earth.environment.setClouds(false)
      map.earth.buildings.setEnabled(false)
      map.earth.setSunHour((8 + (-112.15 + 119.5943) / 15 + 24) % 24)
    })
    await settleImagery(page)
    assert.equal(
      started.length,
      0,
      "healthy live terrain downloaded without a regional shadow field",
    )
    await page.evaluate(() => window.probe.map.earth.shadows.setEnabled(true))
    await page.waitForFunction(
      () => window.probe.map.earth.shadows.stats.regional,
      {},
      { timeout: 30000 },
    )
    const result = await page.evaluate(() => {
      const { map } = window.probe,
        gl = map.renderer.getContext()
      const original = map.prepareRenderTiles
      let suppress = false,
        atlas
      map.prepareRenderTiles = entries => {
        original(entries)
        for (const entry of entries)
          for (const tile of entry.renderedTiles.values())
            for (const object of tile.objects) {
              const mat = object.material
              if (
                !mat?.defines?.EARTH_SUN_SHADOW ||
                !mat.uniforms.regionalSunEnabled
              )
                continue
              atlas = mat.uniforms.nightMap.value.image
              if (suppress) mat.uniforms.regionalSunEnabled.value = 0
            }
      }
      function capture() {
        map.renderSync()
        const p = new Uint8Array(
          gl.drawingBufferWidth * gl.drawingBufferHeight * 4,
        )
        gl.readPixels(
          0,
          0,
          gl.drawingBufferWidth,
          gl.drawingBufferHeight,
          gl.RGBA,
          gl.UNSIGNED_BYTE,
          p,
        )
        return p
      }
      try {
        suppress = true
        const local = capture()
        suppress = false
        const regional = capture()
        let changed = 0
        for (let i = 0; i < local.length; i += 4)
          if (Math.abs(local[i] - regional[i]) > 2) changed++
        return {
          changed,
          pixels: local.length / 4,
          width: atlas.width,
          height: atlas.height,
          bytes: map.earth.shadows.stats.regionalBytes,
          updates: map.earth.shadows.stats.regionalUpdates,
          glError: gl.getError(),
        }
      } finally {
        map.prepareRenderTiles = original
        map.earth.shadows.setEnabled(false)
      }
    })
    assert.equal(result.glError, 0, "shadow shaders link and draw successfully")
    assert.equal(result.height - result.width, 33)
    assert.ok(
      result.changed > result.pixels * 0.004,
      "the regional field shades a visible portion of the valley",
    )
    assert.ok(
      result.bytes > 0 && result.bytes < 256 * 1024 && result.updates >= 1,
    )
    assert.equal(
      await page.evaluate(() => window.probe.map.earth.shadows.stats.active),
      false,
    )
    assert.deepEqual(errors, [])
    console.log(result)
  } finally {
    await browser.close()
  }
}
main().catch(reportFailure)
