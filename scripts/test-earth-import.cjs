const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs/promises"),
  os = require("node:os"),
  path = require("node:path"),
  crypto = require("node:crypto")
const { importEarth, verify, mirrorEarth } = require("./import-earth.cjs")
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
      "earth-decoder.bundle.js": "/* earth worker */",
      "earth-road-worker.bundle.js": "/* optional road worker */",
      "earth-road-worker.LICENSE.txt": "worker licenses",
      "resources/earth-theme.json": "{}",
      "resources/earth/night-lights.jpg": "night",
      "resources/earth/cloud-coverage.webp": "coverage",
      "resources/earth/cloud-coverage-orbit.webp": "orbit coverage",
      "resources/earth/night/global.webp": "global",
      "resources/earth/clouds.jpg": "cloud",
      "resources/earth/cloud-noise.webp": "noise",
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
    const publicRoot = path.join(root, "public"), publicEarth = path.join(publicRoot, "harp")
    await fs.mkdir(publicEarth, { recursive: true })
    await fs.writeFile(path.join(publicRoot, "unrelated"), "preserved")
    await fs.writeFile(path.join(publicEarth, "obsolete"), "old generated file")
    await mirrorEarth(target, publicEarth)
    await verify(publicEarth)
    assert.equal(await fs.readFile(path.join(publicRoot, "unrelated"), "utf8"), "preserved")
    await assert.rejects(fs.stat(path.join(publicEarth, "obsolete")), e => e.code === "ENOENT")
    const hashed = "rendering_globe-atmosphere_bundle.123456abcdef.js"
    const alias = "rendering_globe-atmosphere_bundle.js"
    const html = `<script defer src="${hashed}"></script>`
    await fs.writeFile(path.join(source, hashed), files[alias])
    await fs.writeFile(path.join(source, "rendering_globe-atmosphere.html"), html)
    manifest.assets[hashed] = manifest.assets[alias]
    manifest.assets["rendering_globe-atmosphere.html"] = crypto.createHash("sha256").update(html).digest("hex")
    await fs.writeFile(path.join(source, "earth-build.json"), JSON.stringify(manifest))
    await verify(source)
    const changed = "/* different interactive entry */"
    await fs.writeFile(path.join(source, hashed), changed)
    manifest.assets[hashed] = crypto.createHash("sha256").update(changed).digest("hex")
    await fs.writeFile(path.join(source, "earth-build.json"), JSON.stringify(manifest))
    await assert.rejects(verify(source), /Mismatched versioned Earth entry/)
    await fs.writeFile(path.join(source, hashed), files[alias])
    manifest.assets[hashed] = manifest.assets[alias]
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
