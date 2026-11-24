const assert = require("node:assert/strict")
const fs = require("node:fs/promises")
const { createRequire } = require("node:module")
const sharp = createRequire(require.resolve("gatsby-plugin-sharp"))("sharp")
const { firefox } = require("playwright")
const reference = process.env.EARTH_REFERENCE_URL || "http://127.0.0.1:8011"
const candidate = process.env.EARTH_BACKGROUND_URL || "http://127.0.0.1:8012"
async function main() {
  const browser = await firefox.launch({
    firefoxUserPrefs: { "webgl.enable-webgl2": false },
  })
  const results = []
  try {
    const captures = []
    for (const base of [reference, candidate]) {
      const page = await browser.newPage({
        viewport: { width: 960, height: 720 },
      })
      const errors = []
      page.on("pageerror", e => errors.push(e.message))
      page.on("console", e => {
        if (/THREE.WebGLProgram|shader error|VALIDATE_STATUS/i.test(e.text()))
          errors.push(e.text())
      })
      await page.addInitScript(() =>
        addEventListener("earth-ready", e => (window.probe = e.detail)),
      )
      await page.goto(base + "/harp/earth-background.html")
      await page.waitForFunction(
        () =>
          window.probe?.imagery.ready &&
          window.probe.environment.status.nightReady,
        null,
        { polling: 50 },
      )
      await page.evaluate(() => {
        window.probe.background.setPaused(true)
        window.probe.environment.setClouds(false)
      })
      const images = []
      for (const [latitude, longitude, distance] of [
        [20, -30, 11000000],
        [0, 100, 20000000],
        [45, -100, 2000000],
        [80, 179, 8000000],
      ]) {
        await page.evaluate(
          async pose => {
            const p = window.probe
            p.map.lookAt({
              target: { latitude: pose[0], longitude: pose[1] },
              distance: pose[2],
              heading: 0,
              tilt: 0,
            })
            for (let i = 0; i < 3; i++) {
              await new Promise(r => requestAnimationFrame(r))
              p.map.renderSync()
            }
          },
          [latitude, longitude, distance],
        )
        const png = await page.screenshot()
        const { data, info } = await sharp(png)
          .ensureAlpha()
          .raw()
          .toBuffer({ resolveWithObject: true })
        images.push({ data, width: info.width, height: info.height, png })
      }
      assert.deepEqual(errors, [])
      captures.push(images)
      await page.close()
    }
    for (let i = 0; i < captures[0].length; i++) {
      const a = captures[0][i],
        b = captures[1][i]
      let sum = 0,
        bad = 0,
        max = 0
      for (let j = 0; j < a.data.length; j += 4) {
        const error = Math.max(
          ...[0, 1, 2].map(k => Math.abs(a.data[j + k] - b.data[j + k])),
        )
        sum += error
        max = Math.max(max, error)
        if (error > 16) bad++
      }
      const mean = sum / (a.width * a.height),
        fraction = bad / (a.width * a.height)
      results.push({
        view: i,
        meanChannelError: mean,
        fractionOver16: fraction,
        max,
      })
      await fs.writeFile(`/tmp/earth-atmosphere-cache-view-${i}.png`, b.png)
      assert.ok(
        mean < 1.5 && fraction < 0.001,
        `view ${i}: atmosphere cache must preserve appearance: ${JSON.stringify(results[i])}`,
      )
    }
    console.log(JSON.stringify(results, null, 2))
  } finally {
    await browser.close()
  }
}
main().catch(e => {
  console.error(e)
  process.exitCode = 1
})
