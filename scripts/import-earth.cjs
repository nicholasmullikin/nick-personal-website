// Verify an entire source-built asset set before replacing the served directory.
const fs = require("node:fs/promises"),
  path = require("node:path"),
  crypto = require("node:crypto")
const hash = buffer => crypto.createHash("sha256").update(buffer).digest("hex")
async function verify(directory) {
  const manifest = JSON.parse(
    await fs.readFile(path.join(directory, "earth-build.json"), "utf8"),
  )
  if (
    manifest.format !== 1 ||
    !manifest.sourceRevision ||
    !manifest.inputHash ||
    !manifest.lockHash
  )
    throw Error("Unsupported or incomplete Earth build manifest")
  for (const name of [
    "rendering_globe-atmosphere.html",
    "rendering_globe-atmosphere_bundle.js",
    "decoder.bundle.js",
    "earth-decoder.bundle.js",
    "earth-road-worker.bundle.js",
    "earth-road-worker.LICENSE.txt",
    "resources/earth-theme.json",
    "resources/earth/night-lights.jpg",
    "resources/earth/clouds.jpg",
    "resources/earth/cloud-noise.webp",
    "resources/earth/cloud-coverage.webp",
    "resources/earth/night/global.webp",
  ])
    if (!manifest.assets[name])
      throw Error("Missing required Earth asset: " + name)
  for (const [name, expected] of Object.entries(manifest.assets)) {
    const file = path.resolve(directory, name)
    if (
      !file.startsWith(path.resolve(directory) + path.sep) ||
      path.isAbsolute(name)
    )
      throw Error("Unsafe asset path: " + name)
    const content = await fs.readFile(file)
    if (hash(content) !== expected)
      throw Error("Earth asset checksum mismatch: " + name)
    if (
      name.endsWith(".js") &&
      /pk\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/.test(content.toString("utf8"))
    )
      throw Error("Earth build contains a literal Mapbox token")
  }
  // A versioned entry and its legacy alias must describe the same build. Old
  // manifests without a hashed entry remain importable during a rollout.
  const html = await fs.readFile(
    path.join(directory, "rendering_globe-atmosphere.html"),
    "utf8",
  )
  const entries = [...html.matchAll(/src=["'](rendering_globe-atmosphere_bundle\.[a-f0-9]{12}\.js)["']/g)]
  const aliasMatches = (entry, alias) =>
    manifest.assets[entry] === manifest.assets[alias] ||
    (manifest.legacyAliases?.[alias] && manifest.legacyAliases[alias] === manifest.assets[alias])
  if (
    entries.length > 1 ||
    (entries.length === 1 &&
      (!manifest.assets[entries[0][1]] ||
        !aliasMatches(entries[0][1], "rendering_globe-atmosphere_bundle.js")))
  )
    throw Error("Mismatched versioned Earth entry and legacy alias")
  for (const match of html.matchAll(/<meta name=["']earth-worker-(earth-(?:decoder|horizon|noise|bc7|lidar|canopy|weather|road-worker))["'] content=["'](earth-(?:decoder|horizon|noise|bc7|lidar|canopy|weather|road-worker)\.[a-f0-9]{12}\.js)["']/g)) {
    const [, worker, entry] = match
    if (
      !entry.startsWith(worker + ".") ||
      !manifest.assets[entry] ||
      !aliasMatches(entry, worker + ".bundle.js")
    )
      throw Error("Mismatched versioned Earth worker and legacy alias")
  }
  for (const match of html.matchAll(/<meta name=["']earth-versioned-asset["'] content=["']((?:[0-9]+|earth-[a-z0-9-]+|earth-background\.bundle|rendering_globe-atmosphere_bundle)\.[a-f0-9]{12}\.js)["']/g))
    if (!manifest.assets[match[1]]) throw Error("Missing versioned Earth asset: " + match[1])
  let backgroundHtml
  try { backgroundHtml = await fs.readFile(path.join(directory, "earth-background.html"), "utf8") } catch { /* Older builds may not include the background. */ }
  if (backgroundHtml) {
    for (const match of backgroundHtml.matchAll(/<meta name=["']earth-versioned-asset["'] content=["']((?:[0-9]+|earth-[a-z0-9-]+|earth-background\.bundle|rendering_globe-atmosphere_bundle)\.[a-f0-9]{12}\.js)["']/g))
      if (!manifest.assets[match[1]]) throw Error("Missing versioned Earth asset: " + match[1])
    const backgrounds = [...backgroundHtml.matchAll(/src=["'](earth-background\.bundle\.[a-f0-9]{12}\.js)["']/g)]
    if (backgrounds.length > 1 || (backgrounds.length === 1 &&
        (!manifest.assets[backgrounds[0][1]] || !aliasMatches(backgrounds[0][1], "earth-background.bundle.js"))))
      throw Error("Mismatched versioned Earth background and legacy alias")
  }
  return manifest
}
// Keep the immediately previous HTML-referenced immutable scripts available
// while a deployment switches. A browser can receive old HTML just before the
// switch and request its scripts immediately afterwards. Only verified prior
// assets are retained, and the next import drops older unreferenced versions.
async function retainPreviousEntries(destination, staging, manifest) {
  let previous
  try {
    previous = JSON.parse(await fs.readFile(path.join(destination, "earth-build.json"), "utf8"))
  } catch {
    previous = { assets: {} }
  }
  if (previous.format !== 1 || !previous.assets) previous = { assets: {} }
  const names = new Set()
  let legacyInteractive = false, legacyBackground = false
  for (const page of ["rendering_globe-atmosphere.html", "earth-background.html"]) {
    let html
    try { html = await fs.readFile(path.join(destination, page), "utf8") } catch { continue }
    if (page === "rendering_globe-atmosphere.html" && /src=["']rendering_globe-atmosphere_bundle\.js["']/.test(html))
      legacyInteractive = true
    if (page === "earth-background.html" && /src=["']earth-background\.bundle\.js["']/.test(html))
      legacyBackground = true
    for (const match of html.matchAll(/src=["']((?:earth-shared|earth-background\.bundle|rendering_globe-atmosphere_bundle)\.[a-f0-9]{12}\.js)["']/g)) {
      names.add(match[1])
      names.add(match[1] + ".LICENSE.txt")
    }
    for (const match of html.matchAll(/<meta name=["']earth-worker-(earth-(?:decoder|horizon|noise|bc7|lidar|canopy|weather|road-worker))["'] content=["'](earth-(?:decoder|horizon|noise|bc7|lidar|canopy|weather|road-worker)\.[a-f0-9]{12}\.js)["']/g)) {
      if (!match[2].startsWith(match[1] + ".")) continue
      names.add(match[2])
      names.add(match[2] + ".LICENSE.txt")
    }
    for (const match of html.matchAll(/<meta name=["']earth-versioned-asset["'] content=["']((?:[0-9]+|earth-[a-z0-9-]+|earth-background\.bundle|rendering_globe-atmosphere_bundle)\.[a-f0-9]{12}\.js)["']/g)) {
      names.add(match[1])
      names.add(match[1] + ".LICENSE.txt")
    }
  }
  const retained = []
  // During the first migration only, old HTML still requests fixed URLs.
  // Preserve those exact files so its old shared chunk, entry and decoder
  // remain mutually compatible. The new HTML uses its hashed files instead.
  if (legacyInteractive || legacyBackground) {
    let priorNames = []
    try { priorNames = await fs.readdir(destination) } catch { /* First import has no previous directory. */ }
    const aliases = priorNames.filter(name =>
      /^(?:[0-9]+|earth-[a-z0-9-]+(?:\.bundle)?|decoder\.bundle|rendering_globe-atmosphere_bundle)\.js$/.test(name)
    )
    for (const alias of aliases) {
      for (const name of [alias, alias + ".LICENSE.txt"]) {
        let content
        try { content = await fs.readFile(path.join(destination, name)) } catch { continue }
        const checksum = hash(content)
        if (previous.assets[name] && checksum !== previous.assets[name]) continue
        if (name.endsWith(".js") && /pk\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/.test(content.toString("utf8"))) continue
        await fs.writeFile(path.join(staging, name), content)
        manifest.assets[name] = checksum
        if (name === alias) (manifest.legacyAliases ||= {})[alias] = checksum
        retained.push(name)
      }
    }
  }
  for (const name of names) {
    if (manifest.assets[name]) continue
    let content
    try { content = await fs.readFile(path.join(destination, name)) } catch { continue }
    const checksum = hash(content)
    if (previous.assets[name] && checksum !== previous.assets[name]) continue
    if (name.endsWith(".js") && /pk\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/.test(content.toString("utf8"))) continue
    await fs.writeFile(path.join(staging, name), content)
    manifest.assets[name] = checksum
    retained.push(name)
  }
  if (retained.length) {
    manifest.retainedAssets = retained.sort()
    await fs.writeFile(path.join(staging, "earth-build.json"), JSON.stringify(manifest, null, 2) + "\n")
  }
}
// Gatsby's development watcher can miss nested files after an atomic static
// directory replacement. Mirror only the verified Earth-owned output into an
// existing generated public/harp directory; never touch other public assets.
async function mirrorEarth(source, destination) {
  const manifest = await verify(source)
  const parent = path.dirname(path.resolve(destination))
  await fs.mkdir(parent, { recursive: true })
  const staging = await fs.mkdtemp(path.join(path.dirname(parent), ".earth-public-stage-"))
  const backup = staging + ".previous"
  let moved = false
  try {
    for (const name of [...Object.keys(manifest.assets), "earth-build.json"]) {
      const target = path.join(staging, name)
      await fs.mkdir(path.dirname(target), { recursive: true })
      await fs.copyFile(path.join(source, name), target)
    }
    await verify(staging)
    try { await fs.rename(destination, backup); moved = true } catch (error) {
      if (error.code !== "ENOENT") throw error
    }
    try { await fs.rename(staging, destination) } catch (error) {
      if (moved) await fs.rename(backup, destination)
      throw error
    }
    if (moved) await fs.rm(backup, { recursive: true, force: true })
  } finally { await fs.rm(staging, { recursive: true, force: true }) }
}
async function mirrorDevelopmentIfPresent(destination) {
  const siteRoot = path.resolve(__dirname, "..")
  if (path.resolve(destination) !== path.join(siteRoot, "static/harp")) return
  const publicEarth = path.join(siteRoot, "public/harp")
  try { await fs.access(publicEarth) } catch { return }
  // Allow pending static-watch events to drain, and retry if a late event
  // changed the generated tree while it was being replaced.
  for (let attempt = 0; attempt < 2; attempt++) {
    await mirrorEarth(destination, publicEarth)
    await new Promise(resolve => setTimeout(resolve, 400))
    try { await verify(publicEarth); return } catch (error) {
      if (attempt === 1) throw error
    }
  }
}
async function importEarth(source, destination) {
  const manifest = await verify(source),
    parent = path.dirname(path.resolve(destination))
  await fs.mkdir(parent, { recursive: true })
  // Gatsby watches static recursively, including directories waiting to be published.
  const stagingParent =
    parent === path.resolve(__dirname, "../static")
      ? path.dirname(parent)
      : parent
  const staging = await fs.mkdtemp(path.join(stagingParent, ".earth-stage-")),
    backup = staging + ".previous"
  let moved = false
  try {
    for (const name of [...Object.keys(manifest.assets), "earth-build.json"]) {
      const target = path.join(staging, name)
      await fs.mkdir(path.dirname(target), { recursive: true })
      await fs.copyFile(path.join(source, name), target)
    }
    await retainPreviousEntries(destination, staging, manifest)
    await verify(staging)
    try {
      await fs.rename(destination, backup)
      moved = true
    } catch (error) {
      if (error.code !== "ENOENT") throw error
    }
    try {
      await fs.rename(staging, destination)
    } catch (error) {
      if (moved) await fs.rename(backup, destination)
      throw error
    }
    if (moved) await fs.rm(backup, { recursive: true, force: true })
    await mirrorDevelopmentIfPresent(destination)
    return manifest
  } finally {
    await fs.rm(staging, { recursive: true, force: true })
  }
}
module.exports = { verify, importEarth, mirrorEarth }
if (require.main === module) {
  const source = path.resolve(
      process.argv[2] || process.env.HARP_SRC || "../xyz-threejs/dist/earth",
    ),
    destination = path.resolve(process.argv[3] || "static/harp")
  importEarth(source, destination)
    .then(m =>
      console.log(
        "Imported verified Earth source",
        m.sourceRevision,
        "input",
        m.inputHash,
      ),
    )
    .catch(error => {
      console.error(error.message)
      process.exitCode = 1
    })
}
