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
    "resources/earth-theme.json",
    "resources/earth/night-lights.jpg",
    "resources/earth/clouds.jpg",
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
    if (hash(await fs.readFile(file)) !== expected)
      throw Error("Earth asset checksum mismatch: " + name)
  }
  const bundle = await fs.readFile(
    path.join(directory, "rendering_globe-atmosphere_bundle.js"),
    "utf8",
  )
  if (/pk\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/.test(bundle))
    throw Error("Earth build contains a literal Mapbox token")
  return manifest
}
async function importEarth(source, destination) {
  const manifest = await verify(source),
    parent = path.dirname(path.resolve(destination))
  await fs.mkdir(parent, { recursive: true })
  const staging = await fs.mkdtemp(path.join(parent, ".earth-stage-")),
    backup = staging + ".previous"
  let moved = false
  try {
    for (const name of [...Object.keys(manifest.assets), "earth-build.json"]) {
      const target = path.join(staging, name)
      await fs.mkdir(path.dirname(target), { recursive: true })
      await fs.copyFile(path.join(source, name), target)
    }
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
    return manifest
  } finally {
    await fs.rm(staging, { recursive: true, force: true })
  }
}
module.exports = { verify, importEarth }
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
