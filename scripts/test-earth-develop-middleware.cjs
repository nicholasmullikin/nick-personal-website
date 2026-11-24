const { test } = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs/promises")
const path = require("node:path")
const os = require("node:os")
const { createRequire } = require("node:module")
const express = createRequire(require.resolve("gatsby"))("express")
const { createEarthDevelopMiddleware } = require("./earth-develop-middleware.cjs")
test("development middleware serves only the authoritative Earth tree", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "earth-dev-middleware-"))
  let server
  try {
    const files = { "rendering_globe-atmosphere.html": "map", "earth-background.html": "background", "resources/earth/credits.html": "credits", "resources/earth/laz-perf.wasm": "wasm" }
    for (const [name, content] of Object.entries(files)) {
      await fs.mkdir(path.dirname(path.join(root, name)), { recursive: true })
      await fs.writeFile(path.join(root, name), content)
    }
    const app = express()
    app.use("/harp", createEarthDevelopMiddleware(root))
    server = await new Promise(resolve => { const s = app.listen(0, "127.0.0.1", () => resolve(s)) })
    const base = `http://127.0.0.1:${server.address().port}`
    for (const [name, content] of Object.entries(files)) {
      const response = await fetch(`${base}/harp/${name}`)
      assert.equal(response.status, 200, name)
      assert.equal(await response.text(), content, name)
    }
    assert.equal((await fetch(`${base}/harp/nonexistent.js`)).status, 404)
    assert.equal((await fetch(`${base}/harp/%2e%2e/package.json`)).status, 404)
    assert.equal((await fetch(`${base}/harp/%2e%2e%2fpackage.json`)).status, 404)
  } finally {
    if (server) await new Promise(resolve => server.close(resolve))
    await fs.rm(root, { recursive: true, force: true })
  }
})
