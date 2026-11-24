// Exercise a real staged swap with old HTML arriving immediately before it.
const assert = require("node:assert/strict")
const fs = require("node:fs/promises")
const path = require("node:path")
const os = require("node:os")
const { chromium, firefox } = require("playwright")
const { importEarth } = require("./import-earth.cjs")
const { createPreview } = require("./serve-earth-preview.cjs")
const { installProbe, mapboxToken } = require("./lib/earth-browser.cjs")
async function main() {
  const [oldAssets, newAssets] = process.argv.slice(2)
  assert.ok(oldAssets && newAssets, "pass the old and new verified Earth builds")
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "earth-live-rollout-"))
  let server
  try {
    const target = path.join(root, "harp")
    const oldPages = {}
    for (const name of ["rendering_globe-atmosphere.html", "earth-background.html"])
      oldPages[name] = await fs.readFile(path.join(oldAssets, name), "utf8")
    await importEarth(oldAssets, target)
    const result = await importEarth(newAssets, target)
    assert.ok(result.retainedAssets?.length, "previous assets retained")
    server = await createPreview({ assets: target, port: 0, backend: process.env.EARTH_PREVIEW_BACKEND || "http://127.0.0.1:8014" })
    const base = `http://127.0.0.1:${server.address().port}`
    const token = await mapboxToken()
    for (const [name, engine, options] of [["chromium", chromium, {}], ["firefox", firefox, {}]]) {
      const browser = await engine.launch({ headless: true, ...options })
      try {
        for (const generation of ["previous", "current"]) {
          for (const background of [false, true]) {
            const page = await browser.newPage({ viewport: { width: 640, height: 480 } })
            try {
              const errors = [], missing = [], assets = []
              page.on("pageerror", e => errors.push(e.message))
              page.on("response", response => {
                const u = new URL(response.url())
                if (u.origin === base && u.pathname.startsWith("/harp/") && response.status() >= 400)
                  missing.push(`${u.pathname}: ${response.status()}`)
                if (u.origin === base && u.pathname.endsWith(".js")) assets.push(u.pathname.split("/").pop())
              })
              await installProbe(page)
              if (generation === "previous")
                await page.route("**/harp/*.html*", route => {
                  const name = new URL(route.request().url()).pathname.split("/").pop()
                  return oldPages[name] ? route.fulfill({ body: oldPages[name], contentType: "text/html" }) : route.continue()
                })
              const pageName = background ? "earth-background.html" : "rendering_globe-atmosphere.html"
              await page.goto(`${base}/harp/${pageName}${background ? "" : `?terrain=mapterhorn&mapbox_token=${encodeURIComponent(token)}`}`)
              await page.waitForFunction(background => background ? window.probe?.background?.state().frame > 1 : window.probe?.map?.frameNumber > 1, background, { timeout: 60000 })
              await page.waitForTimeout(2500)
              assert.deepEqual(errors, [], `${name} ${generation} ${pageName}: ${errors.join("; ")}`)
              assert.deepEqual(missing, [], `${name} ${generation} ${pageName}: ${missing.join("; ")}`)
              if (!background) {
                assert.ok(assets.some(asset => /earth-open-terrain|^[0-9]+(?:\.[a-f0-9]{12})?\.js$/.test(asset)), "lazy terrain chunk loaded")
                const worker = await page.evaluate(() => ({
                  expected: document.querySelector('meta[name="earth-worker-earth-decoder"]')?.content || "earth-decoder.bundle.js",
                  resources: performance.getEntriesByType("resource").map(entry => new URL(entry.name).pathname.split("/").pop()),
                }))
                assert.ok(worker.resources.includes(worker.expected), `decoder ${worker.expected} was requested`)
              }
              console.log(name, generation, pageName, "passed")
            } finally { await page.close() }
          }
        }
      } finally { await browser.close() }
    }
  } finally {
    if (server) await new Promise(resolve => server.close(resolve))
    await fs.rm(root, { recursive: true, force: true })
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
