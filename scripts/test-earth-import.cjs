const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs/promises"),
  os = require("node:os"),
  path = require("node:path"),
  crypto = require("node:crypto")
const { importEarth, verify } = require("./import-earth.cjs")
test("asset import rejects corruption without replacing the served renderer, then swaps a valid set", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "earth-import-")),
    source = path.join(root, "source"),
    target = path.join(root, "served")
  try {
    const files = {
      "rendering_globe-atmosphere.html": "<html></html>",
      "rendering_globe-atmosphere_bundle.js":
        'const token = new URLSearchParams(location.search).get("mapbox_token");',
      "decoder.bundle.js": "/* worker */",
      "resources/earth-theme.json": "{}",
      "resources/earth/night-lights.jpg": "night",
      "resources/earth/clouds.jpg": "cloud",
    }
    const manifest = {
      format: 1,
      sourceRevision: "test",
      inputHash: "test",
      lockHash: "test",
      assets: {},
    }
    for (const [name, body] of Object.entries(files)) {
      await fs.mkdir(path.dirname(path.join(source, name)), { recursive: true })
      await fs.writeFile(path.join(source, name), body)
      manifest.assets[name] = crypto
        .createHash("sha256")
        .update(body)
        .digest("hex")
    }
    await fs.writeFile(
      path.join(source, "earth-build.json"),
      JSON.stringify(manifest),
    )
    await fs.mkdir(target)
    await fs.writeFile(path.join(target, "sentinel"), "working")
    await fs.writeFile(path.join(source, "decoder.bundle.js"), "corrupted")
    await assert.rejects(importEarth(source, target), /checksum/)
    assert.equal(
      await fs.readFile(path.join(target, "sentinel"), "utf8"),
      "working",
    )
    await fs.writeFile(
      path.join(source, "decoder.bundle.js"),
      files["decoder.bundle.js"],
    )
    await importEarth(source, target)
    await verify(target)
    await assert.rejects(
      fs.stat(path.join(target, "sentinel")),
      error => error.code === "ENOENT",
    )
    manifest.assets["../escape"] = "bad"
    await fs.writeFile(
      path.join(source, "earth-build.json"),
      JSON.stringify(manifest),
    )
    await assert.rejects(importEarth(source, target), /Unsafe/)
    await verify(target)
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})
