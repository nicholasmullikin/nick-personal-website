const { test } = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs/promises")
const path = require("node:path")
const os = require("node:os")
const crypto = require("node:crypto")
const { importEarth, verify } = require("./import-earth.cjs")
const digest = content => crypto.createHash("sha256").update(content).digest("hex")
async function fixture(directory, version) {
  const id = version.repeat(12)
  const main = `rendering_globe-atmosphere_bundle.${id}.js`
  const shared = `earth-shared.${id}.js`
  const decoder = `earth-decoder.${id}.js`
  const horizon = `earth-horizon.${id}.js`
  const noise = `earth-noise.${id}.js`
  const background = `earth-background.bundle.${id}.js`
  const lazy = `324.${id}.js`
  const meta = `<meta name="earth-worker-earth-decoder" content="${decoder}"><meta name="earth-worker-earth-horizon" content="${horizon}"><meta name="earth-worker-earth-noise" content="${noise}"><meta name="earth-versioned-asset" content="${lazy}">`
  const files = {
    "rendering_globe-atmosphere.html": `${meta}<script defer src="${shared}"></script><script defer src="${main}"></script>`,
    "earth-background.html": `${meta}<script defer src="${shared}"></script><script defer src="${background}"></script>`,
    [background]: `background ${version}`, "earth-background.bundle.js": `background ${version}`,
    [lazy]: `lazy ${version}`,
    [main]: `main ${version}`, "rendering_globe-atmosphere_bundle.js": `main ${version}`,
    [shared]: `shared ${version}`, [shared + ".LICENSE.txt"]: `shared license ${version}`,
    [decoder]: `decoder ${version}`, "earth-decoder.bundle.js": `decoder ${version}`,
    [decoder + ".LICENSE.txt"]: `decoder license ${version}`,
    [horizon]: `horizon ${version}`, "earth-horizon.bundle.js": `horizon ${version}`,
    [noise]: `noise ${version}`, "earth-noise.bundle.js": `noise ${version}`,
    "decoder.bundle.js": "other worker", "earth-road-worker.bundle.js": "road worker",
    "earth-road-worker.LICENSE.txt": "road license", "resources/earth-theme.json": "{}",
    "resources/earth/night-lights.jpg": "night", "resources/earth/clouds.jpg": "cloud",
    "resources/earth/cloud-noise.webp": "noise", "resources/earth/cloud-coverage.webp": "coverage", "resources/earth/cloud-coverage-orbit.webp": "orbit coverage",
    "resources/earth/night/global.webp": "global",
  }
  const manifest = { format: 1, sourceRevision: version, inputHash: version, lockHash: version, assets: {} }
  for (const [name, content] of Object.entries(files)) {
    await fs.mkdir(path.dirname(path.join(directory, name)), { recursive: true })
    await fs.writeFile(path.join(directory, name), content)
    manifest.assets[name] = digest(content)
  }
  await fs.writeFile(path.join(directory, "earth-build.json"), JSON.stringify(manifest))
  return { main, shared, decoder, horizon, noise, background, lazy }
}
test("a swap retains only the previous HTML-referenced scripts and workers", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "earth-rollout-"))
  try {
    const source = path.join(root, "source"), target = path.join(root, "target")
    const first = await fixture(source, "a")
    await importEarth(source, target)
    await fs.rm(source, { recursive: true, force: true })
    const second = await fixture(source, "b")
    const installed = await importEarth(source, target)
    for (const old of Object.values(first)) {
      assert.ok(installed.retainedAssets.includes(old), old)
      const label = Object.entries(first).find(([, name]) => name === old)[0]
      assert.equal(await fs.readFile(path.join(target, old), "utf8"), `${label} a`)
    }
    assert.ok(installed.retainedAssets.includes(first.decoder + ".LICENSE.txt"))
    await verify(target)
    await fs.rm(source, { recursive: true, force: true })
    const third = await fixture(source, "c")
    const next = await importEarth(source, target)
    assert.ok(next.retainedAssets.includes(second.main))
    assert.equal(next.retainedAssets.includes(first.main), false)
    await assert.rejects(fs.stat(path.join(target, first.main)), e => e.code === "ENOENT")
    assert.ok(await fs.stat(path.join(target, third.main)))
    await verify(target)
  } finally { await fs.rm(root, { recursive: true, force: true }) }
})
test("legacy HTML keeps its fixed entry and decoder during the first versioned swap", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "earth-legacy-rollout-"))
  try {
    const source = path.join(root, "source"), target = path.join(root, "target")
    const first = await fixture(source, "a")
    const manifestPath = path.join(source, "earth-build.json")
    const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"))
    const oldHtml = `<script defer src="${first.shared}"></script><script defer src="rendering_globe-atmosphere_bundle.js"></script>`
    await fs.writeFile(path.join(source, "rendering_globe-atmosphere.html"), oldHtml)
    manifest.assets["rendering_globe-atmosphere.html"] = digest(oldHtml)
    await fs.writeFile(manifestPath, JSON.stringify(manifest))
    await importEarth(source, target)
    // A fresh checkout may contain the old static renderer without a manifest.
    await fs.rm(path.join(target, "earth-build.json"))
    await fs.rm(source, { recursive: true, force: true })
    const second = await fixture(source, "b")
    const installed = await importEarth(source, target)
    assert.equal(await fs.readFile(path.join(target, "rendering_globe-atmosphere_bundle.js"), "utf8"), "main a")
    assert.equal(await fs.readFile(path.join(target, "earth-decoder.bundle.js"), "utf8"), "decoder a")
    assert.equal(await fs.readFile(path.join(target, first.shared), "utf8"), "shared a")
    assert.equal(await fs.readFile(path.join(target, second.main), "utf8"), "main b")
    assert.equal(await fs.readFile(path.join(target, second.decoder), "utf8"), "decoder b")
    assert.ok(installed.legacyAliases["rendering_globe-atmosphere_bundle.js"])
    await verify(target)
    await fs.rm(source, { recursive: true, force: true })
    await fixture(source, "c")
    const next = await importEarth(source, target)
    assert.equal(await fs.readFile(path.join(target, "rendering_globe-atmosphere_bundle.js"), "utf8"), "main c")
    assert.equal(next.legacyAliases, undefined)
    await verify(target)
  } finally { await fs.rm(root, { recursive: true, force: true }) }
})
