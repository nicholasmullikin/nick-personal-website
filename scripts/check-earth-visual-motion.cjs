// Run against the live Earth demo. Evidence goes to the optional directory argument.
const fs = require("node:fs/promises")
const os = require("node:os")
const path = require("node:path")
const { createRequire } = require("node:module")
const { chromium } = require("playwright")
const sharp = createRequire(require.resolve("gatsby-plugin-sharp"))("sharp")
const {
  browserErrors,
  installProbe,
  mapboxToken,
  previewURL,
  reportFailure,
} = require("./lib/earth-browser.cjs")

// Camera tuples are latitude, longitude, target elevation (m), range (m), tilt and heading (degrees).
const routes = [
  {
    name: "orbit",
    from: [25, -65, 0, 23500000, 0, 0],
    to: [26, -59, 0, 19000000, 4, 8],
  },
  {
    name: "terrain",
    from: [46.85, -121.76, 2300, 14000, 83, 335],
    to: [46.85, -121.76, 2300, 10500, 84, 353],
  },
  {
    name: "coast",
    from: [34.405, -119.844, 5, 12000, 52, 320],
    to: [34.41, -119.835, 6, 7600, 58, 326],
  },
  {
    name: "clouds",
    from: [38, -85, 0, 145000, 40, 21],
    to: [38.08, -84.83, 0, 130000, 45, 24],
  },
  {
    name: "buildings",
    from: [40.751, -73.986, 20, 1600, 60, 19],
    to: [40.752, -73.984, 20, 1050, 65, 34],
  },
]

// Sample the composited WebGL canvas before the browser discards its drawing buffer.
// This excludes DOM controls, which otherwise make a blank map pass a contrast test.
function readRenderedFrame({ fullSize, pose }) {
  const map = window.probe.map
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      map.removeEventListener("didrender", rendered)
      reject(new Error("No rendered frame received within 10 seconds"))
    }, 10000)
    function rendered() {
      map.removeEventListener("didrender", rendered)
      clearTimeout(timeout)
      try {
        const source = map.renderer.domElement
        const canvas = document.createElement("canvas")
        canvas.width = 144
        canvas.height = 96
        canvas
          .getContext("2d")
          .drawImage(source, 0, 0, canvas.width, canvas.height)
        const sample = canvas.toDataURL("image/png").split(",")[1]
        resolve({
          sample,
          image: fullSize
            ? source.toDataURL("image/png").split(",")[1]
            : undefined,
        })
      } catch (error) {
        reject(error)
      }
    }
    map.addEventListener("didrender", rendered)
    if (pose) {
      const [latitude, longitude, altitude, distance, tilt, heading] = pose
      map.lookAt({
        target: { latitude, longitude, altitude },
        distance,
        tilt,
        heading,
      })
    }
    map.update()
  })
}

function summarize(pixels) {
  let dark = 0,
    bright = 0
  const histogram = new Uint32Array(256)
  for (let i = 0; i < pixels.length; i += 3) {
    const y = Math.round((pixels[i] + 2 * pixels[i + 1] + pixels[i + 2]) / 4)
    histogram[y]++
    if (y < 18) dark++
    if (y > 60) bright++
  }
  const count = pixels.length / 3
  function quantile(frac) {
    let sum = 0
    return histogram.findIndex(n => (sum += n) >= count * frac)
  }
  return {
    range: quantile(0.98) - quantile(0.02),
    dark: dark / count,
    bright: bright / count,
  }
}

function difference(a, b) {
  let total = 0,
    large = 0
  for (let i = 0; i < a.length; i += 3) {
    const change =
      (Math.abs(a[i] - b[i]) +
        Math.abs(a[i + 1] - b[i + 1]) +
        Math.abs(a[i + 2] - b[i + 2])) /
      3
    total += change
    if (change > 70) large++
  }
  return { mean: (total * 3) / a.length, large: (large * 3) / a.length }
}

