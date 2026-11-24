const { test } = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs/promises")
const os = require("node:os")
const path = require("node:path")
const { createRequire } = require("node:module")
const { createPreview } = require("./serve-earth-preview.cjs")
const pathToRegexp = createRequire(require.resolve("gatsby"))("path-to-regexp")

test("only content-addressed Earth entry and shared scripts receive immutable headers", async () => {
  const config = JSON.parse(await fs.readFile(path.join(__dirname, "../vercel.json"), "utf8"))
  const rules = config.headers.map(rule => ({ regex: pathToRegexp(rule.source, []), headers: rule.headers }))
  const matching = name => rules.filter(rule => rule.regex.test(`/harp/${name}`))
  const hashed = ["earth-shared.123456abcdef.js", "rendering_globe-atmosphere_bundle.123456abcdef.js", "earth-decoder.123456abcdef.js", "earth-horizon.123456abcdef.js", "earth-noise.123456abcdef.js", "earth-background.bundle.123456abcdef.js", "324.123456abcdef.js"]
  const mutable = ["earth-shared.js", "rendering_globe-atmosphere_bundle.js", "earth-decoder.bundle.js", "earth-horizon.bundle.js", "earth-background.bundle.js", "rendering_globe-atmosphere.html", "earth-shared.123456abcdef.js.map", "earth-shared.zzzzzzzzzzzz.js"]
  for (const name of hashed) {
    assert.equal(matching(name).length, 1, name)
    assert.match(matching(name)[0].headers.find(header => header.key === "Cache-Control").value, /immutable/)
  }
  for (const name of mutable) assert.equal(matching(name).length, 0, name)

  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "earth-cache-headers-"))
  let server
  try {
    for (const name of [...hashed, ...mutable.slice(1, 6)]) await fs.writeFile(path.join(directory, name), "test")
    server = await createPreview({ assets: directory, port: 0 })
    const root = `http://127.0.0.1:${server.address().port}/harp/`
    for (const name of hashed) assert.match((await fetch(root + name)).headers.get("cache-control"), /immutable/)
    for (const name of mutable.slice(1, 6)) assert.doesNotMatch((await fetch(root + name)).headers.get("cache-control"), /immutable/)
  } finally {
    if (server) await new Promise(resolve => server.close(resolve))
    await fs.rm(directory, { recursive: true, force: true })
  }
})
