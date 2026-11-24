const { chromium, firefox } = require("playwright")
const assert = require("node:assert/strict")
const { createRequire } = require("node:module")
const sharp = createRequire(require.resolve("gatsby-plugin-sharp"))("sharp")
const { previewURL, installProbe } = require("./lib/earth-browser.cjs")

async function main() {
  const transparent = await sharp({ create: { width: 1, height: 1, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer()
  for (const [name, type] of [["chromium", chromium], ["firefox", firefox]]) {
    const browser = await type.launch({ headless: true })
    try {
      const images = []
      for (const open of [false, true]) {
        const page = await browser.newPage({ viewport: { width: 640, height: 480 } })
        try {
          const requests = [], errors = []
          page.on("pageerror", error => errors.push(error.message))
          page.on("console", message => { if (message.type() === "error" && /Shader Error|WebGLProgram/.test(message.text())) errors.push(message.text()) })
          await page.route("https://wmts.geo.admin.ch/**", route => {
            requests.push(route.request().url())
            return route.fulfill({ status: 200, contentType: "image/png", headers: { "access-control-allow-origin": "*" }, body: transparent })
          })
          await installProbe(page)
          await page.goto(`${previewURL}/harp/rendering_globe-atmosphere.html?view=47.3769,8.5417,0,9000,45,0${open ? "&imagery=swissimage" : ""}`)
          await page.waitForFunction(() => window.probe?.map?.earth)
          await page.evaluate(() => { const e = window.probe.map.earth; e.environment.setClouds(false); e.buildings.setEnabled(false); e.setSunHour(14); window.probe.map.update() })
          if (open) await page.waitForFunction(() => window.probe.map.earth.stats.cache > 0, null, { timeout: 30000 })
          await page.waitForTimeout(4000)
          const stats = await page.evaluate(() => ({ ...window.probe.map.earth.stats }))
          assert.equal(errors.length, 0, errors.join("\n"))
          if (open) {
            assert.ok(requests.length > 0)
            for (const request of requests) {
              const z = Number(new URL(request).pathname.split("/").at(-3))
              assert.ok(z >= 8 && z <= 20, `invalid source zoom ${z}`)
            }
            assert.ok(stats.cache > 0)
          } else assert.equal(requests.length, 0)
          const pixels = await sharp(await page.screenshot()).extract({ left: 120, top: 110, width: 400, height: 250 }).removeAlpha().raw().toBuffer()
          images.push(pixels)
        } finally { await page.close() }
      }
      let total = 0
      for (let i = 0; i < images[0].length; i++) total += Math.abs(images[0][i] - images[1][i])
      const mean = total / images[0].length
      assert.ok(mean < 4, `transparent no-data should show the overview, mean difference ${mean}`)
      console.log(name, "passed", { transparentMeanDifference: mean })
    } finally { await browser.close() }
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
