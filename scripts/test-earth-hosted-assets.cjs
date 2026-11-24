const { test } = require("node:test")
const assert = require("node:assert/strict")
const crypto = require("node:crypto")
const fs = require("node:fs/promises")
const path = require("node:path")
const os = require("node:os")
const { createRequire } = require("node:module")
const express = createRequire(require.resolve("gatsby"))("express")
const { checkHostedAssets } = require("./check-earth-hosted-assets.cjs")

test("hosted audit catches corrupt bytes, MIME errors and broken byte ranges", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "earth-hosted-assets-"))
  let server,
    fault = ""
  try {
    const wasm = Buffer.alloc(512, 37)
    // A valid empty module with a large custom section for range checks.
    Buffer.from([0, 97, 115, 109, 1, 0, 0, 0, 0, 0xf5, 3, 0]).copy(wasm)
    const invalidWasm = Buffer.alloc(512, 37)
    Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]).copy(invalidWasm)
    const tile = Buffer.alloc(512, 42)
    Buffer.from("PMTiles\x03", "binary").copy(tile)
    const files = {
      "harp/resources/earth/laz-perf.wasm": wasm,
      "harp/earth.js": Buffer.from("console.log('earth')"),
      "harp/rendering_globe-atmosphere.html": Buffer.from(
        '<script src="earth.js"></script>',
      ),
      "harp/earth-background.html": Buffer.from(
        '<script src="earth.js"></script>',
      ),
      "earth-data/mapped-buildings/0-3.pmtiles": tile,
      "earth-data/street-lamps.pmtiles": tile,
    }
    for (const [name, data] of Object.entries(files)) {
      const file = path.join(root, name)
      await fs.mkdir(path.dirname(file), { recursive: true })
      await fs.writeFile(file, data)
    }
    const assets = Object.fromEntries(
      Object.entries(files)
        .filter(([name]) => name.startsWith("harp/"))
        .map(([name, data]) => [
          name.slice(5),
          crypto.createHash("sha256").update(data).digest("hex"),
        ]),
    )
    await fs.writeFile(
      path.join(root, "harp/earth-build.json"),
      JSON.stringify({ assets }),
    )
    const app = express()
    app.use((req, res, next) => {
      if (
        fault === "broken-reference" &&
        req.path === "/harp/earth-build.json"
      ) {
        const broken = Buffer.from('<script src="missing.js"></script>')
        return res.json({
          assets: {
            ...assets,
            "earth-background.html": crypto
              .createHash("sha256")
              .update(broken)
              .digest("hex"),
          },
        })
      }
      if (
        fault === "broken-reference" &&
        req.path === "/harp/earth-background.html"
      )
        return res.type("text/html").send('<script src="missing.js"></script>')
      if (fault === "traversal" && req.path === "/harp/earth-build.json")
        return res.json({ assets: { ...assets, "../escape": "0".repeat(64) } })
      if (fault === "bad-wasm" && req.path === "/harp/earth-build.json")
        return res.json({
          assets: {
            ...assets,
            "resources/earth/laz-perf.wasm": crypto
              .createHash("sha256")
              .update(invalidWasm)
              .digest("hex"),
          },
        })
      if (fault === "bad-wasm" && req.path.endsWith(".wasm"))
        return res.type("application/wasm").send(invalidWasm)
      if (fault === "corrupt" && req.path === "/harp/earth.js")
        return res.type("application/javascript").send("broken")
      if (fault === "wasm-mime" && req.path.endsWith(".wasm"))
        return res.type("application/octet-stream").send(wasm)
      if (fault === "js-mime" && req.path === "/harp/earth.js")
        return res.type("text/plain").send(files["harp/earth.js"])
      if (
        fault === "range" &&
        req.path.endsWith(".pmtiles") &&
        req.headers.range
      )
        return res.send(tile)
      if (
        fault === "bad-range" &&
        req.path.endsWith(".pmtiles") &&
        req.headers.range
      )
        return res
          .status(206)
          .set("Content-Range", "bytes 0-127/999")
          .send(tile.subarray(0, 128))
      if (fault === "missing" && req.path === "/harp/earth.js")
        return res.sendStatus(404)
      next()
    })
    app.use(express.static(root))
    server = await new Promise(resolve => {
      const s = app.listen(0, "127.0.0.1", () => resolve(s))
    })
    const base = `http://127.0.0.1:${server.address().port}`
    assert.deepEqual(await checkHostedAssets(base, { staticRoot: root }), {
      assets: 4,
      ranges: 9,
    })
    for (const [kind, message] of [
      ["corrupt", /SHA-256 mismatch/],
      ["wasm-mime", /MIME type/],
      ["bad-wasm", /WebAssembly validation failed/],
      ["js-mime", /JavaScript MIME/],
      ["range", /HTTP 206/],
      ["bad-range", /content range/],
      ["missing", /HTTP status/],
      ["traversal", /unsafe asset path/],
      ["broken-reference", /referenced asset missing/],
    ]) {
      fault = kind
      await assert.rejects(
        checkHostedAssets(base, { staticRoot: root }),
        message,
      )
    }
  } finally {
    if (server) await new Promise(resolve => server.close(resolve))
    await fs.rm(root, { recursive: true, force: true })
  }
})
