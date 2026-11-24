// Deliberately blocking GPU completion is confined to this offline benchmark.
// Production uses asynchronous timer queries and never calls finish/readPixels.
const fs = require("node:fs/promises")
const { firefox, chromium } = require("playwright")
const base = process.env.EARTH_BACKGROUND_URL || "http://127.0.0.1:8011"
const label = process.env.EARTH_PERF_LABEL || "current"
async function main() {
  const browser =
    process.env.EARTH_PERF_BROWSER === "chromium"
      ? await chromium.launch({
          args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
        })
      : await firefox.launch({
          firefoxUserPrefs: {
            "webgl.enable-webgl2": false,
            "privacy.reduceTimerPrecision": false,
          },
        })
  try {
    const page = await browser.newPage({
      viewport: { width: 1440, height: 900 },
    })
    const errors = []
    page.on("pageerror", e => errors.push(e.message))
    await page.addInitScript(() => {
      sessionStorage.setItem(
        "earth-background-orbit-v1",
        JSON.stringify({
          longitude: -30,
          latitude: 20,
          distance: 11000000,
          heading: 0,
          cloudTime: 0,
        }),
      )
      addEventListener("earth-ready", e => (window.probe = e.detail))
    })
    await page.goto(base + "/harp/earth-background.html")
    await page.waitForFunction(
      () =>
        window.probe?.imagery.ready &&
        window.probe.environment.status.cloudReady &&
        window.probe.environment.status.noiseReady &&
        window.probe.environment.status.nightReady,
      null,
      { polling: 50, timeout: 60000 },
    )
    const frame = page
    await page.evaluate(source => {
      const factory = new Function("return (" + source + ")")()
      window.measureProfiler =
        window.probe.background.performance || factory(window.probe.map)
    }, require("./lib/earth-source.cjs").load("performance.js").createProfiler.toString())
    await frame.evaluate(() => {
      const p = window.probe
      p.background.setPaused(true)
      p.map.lookAt({
        target: { latitude: 20, longitude: -30 },
        distance: 11000000,
        tilt: 0,
        heading: 0,
      })
      const update = p.environment.update
      p.environment.update = mode => update(mode, 0)
      p.environment.uniforms.cloudTime.value = 0
    })
    const results = []
    for (const [clouds, moving] of [
      [true, false],
      [true, true],
      [false, true],
    ]) {
      results.push(
        await frame.evaluate(
          async options => {
            const [clouds, moving] = options
            const p = window.probe,
              gl = p.map.renderer.getContext()
            p.environment.setClouds(clouds)
            const cpu = [],
              completed = [],
              pixel = new Uint8Array(4)
            const frameBefore = p.map.frameNumber
            for (let i = 0; i < 60; i++) {
              await new Promise(resolve => requestAnimationFrame(resolve))
              if (i === 20) window.measureProfiler.reset?.()
              if (moving)
                p.map.lookAt({
                  target: { latitude: 20, longitude: -30 + i * 0.05 },
                  distance: 11000000,
                  tilt: 0,
                  heading: 0,
                })
              const start = performance.now()
              p.map.renderSync()
              const submitted = performance.now()
              gl.readPixels(
                Math.floor(gl.drawingBufferWidth / 2),
                Math.floor(gl.drawingBufferHeight / 2),
                1,
                1,
                gl.RGBA,
                gl.UNSIGNED_BYTE,
                pixel,
              )
              if (i >= 20) {
                cpu.push(submitted - start)
                completed.push(performance.now() - start)
              }
            }
            const stats = values => {
              values.sort((a, b) => a - b)
              return {
                median: values[Math.floor(values.length / 2)],
                p95: values[Math.floor(values.length * 0.95)],
              }
            }
            return {
              clouds,
              moving,
              frames: p.map.frameNumber - frameBefore,
              pixel: [...pixel],
              calls: p.map.renderer.info.render.calls,
              lost: gl.isContextLost(),
              cpuMs: stats(cpu),
              completedFrameMs: stats(completed),
              pixels: p.background.state().pixels,
              profile: window.measureProfiler.snapshot(),
            }
          },
          [clouds, moving],
        ),
      )
      if (clouds && !moving) {
        await page.screenshot({ path: `/tmp/earth-performance-${label}.png` })
      }
    }
    if (errors.length) throw new Error(errors.join("\n"))
    await fs.writeFile(
      `/tmp/earth-performance-${label}.json`,
      JSON.stringify(results, null, 2),
    )
    console.log(JSON.stringify(results, null, 2))
  } finally {
    await browser.close()
  }
}
main().catch(e => {
  console.error(e)
  process.exitCode = 1
})
