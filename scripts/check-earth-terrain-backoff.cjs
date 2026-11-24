// Camera motion during an endpoint-wide failure should retain terrain without flooding the provider.
const assert = require("node:assert/strict")
const { chromium } = require("playwright")
const {
  installProbe,
  mapboxToken,
  browserErrors,
  previewURL,
  reportFailure,
} = require("./lib/earth-browser.cjs")

async function exercise(browser, token, status) {
  const page = await browser.newPage({ viewport: { width: 960, height: 720 } })
  try {
    await installProbe(page)
    const errors = browserErrors(page)
    let offline = true
    const attempts = []
    await page.route("**/mapbox.terrain-rgb/**", route => {
      attempts.push({ time: Date.now(), offline })
      return offline
        ? route.fulfill({
            status,
            headers: {
              "Retry-After": "2",
              "Access-Control-Allow-Origin": "*",
              "Access-Control-Expose-Headers": "Retry-After",
            },
            body: "Provider unavailable",
          })
        : route.continue()
    })
    const url = new URL("/harp/rendering_globe-atmosphere.html", previewURL)
    url.searchParams.set("mapbox_token", token)
    url.searchParams.set("view", "34.40632,-119.8447,10,260,72,320")
    await page.goto(url.href)
    await page.waitForFunction(() => window.probe?.map.earth)
    for (let i = 0; i < 10; i++) {
      await page.evaluate(i => {
        const m = window.probe.map
        m.earth.environment.setClouds(false)
        m.lookAt({
          target: {
            latitude: 34.40632 + i * 0.013,
            longitude: -119.8447 + i * 0.009,
            altitude: 120,
          },
          distance: 650,
          tilt: 65,
          heading: 320 + i * 9,
        })
        m.update()
      }, i)
      await page.waitForTimeout(230)
    }
    const rejected = attempts.length
    assert.ok(
      rejected > 0 && rejected <= 16,
      `HTTP ${status} caused ${rejected} requests`,
    )
    offline = false
    if (status === 401) {
      await page.waitForTimeout(2300)
      assert.equal(attempts.length, rejected)
    } else {
      await page.waitForFunction(
        () => {
          const m = window.probe.map
          return m.earth.elevationProvider.getHeight(m.target) > 100
        },
        null,
        { timeout: 20000 },
      )
      assert.ok(attempts.length > rejected)
    }
    assert.deepEqual(errors, [])
    console.log(`HTTP ${status} produced ${rejected} rejected requests`)
  } finally {
    await page.close()
  }
}
;(async () => {
  const browser = await chromium.launch({
    args: [
      "--enable-gpu",
      "--use-angle=vulkan",
      "--enable-features=Vulkan",
      "--use-vulkan=native",
    ],
  })
  try {
    const token = await mapboxToken()
    for (const status of [429, 401, 503]) await exercise(browser, token, status)
  } finally {
    await browser.close()
  }
})().catch(reportFailure)
