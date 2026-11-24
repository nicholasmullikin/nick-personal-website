// Verify source-native city light pages, including a date-line crossing.
const { chromium, firefox } = require("playwright")
const assert = require("node:assert/strict")
const fs = require("node:fs/promises")
const path = require("node:path")
const {
  installProbe,
  mapboxToken,
  browserErrors,
  reportFailure,
} = require("./lib/earth-browser.cjs")
async function main() {
  const out = path.resolve(process.argv[2] || "/tmp/earth-night-detail")
  await fs.mkdir(out, { recursive: true })
  const url = new URL(
    "/harp/rendering_globe-atmosphere.html",
    process.env.EARTH_PREVIEW_URL || "http://127.0.0.1:8014",
  )
  url.searchParams.set("mapbox_token", await mapboxToken())
  for (const name of ["chromium", "firefox"]) {
    const b =
      name === "chromium"
        ? await chromium.launch({
            args: [
              "--enable-gpu",
              "--use-angle=vulkan",
              "--enable-features=Vulkan",
              "--use-vulkan=native",
            ],
          })
        : await firefox.launch({
            firefoxUserPrefs: { "webgl.enable-webgl2": false },
          })
    try {
      const p = await b.newPage({ viewport: { width: 960, height: 640 } }),
        errors = browserErrors(p)
      await installProbe(p)
      await p.goto(url.href, { waitUntil: "domcontentloaded" })
      await p.waitForFunction(
        () => window.probe?.map.earth.environment.status.nightReady,
      )
      const setView = ([latitude, longitude, night]) =>
        p.evaluate(
          ({ latitude, longitude, night }) => {
            const m = window.probe.map
            m.earth.environment.setClouds(false)
            m.earth.setSunHour(
              ((night ? 24 : 12) - (longitude + 112.15) / 15 + 48) % 24,
            )
            m.lookAt({
              target: { latitude, longitude, altitude: 0 },
              distance: 24000,
              tilt: 58,
              heading: 35,
            })
          },
          { latitude, longitude, night },
        )
      await setView([40.74, -73.98, false])
      await p.waitForTimeout(800)
      let state = await p.evaluate(() => ({
        ...window.probe.map.earth.environment.status,
      }))
      assert.equal(
        state.nightPageRequests,
        0,
        "daylight must not allocate native night imagery",
      )
      await setView([40.74, -73.98, true])
      await p.waitForFunction(
        () =>
          window.probe.map.earth.environment.uniforms.nightDetailFade.value ===
          1,
      )
      await p.waitForTimeout(1000)
      await p.screenshot({ path: path.join(out, name + "-ny.png") })
      const first = await p.evaluate(() => {
        const e = window.probe.map.earth.environment,
          u = e.uniforms
        return {
          id: e.status.nightPage,
          baseWidth: u.nightMap.value.image.width,
          pageWidth: u.nightDetailMap.value.image.width,
        }
      })
      assert.deepEqual(first, { id: "5-2", baseWidth: 2048, pageWidth: 1024 })
      await setView([-17, 179.8, true])
      await p.waitForFunction(
        () => window.probe.map.earth.environment.status.nightPage === "0-5",
      )
      const sent = await p.evaluate(
        () => window.probe.map.earth.environment.status.nightPageRequests,
      )
      await setView([-17, -179.8, true])
      await p.waitForTimeout(500)
      assert.equal(
        await p.evaluate(
          () => window.probe.map.earth.environment.status.nightPageRequests,
        ),
        sent,
      )
      await setView([-17, -179.8, false])
      await p.waitForFunction(
        () => !window.probe.map.earth.environment.uniforms.nightDetailMap.value,
      )
      assert.deepEqual(errors, [])
      console.log(name, first, { requests: sent })
    } finally {
      await b.close()
    }
  }
}
main().catch(reportFailure)
