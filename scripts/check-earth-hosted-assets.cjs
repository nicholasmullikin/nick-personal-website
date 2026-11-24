// Check deployed bytes, WebAssembly MIME and byte ranges against the build and
// the local PMTiles sample. This deliberately reads the served manifest: it
// works during rolling deployments without assuming which generation is live.
const assert = require("node:assert/strict")
const crypto = require("node:crypto")
const fs = require("node:fs/promises")
const path = require("node:path")

const samples = [
  "earth-data/mapped-buildings/0-3.pmtiles",
  "earth-data/street-lamps.pmtiles",
]
const wasm = "resources/earth/laz-perf.wasm"
const digest = bytes => crypto.createHash("sha256").update(bytes).digest("hex")
const encodePath = name => name.split("/").map(encodeURIComponent).join("/")
function safeName(name) {
  return (
    name &&
    !name.startsWith("/") &&
    !name.includes("\\") &&
    name.split("/").every(part => part && part !== "." && part !== "..")
  )
}
function assetURL(base, name) {
  assert.ok(safeName(name), `unsafe asset path: ${name}`)
  return new URL(encodePath(name), base)
}
async function responseBytes(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { "accept-encoding": "identity", ...options.headers },
  })
  const bytes = Buffer.from(await response.arrayBuffer())
  return { response, bytes }
}
async function checkRange(url, expected, label) {
  assert.ok(expected.length > 256, `${label}: range sample too small`)
  for (const [start, end] of [
    [0, 127],
    [Math.floor(expected.length / 2), Math.floor(expected.length / 2) + 127],
    [expected.length - 128, expected.length - 1],
  ]) {
    const { response, bytes } = await responseBytes(url, {
      headers: { range: `bytes=${start}-${end}` },
    })
    assert.equal(
      response.status,
      206,
      `${label}: byte range must return HTTP 206`,
    )
    assert.equal(
      response.headers.get("content-range"),
      `bytes ${start}-${end}/${expected.length}`,
      `${label}: content range`,
    )
    assert.deepEqual(
      bytes,
      expected.subarray(start, end + 1),
      `${label}: ranged bytes`,
    )
  }
}
async function checkHostedAssets(baseURL, options = {}) {
  const site = new URL(baseURL)
  assert.ok(
    ["http:", "https:"].includes(site.protocol),
    "expected an HTTP(S) origin",
  )
  site.pathname = "/"
  site.search = ""
  site.hash = ""
  const harp = new URL("harp/", site)
  const { response, bytes } = await responseBytes(
    new URL("earth-build.json", harp),
  )
  assert.equal(response.status, 200, "earth-build.json HTTP status")
  const manifest = JSON.parse(bytes.toString("utf8"))
  assert.ok(
    manifest.assets &&
      typeof manifest.assets === "object" &&
      !Array.isArray(manifest.assets),
    "invalid asset manifest",
  )
  const entries = Object.entries(manifest.assets)
  assert.ok(entries.length > 0, "empty asset manifest")
  let next = 0,
    wasmBytes
  const htmlFiles = new Map()
  const failures = []
  async function consume() {
    for (;;) {
      const index = next++
      if (index >= entries.length) break
      const [name, expectedHash] = entries[index]
      try {
        assert.match(expectedHash, /^[a-f0-9]{64}$/, `${name}: invalid SHA-256`)
        const { response: asset, bytes: body } = await responseBytes(
          assetURL(harp, name),
        )
        assert.equal(asset.status, 200, `${name}: HTTP status`)
        assert.equal(digest(body), expectedHash, `${name}: SHA-256 mismatch`)
        if (name.endsWith(".js")) {
          assert.match(
            asset.headers
              .get("content-type")
              ?.split(";")[0]
              .trim()
              .toLowerCase() || "",
            /^(application|text)\/(java|ecma)script$/,
            `${name}: JavaScript MIME type`,
          )
        }
        if (name.endsWith(".wasm")) {
          assert.equal(
            asset.headers
              .get("content-type")
              ?.split(";")[0]
              .trim()
              .toLowerCase(),
            "application/wasm",
            `${name}: MIME type`,
          )
          assert.deepEqual(
            body.subarray(0, 4),
            Buffer.from([0, 97, 115, 109]),
            `${name}: WebAssembly magic`,
          )
          try {
            await WebAssembly.compile(body)
          } catch (error) {
            throw new Error(
              `${name}: WebAssembly validation failed: ${error.message}`,
            )
          }
        }
        if (name === wasm) wasmBytes = body
        if (
          name === "rendering_globe-atmosphere.html" ||
          name === "earth-background.html"
        )
          htmlFiles.set(name, body.toString("utf8"))
      } catch (error) {
        failures.push(`${name}: ${error.message}`)
      }
    }
  }
  await Promise.all(
    Array.from(
      { length: Math.min(options.concurrency || 8, entries.length) },
      consume,
    ),
  )
  assert.equal(failures.length, 0, failures.join("\n"))
  for (const name of [
    "rendering_globe-atmosphere.html",
    "earth-background.html",
  ]) {
    const html = htmlFiles.get(name)
    assert.ok(html, `${name}: missing from manifest`)
    const references = [
      ...html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["']/gi),
      ...html.matchAll(
        /<meta\b[^>]*\bname=["']earth-(?:worker-[^"']+|versioned-asset)["'][^>]*\bcontent=["']([^"']+)["']/gi,
      ),
    ].map(match => match[1])
    assert.ok(references.length, `${name}: no script references`)
    for (const reference of references)
      assert.ok(
        manifest.assets[reference],
        `${name}: referenced asset missing from manifest: ${reference}`,
      )
  }
  assert.ok(wasmBytes, `${wasm}: missing from manifest`)
  await checkRange(assetURL(harp, wasm), wasmBytes, wasm)
  for (const sample of samples) {
    const localSample = await fs.readFile(
      path.join(
        options.staticRoot || path.join(__dirname, "../static"),
        sample,
      ),
    )
    assert.equal(
      localSample.subarray(0, 8).toString("binary"),
      "PMTiles\x03",
      "PMTiles sample header",
    )
    await checkRange(assetURL(site, sample), localSample, sample)
  }
  return { assets: entries.length, ranges: 3 + samples.length * 3 }
}
if (require.main === module) {
  const base = process.argv[2] || "http://127.0.0.1:8014"
  checkHostedAssets(base)
    .then(result => {
      console.log(
        `Hosted Earth: ${result.assets} SHA-256 assets, JS/WASM MIME, WASM validation and ${result.ranges} byte ranges passed at ${new URL(base).origin}`,
      )
    })
    .catch(error => {
      console.error(error.message)
      process.exitCode = 1
    })
}
module.exports = { checkHostedAssets }
