// SwiftShader deliberately exercises a slow renderer with real asynchronous timings.
const assert = require("node:assert/strict")
const { chromium } = require("playwright")
const base = process.env.EARTH_BACKGROUND_URL || "http://127.0.0.1:8012"
async function main() {
  const browser = await chromium.launch({
    args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
  })
  try {
    const page = await browser.newPage({
      viewport: { width: 1440, height: 900 },
    })
    const errors = []
    page.on("pageerror", e => errors.push(e.message))
    await page.addInitScript(() =>
      addEventListener("earth-ready", e => (window.probe = e.detail)),
    )
    await page.goto(base + "/harp/earth-background.html")
    await page.waitForFunction(
      () =>
        window.probe?.background.quality.level === 2 &&
        window.probe.environment.cloudStats.steps === 16,
      null,
      { polling: 100, timeout: 40000 },
    )
    const result = await page.evaluate(() => ({
      state: window.probe.background.state(),
      clouds: window.probe.environment.cloudStats,
      profile: window.probe.background.performance.snapshot(),
    }))
    assert.ok(result.state.pixels <= 700000)
    assert.ok(result.clouds.width * result.clouds.height <= 50000)
    assert.equal(result.clouds.steps, 16)
    assert.ok(result.profile.gpu.frame.samples >= 4)
    await page.evaluate(() => window.probe.background.dispose())
    const disposed = await page.evaluate(() => ({
      pending: window.probe.background.performance.snapshot().pending,
      geometries: window.probe.map.renderer.info.memory.geometries,
      textures: window.probe.map.renderer.info.memory.textures,
    }))
    assert.deepEqual(disposed, { pending: 0, geometries: 0, textures: 0 })
    assert.deepEqual(errors, [])
    console.log(JSON.stringify({ result, disposed }, null, 2))
  } finally {
    await browser.close()
  }
}
main().catch(e => {
  console.error(e)
  process.exitCode = 1
})