async function capture(page, fullSize = false, pose) {
  const { sample, image } = await page.evaluate(readRenderedFrame, {
    fullSize,
    pose,
  })
  const pixels = await sharp(Buffer.from(sample, "base64"))
    .removeAlpha()
    .raw()
    .toBuffer()
  return { png: image && Buffer.from(image, "base64"), pixels }
}

async function runRoute(page, route, out) {
  const { name, from, to } = route
  await page.evaluate(
    ({ name, lon }) => {
      const earth = window.probe.map.earth
      earth.setSunHour((12 + (-112.15 - lon) / 15 + 24) % 24)
      earth.setMode(name === "terrain" ? "c" : "a")
      earth.environment.setClouds(name === "clouds")
      earth.buildings.setEnabled(true)
    },
    { name, lon: from[1] },
  )
  await capture(page, false, from)
  if (name === "buildings") {
    await page.waitForFunction(
      () => window.probe.map.earth.buildings.stats.buildings > 50,
      null,
      { timeout: 60000 },
    )
  }
  await page.waitForFunction(() => {
    const cut = window.probe.map.visibleTileSet.dataSourceTileList.find(
      entry => entry.dataSource.name === "terrain",
    )
    return cut?.renderedTiles.size > 0
  })
  // Allow the initial view to resolve. Subsequent LOD changes occur during the measured move.
  await page.waitForTimeout(1200)
  const frames = [],
    images = [],
    failures = []
  let first, previous, endpoint
  const half = 16
  for (let i = 0; i <= half * 2; i++) {
    const t = i <= half ? i / half : (2 * half - i) / half
    const pose = from.map((x, j) => x + t * (to[j] - x))
    const keep = i === 0 || i === half || i === half * 2
    const { png, pixels } = await capture(page, keep, pose)
    const stats = summarize(pixels)
    if (stats.range < 9 || stats.bright < 0.02)
      failures.push(`blank or near-uniform frame ${i}`)
    const change = previous && difference(previous, pixels)
    if (change?.large > 0.25)
      failures.push(`abrupt full-screen change at frame ${i}`)
    if (keep) {
      const file = `${name}-${i}.png`
      await fs.writeFile(path.join(out, file), png)
      images.push(file)
    }
    if (i === 0) first = pixels
    if (i === half) endpoint = pixels
    frames.push({ i, ...stats, change })
    previous = pixels
  }
  const outbound = difference(first, endpoint).mean
  const returned = difference(first, previous).mean
  if (outbound < 1)
    failures.push("camera motion produced indistinguishable endpoints")
  if (name === "orbit" && (frames[0].dark < 0.1 || frames[0].bright < 0.1))
    failures.push("globe or surrounding sky missing")
  if (returned > Math.max(8, outbound * 0.7))
    failures.push("return pose no longer resembles its initial frame")
  if (name === "orbit" && frames[half].bright < frames[0].bright + 0.035)
    failures.push("planet failed to enlarge on approach")
  if (name === "terrain") {
    // The close endpoint frames Rainier against clear sky. A flat DEM leaves a level skyline.
    function skyline(x) {
      for (let y = 0; y < 96; y++) {
        const i = (144 * y + x) * 3
        if (
          endpoint[i + 2] < endpoint[i] + 15 ||
          endpoint[i + 2] < endpoint[i + 1] + 3
        )
          return y
      }
      return 96
    }
    if (Math.min(skyline(12), skyline(132)) - skyline(72) < 5)
      failures.push("terrain summit missing from silhouette")
  }
  if (name === "coast") {
    // With this heading, the lower-left quarter is ocean and the upper-right is land.
    const regionLuma = (x0, y0) => {
      let sum = 0
      for (let y = y0; y < y0 + 20; y++)
        for (let x = x0; x < x0 + 32; x++) {
          const k = (144 * y + x) * 3
          sum += (endpoint[k] + 2 * endpoint[k + 1] + endpoint[k + 2]) / 4
        }
      return sum / (20 * 32)
    }
    if (regionLuma(104, 3) - regionLuma(3, 70) < 15)
      failures.push("coast lost land/ocean separation")
  }
  let layerDifference
  if (name === "clouds" || name === "buildings") {
    // Compare the same camera with the tested layer removed. Counts alone cannot prove it drew.
    await page.evaluate(name => {
      const earth = window.probe.map.earth
      if (name === "clouds") earth.environment.setClouds(false)
      else earth.buildings.setEnabled(false)
    }, name)
    await capture(page)
    const control = await capture(page, true)
    await fs.writeFile(path.join(out, name + "-off.png"), control.png)
    layerDifference = difference(previous, control.pixels).mean
    if (layerDifference < 0.5)
      failures.push(`${name} toggle had no visible effect`)
  }
  return { name, outbound, returned, layerDifference, frames, images, failures }
}

