// Exercise panorama residency and URL selection through the real page.
const assert = require("node:assert/strict")
const { chromium } = require("playwright")
const {
  previewURL,
  mapboxToken,
  installProbe,
  browserErrors,
  reportFailure,
} = require("./lib/earth-browser.cjs")

async function check(browser, token) {
  const page = await browser.newPage({ viewport: { width: 640, height: 400 } })
  const urls = [],
    errors = browserErrors(page)
  page.on("request", req => urls.push(new URL(req.url()).pathname))
  let release
  const held = new Promise(resolve => {
    release = resolve
  })
  if (token)
    await page.route("**/earth-background/surface.webp", async route => {
      await held
      await route.continue()
    })
  try {
    await installProbe(page)
    const url = new URL("/harp/rendering_globe-atmosphere.html", previewURL)
    if (token) url.searchParams.set("mapbox_token", token)
    await page.goto(url.href, { waitUntil: "domcontentloaded" })
    await page.waitForFunction(() => window.probe?.map?.earth)
    const width = async expected =>
      page.waitForFunction(
        w => {
          let found = false
          window.probe.map.scene.traverse(node => {
            if (
              node.material?.uniforms?.fallbackSurface?.value?.image?.width ===
              w
            )
              found = true
          })
          return found
        },
        expected,
        { timeout: 45000 },
      )
    const pose = distance =>
      page.evaluate(distance => {
        const m = window.probe.map
        m.earth.environment.setClouds(false)
        m.lookAt({
          target: { latitude: 36.1, longitude: -112.15 },
          distance,
          tilt: 20,
          heading: 0,
        })
        m.update()
      }, distance)
    if (token) {
      await width(1024)
      assert.equal(urls.filter(u => u.endsWith("/surface.webp")).length, 0)
      await Promise.all([
        page.waitForRequest("**/earth-background/surface.webp", {
          timeout: 45000,
        }),
        pose(4500000),
      ])
      await width(1024)
      release()
      await width(4096)
      await pose(90000)
      await page.waitForTimeout(500)
      await pose(4500000)
      await width(4096)
      assert.equal(urls.filter(u => u.endsWith("/surface.webp")).length, 1)
      await pose(90000)
      await width(1024)
    } else {
      await width(4096)
      await page.setViewportSize({ width: 800, height: 390 })
      await pose(28000000)
      await width(1024)
      await pose(15000000)
      await width(2048)
      await pose(4500000)
      await width(4096)
      const two = urls.filter(u => u.endsWith("/surface-2k.webp"))
      assert.equal(
        two.length,
        1,
        "the medium-distance view uses the 2K panorama once",
      )
      assert.equal(
        urls.filter(u => /mapbox\.(satellite|terrain-rgb)/.test(u)).length,
        0,
      )
    }
    assert.deepEqual(errors, [])
    return urls.filter(u => u.includes("/earth-background/surface"))
  } finally {
    release()
    await page.close()
  }
}

async function smallBackground(browser) {
  const page = await browser.newPage({ viewport: { width: 420, height: 260 } })
  try {
    await installProbe(page)
    const urls = []
    page.on("request", req => urls.push(new URL(req.url()).pathname))
    await page.addInitScript(() =>
      sessionStorage.setItem(
        "earth-background-orbit-v1",
        JSON.stringify({ distance: 28000000 }),
      ),
    )
    await page.goto(new URL("/harp/earth-background.html", previewURL).href, {
      waitUntil: "domcontentloaded",
    })
    await page.waitForFunction(() => window.probe?.imagery?.ready)
    await page.waitForFunction(() => {
      let width = 0
      window.probe.map.scene.traverse(node => {
        const material = node.material
        if (material?.defines?.EARTH_ORBITAL)
          width = material.uniforms.earthMap.value.image.width
      })
      return width === 1024
    })
    assert.equal(
      urls.some(u => u.endsWith("/surface.webp")),
      false,
    )
    return urls.filter(u => u.includes("/earth-background/surface"))
  } finally {
    await page.close()
  }
}

async function main() {
  const browser = await chromium.launch()
  try {
    console.log(
      JSON.stringify({
        configured: await check(browser, await mapboxToken()),
        offline: await check(browser, ""),
        orbital: await smallBackground(browser),
      }),
    )
  } finally {
    await browser.close()
  }
}
main().catch(reportFailure)
