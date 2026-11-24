// Build optimized textures and capture the poster from the actual Earth renderer.
// Run build:maps and sync:harp first when renderer source changes.
const fs = require("node:fs/promises")
const path = require("node:path")
const http = require("node:http")
const { createRequire } = require("node:module")
const { firefox } = require("playwright")
const sharp = createRequire(
  require.resolve("gatsby-plugin-sharp/package.json"),
)("sharp")
const root = path.resolve(__dirname, "..")
const staticRoot = path.join(root, "static")
const destination = path.join(staticRoot, "earth-background")
async function build() {
  await fs.mkdir(destination, { recursive: true })
  for (const [name, file, width, webp] of [
    [
      "surface",
      "img/worldColour.5400x2700.jpg",
      4096,
      { quality: 80, effort: 6 },
    ],
    [
      "surface-2k",
      "img/worldColour.5400x2700.jpg",
      2048,
      { quality: 80, effort: 6 },
    ],
    [
      "surface-medium",
      "img/worldColour.5400x2700.jpg",
      1024,
      { quality: 80, effort: 6 },
    ],
    ["lights", "harp/resources/earth/night-lights.jpg", 2048, { quality: 85 }],
  ]) {
    await sharp(path.join(staticRoot, file))
      .resize(width, width / 2)
      .webp(webp)
      .toFile(path.join(destination, name + ".webp"))
  }
  const server = http.createServer(async (req, res) => {
    const file = path.resolve(
      staticRoot,
      "." + new URL(req.url, "http://localhost").pathname,
    )
    if (!file.startsWith(staticRoot + path.sep)) {
      res.writeHead(403).end()
      return
    }
    try {
      const data = await fs.readFile(file)
      res.setHeader(
        "Content-Type",
        {
          ".html": "text/html",
          ".js": "text/javascript",
          ".json": "application/json",
          ".webp": "image/webp",
          ".jpg": "image/jpeg",
          ".png": "image/png",
        }[path.extname(file)] || "application/octet-stream",
      )
      res.end(data)
    } catch {
      res.writeHead(404).end()
    }
  })
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve))
  let browser
  try {
    browser = await firefox.launch({
      firefoxUserPrefs: { "webgl.enable-webgl2": false },
    })
    const page = await browser.newPage({
      viewport: { width: 1440, height: 900 },
    })
    page.on("pageerror", e => console.error(e.message))
    await page.addInitScript(() => {
      window.addEventListener("earth-ready", event => {
        window.earthCapture = event.detail
      })
      window.addEventListener("message", event => {
        if (event.data?.type === "earth-background-ready") {
          window.earthCapture.background.setPaused(true)
          window.earthCaptured = true
        }
      })
    })
    await page.goto(
      `http://127.0.0.1:${server.address().port}/harp/earth-background.html`,
    )
    await page.waitForFunction(() => window.earthCaptured, null, {
      polling: 100,
      timeout: 60000,
    })
    const png = await page.screenshot()
    await sharp(png)
      .webp({ quality: 85 })
      .toFile(path.join(destination, "poster.webp"))
    await sharp(png)
      .resize(720, 450)
      .webp({ quality: 80 })
      .toFile(path.join(destination, "poster-mobile.webp"))
  } finally {
    await browser?.close()
    await new Promise(resolve => server.close(resolve))
  }
  for (const file of await fs.readdir(destination))
    console.log(
      file,
      (await fs.stat(path.join(destination, file))).size,
      "bytes",
    )
}
build().catch(error => {
  console.error(error)
  process.exitCode = 1
})