async function main() {
  const state =
    process.env.XDG_STATE_HOME || path.join(os.homedir(), ".local", "state")
  const out = path.resolve(
    process.argv[2] || path.join(state, "earth-visual-motion"),
  )
  await fs.mkdir(out, { recursive: true })
  const browser = await chromium.launch({
    args: process.env.EARTH_FLIGHT_SOFTWARE
      ? ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"]
      : [
          "--enable-gpu",
          "--use-angle=vulkan",
          "--enable-features=Vulkan",
          "--use-vulkan=native",
        ],
  })
  try {
    const page = await browser.newPage({
      viewport: { width: 864, height: 576 },
    })
    await installProbe(page)
    await page.clock.setFixedTime(new Date("2026-06-21T12:00:00Z"))
    const errors = browserErrors(page)
    const url = new URL("/harp/rendering_globe-atmosphere.html", previewURL)
    url.searchParams.set("mapbox_token", await mapboxToken())
    await page.goto(url.href, { waitUntil: "domcontentloaded" })
    await page.waitForFunction(
      () =>
        window.probe?.map.earth.environment.status.noiseReady &&
        window.probe.map.earth.environment.status.cloudReady,
    )
    await page.evaluate(() => {
      const env = window.probe.map.earth.environment
      Object.defineProperty(env.uniforms.cloudTime, "value", {
        get: () => 30,
        set() {},
      })
      env.setCloudQuality("balanced")
    })
    const bundle = await page.evaluate(() =>
      [...document.scripts]
        .map(s => s.src.split("/").pop())
        .find(name => name.startsWith("earth-shared.")),
    )
    const results = []
    for (const route of routes) {
      results.push(await runRoute(page, route, out))
      await fs.writeFile(
        path.join(out, "report.json"),
        JSON.stringify({ bundle, errors, results }, null, 2),
      )
    }
    const tiles = []
    for (const [row, result] of results.entries()) {
      const labels = ["start", "turnaround", "return"]
      for (const [column, file] of result.images.entries()) {
        const x = column * 288
        const y = row * 216
        const caption = `<svg xmlns="http://www.w3.org/2000/svg" width="288" height="24"><text x="8" y="17" fill="white" font-family="sans-serif" font-size="13">${result.name} · ${labels[column]}</text></svg>`
        tiles.push({ input: Buffer.from(caption), top: y, left: x })
        tiles.push({
          input: await sharp(path.join(out, file))
            .resize(288, 192)
            .png()
            .toBuffer(),
          top: y + 24,
          left: x,
        })
      }
    }
    await sharp({
      create: {
        width: 864,
        height: results.length * 216,
        channels: 3,
        background: "#000",
      },
    })
      .composite(tiles)
      .jpeg({ quality: 90 })
      .toFile(path.join(out, "review.jpg"))
    for (const r of results)
      console.log(r.name, {
        motion: r.outbound,
        returnDifference: r.returned,
        layerDifference: r.layerDifference,
      })
    const failures = results.flatMap(r => r.failures.map(f => r.name + " " + f))
    if (errors.length || failures.length)
      throw Error([...errors, ...failures].join("\n") + "\n" + out)
    console.log("Visual motion checks passed", out)
  } finally {
    await browser.close()
  }
}
main().catch(reportFailure)
