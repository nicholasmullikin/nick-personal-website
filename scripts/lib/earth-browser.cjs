const fs = require("node:fs/promises"),
  path = require("node:path"),
  assert = require("node:assert/strict")
const previewURL = process.env.EARTH_PREVIEW_URL || "http://127.0.0.1:8011"
async function mapboxToken() {
  const env = await fs
    .readFile(path.join(__dirname, "../../.env.development"), "utf8")
    .catch(() => "")
  const token =
    process.env.GATSBY_MAPBOX_TOKEN ||
    env.match(/GATSBY_MAPBOX_TOKEN\s*=\s*["']?([^\s"']+)/)?.[1]
  assert.ok(token, "GATSBY_MAPBOX_TOKEN is required for live map checks")
  return token
}
function redact(value) {
  return String(value).replace(
    /(mapbox_token|access_token)=[^\s"')]+/g,
    "$1=[redacted]",
  )
}
function reportFailure(error) {
  console.error(redact(error.stack || error.message))
  process.exitCode = 1
}
async function installProbe(page) {
  await page.addInitScript(() =>
    window.addEventListener("earth-ready", event => {
      window.probe = event.detail
    }),
  )
}
function browserErrors(page) {
  const errors = []
  page.on("pageerror", e => errors.push(redact(e.message)))
  page.on("console", m => {
    if (
      m.type() === "error" &&
      /Shader Error|WebGLProgram|initialization failed/.test(m.text())
    )
      errors.push(redact(m.text()))
  })
  return errors
}
async function settleImagery(page) {
  const frame = await page.evaluate(() => {
    const map = window.probe.map
    map.update()
    return map.frameNumber
  })
  await page.waitForFunction(
    previous => window.probe.map.frameNumber > previous,
    frame,
    { polling: 100, timeout: 10000 },
  )
  await page.waitForFunction(
    () => {
      const map = window.probe.map,
        stats = map.earth.stats
      const terrain = map.visibleTileSet.dataSourceTileList.find(
        e => e.dataSource.name === "terrain",
      )
      return (
        stats.cache > 0 &&
        stats.pending === 0 &&
        stats.fading === 0 &&
        terrain?.allVisibleTileLoaded
      )
    },
    null,
    { polling: 100, timeout: 90000 },
  )
}

async function openControls(page, name) {
  const button = page.getByRole("button", { name, exact: true })
  if ((await button.getAttribute("aria-expanded")) !== "true")
    await button.click()
}
module.exports = {
  openControls,
  previewURL,
  mapboxToken,
  redact,
  reportFailure,
  installProbe,
  browserErrors,
  settleImagery,
}
