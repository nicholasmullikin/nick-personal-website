// Synthetic provider responses exercise the real local renderer without
// credentials or remote imagery. EARTH_TEST_STALLED=1 adds the real-time
// zero-byte and decode watchdog cases (at least 15s each).
const assert = require("node:assert/strict")
const { chromium } = require("playwright")
const {
  previewURL,
  installProbe,
  browserErrors,
  reportFailure,
} = require("./lib/earth-browser.cjs")
const fixture = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAP0lEQVR4nGMQkeQSkVwFIZ9Jcj2DkQxwUREk0WeSXAwk62AUuc7FwLCAgSGBgWHBJYYEOJsJzkIjmbCK4tMBAN32L29b67JpAAAAAElFTkSuQmCC",
  "base64",
)
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Expose-Headers": "Retry-After, X-Rate-Limit-Reset",
}
const good = {
  status: 200,
  contentType: "image/png",
  headers: cors,
  body: fixture,
}

async function scenario(browser, kind) {
  const page = await browser.newPage({ viewport: { width: 640, height: 420 } })
  const errors = browserErrors(page),
    denied = [],
    allowed = []
  const requestedFormats = new Map()
  let damagedKey,
    first,
    release,
    released = false
  const held = new Promise(resolve => {
    release = () => {
      released = true
      resolve()
    }
  })
  try {
    await installProbe(page)
    if (kind === "decode")
      await page.addInitScript(size => {
        const decode = window.createImageBitmap,
          waiters = []
        let held = true
        window.releaseRasterDecodes = () => {
          held = false
          for (const done of waiters) done()
        }
        window.createImageBitmap = async (blob, ...options) => {
          const image = await decode.call(window, blob, ...options)
          if (
            held &&
            blob.size === size &&
            options[0]?.imageOrientation === "flipY"
          )
            await new Promise(done => waiters.push(done))
          return image
        }
      }, fixture.length)
    await page.route("**/mapbox.terrain-rgb/**", r =>
      r.fulfill({ status: 404, headers: cors, body: "No elevation tile" }),
    )
    await page.route("**/tile.openstreetmap.org/**", r => r.fulfill(good))
    await page.route("**/mapbox.satellite/**", async r => {
      const now = performance.now()
      first ??= now
      const path = new URL(r.request().url()).pathname
      const tile = path.match(
        /mapbox\.satellite\/(\d+)\/(\d+)\/(\d+)@2x\.(webp|jpg80)$/,
      )
      if (kind === "damaged" && tile) {
        const key = tile.slice(1, 4).join("/")
        if (!damagedKey && Number(tile[1]) >= 10) damagedKey = key
        if (!requestedFormats.has(key)) requestedFormats.set(key, [])
        requestedFormats.get(key).push(tile[4])
        if (key === damagedKey && tile[4] === "webp") {
          denied.push(now - first)
          return r.fulfill({
            status: 200,
            headers: cors,
            contentType: "image/webp",
            body: "Corrupt image",
          })
        }
      }
      if (kind === "transfer" && !released) {
        await held
        // This request may already have been aborted by the watchdog.
        await r.fulfill(good).catch(() => {})
      } else if (
        kind === "authentication" ||
        ((kind === "throttle" || kind === "unavailable") && now - first < 1500)
      ) {
        denied.push(now - first)
        await r.fulfill({
          status:
            kind === "authentication" ? 401 : kind === "throttle" ? 429 : 503,
          headers: { ...cors, "Retry-After": "2" },
          body: "Simulated provider response",
        })
      } else {
        allowed.push(now - first)
        await r.fulfill(good)
      }
    })
    const url = new URL("/harp/rendering_globe-atmosphere.html", previewURL)
    url.searchParams.set("mapbox_token", "local-provider-fixture")
    await page.goto(url.href, { waitUntil: "domcontentloaded" })
    await page.waitForFunction(() => window.probe?.map.earth)
    await page.evaluate(() => {
      const m = window.probe.map
      m.earth.environment.setClouds(false)
      m.lookAt({
        target: { latitude: 34.402, longitude: -119.841, altitude: 8 },
        distance: 1000,
        heading: 310,
        tilt: 67,
      })
    })
    if (kind === "authentication") {
      await page.waitForFunction(() => {
        const m = window.probe.map
        let full = false
        m.scene.traverse(o => {
          if (
            o.material?.uniforms?.fallbackSurface?.value?.image?.width === 4096
          )
            full = true
        })
        return m.earth.stats.providerStatus === "authentication" && full
      })
      const before = denied.length
      await page.evaluate(() => {
        const m = window.probe.map
        m.earth.setMode("b")
        m.lookAt({
          target: { latitude: 45, longitude: 15 },
          distance: 1500,
          heading: 52,
          tilt: 54,
        })
      })
      await page.waitForFunction(() => window.probe.map.earth.stats.cache > 0)
      await page.evaluate(() => window.probe.map.earth.setMode("a"))
      await page.waitForTimeout(300)
      assert.equal(denied.length, before)
      assert.ok(before > 0 && before <= 8)
    } else {
      if (kind === "decode" || kind === "transfer") {
        await page.waitForFunction(
          () => window.probe.map.earth.stats.stalledRequests > 0,
          null,
          { timeout: 45000 },
        )
        if (kind === "decode")
          await page.evaluate(() => window.releaseRasterDecodes())
        release()
      }
      await page.waitForFunction(
        () => {
          const s = window.probe.map.earth.stats
          return (
            s.cache > 0 &&
            !s.pending &&
            !s.fading &&
            s.providerStatus === "ready"
          )
        },
        null,
        { timeout: 45000 },
      )
      if (kind === "throttle" || kind === "unavailable") {
        assert.ok(denied.length >= 1 && denied.length <= 8)
        assert.ok(allowed[0] >= 1950, `early recovery probe at ${allowed[0]}ms`)
      }
    }
    if (kind === "damaged") {
      assert.ok(damagedKey)
      assert.deepEqual(requestedFormats.get(damagedKey), ["webp", "jpg80"])
      assert.ok(requestedFormats.size > 2)
      for (const [key, formats] of requestedFormats)
        if (key !== damagedKey)
          assert.ok(formats.every(format => format === "webp"))
    }
    const s = await page.evaluate(() => ({ ...window.probe.map.earth.stats }))
    assert.deepEqual(errors, [])
    console.log(
      JSON.stringify({
        kind,
        denied: denied.length,
        allowed: allowed.length,
        firstRecoveryMs: allowed[0],
        status: s.providerStatus,
        stalled: s.stalledRequests,
      }),
    )
  } finally {
    release()
    await page.close()
  }
}
async function main() {
  const browser = await chromium.launch()
  try {
    const cases = ["throttle", "unavailable", "authentication", "damaged"]
    if (process.env.EARTH_TEST_STALLED === "1") cases.push("transfer", "decode")
    for (const kind of cases) await scenario(browser, kind)
  } finally {
    await browser.close()
  }
}
main().catch(reportFailure)
