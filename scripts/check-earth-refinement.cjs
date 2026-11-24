// Compare equal tile budgets using screen samples from the live globe camera.
const assert = require("node:assert/strict")
const { chromium } = require("playwright")
const {
  mapboxToken,
  installProbe,
  browserErrors,
  reportFailure,
} = require("./lib/earth-browser.cjs")

const cases = [
  ["coastal horizon", 34.402, -119.841, 8, 750, 79, 320],
  ["coast overhead", 34.402, -119.841, 8, 750, 0, 320],
  ["city blocks", 40.748, -73.986, 20, 450, 55, 20],
  ["open ocean", 0, -140, 0, 750, 0, 0],
  ["regional overview", 46.5, 8.1, 0, 75000, 50, 0],
]

// Runs inside the browser. Estimate an isotropic texture footprint at each
// sample from adjacent pixel rays on the projected globe.
function sampleView() {
  const map = window.probe.map
  const { clientWidth: w, clientHeight: h, width } = map.canvas
  const pixel = w / width
  function uv(x, y) {
    const g = map.getGeoCoordinatesAt(x, y)
    if (!g || Math.abs(g.latitude) > 85.0511) return null
    return [
      (g.longitude + 180) / 360,
      (1 - Math.asinh(Math.tan((g.latitude * Math.PI) / 180)) / Math.PI) / 2,
    ]
  }
  const samples = []
  for (let row = 0; row < 36; row++) {
    for (let col = 0; col < 64; col++) {
      const x = ((col + 0.5) * w) / 64,
        y = ((row + 0.5) * h) / 36
      const p = uv(x, y),
        a = uv(x + pixel, y),
        b = uv(x, y + pixel)
      if (!p || !a || !b) continue
      const delta = q =>
        Math.hypot(q[0] - p[0] - Math.round(q[0] - p[0]), q[1] - p[1])
      const footprint = Math.max(delta(a), delta(b))
      const z = Math.min(
        19,
        Math.max(0, Math.ceil(Math.log2(1 / (512 * footprint)))),
      )
      samples.push({
        row,
        col,
        u: (p[0] + 1) % 1,
        v: p[1],
        z,
        central: Math.hypot(x / w - 0.5, y / h - 0.5) < 0.25,
      })
    }
  }
  return { samples, drawingWidth: width }
}

function compare(samples, policy, budget, heatmap) {
  // Assume a common, fully resident z15 base. A missing child inherits its
  // nearest resident ancestor. Costs are equal-sized decoded 512px pages.
  const resident = samples.map(() => 15)
  const candidates = new Map()
  const maxLevel = samples.reduce((highest, s) => Math.max(highest, s.z), 15)
  samples.forEach(({ u, v }, i) => {
    for (let level = 16; level <= maxLevel; level++) {
      const n = 2 ** level
      const key = [level, Math.floor(u * n), Math.floor(v * n)].join("/")
      if (!candidates.has(key)) candidates.set(key, { level, indices: [] })
      candidates.get(key).indices.push(i)
    }
  })
  let used = 0
  while (used < budget) {
    let best,
      bestScore = 0
    for (const tile of candidates.values()) {
      let score = 0
      for (const i of tile.indices) {
        const gain = Math.min(samples[i].z, tile.level) - resident[i]
        if (
          gain <= 0 ||
          (policy === "progressive" && tile.level !== resident[i] + 1)
        )
          continue
        score += gain * (policy === "focus" && samples[i].central ? 4 : 1)
      }
      if (score > bestScore) {
        best = tile
        bestScore = score
      }
    }
    if (!best) break
    for (const i of best.indices)
      resident[i] = Math.max(resident[i], best.level)
    used++
  }
  const deficit = samples.reduce((n, s) => n + Math.max(0, s.z - 15), 0)
  const missing = samples.reduce(
    (n, s, i) => n + Math.max(0, s.z - resident[i]),
    0,
  )
  if (heatmap) {
    samples.forEach((s, i) => {
      heatmap[s.row * 64 + s.col] = Math.max(0, s.z - resident[i])
    })
  }
  assert.ok(used <= budget && missing <= deficit)
  return deficit ? Math.round(100 * (1 - missing / deficit)) : null
}

function writeChart(rows, path) {
  const colors = ["#237568", "#eed88c", "#e89b54", "#bd5a45", "#812d49"]
  const columns = ["Zoom 15 base", "Progressive", "Coverage", "Center priority"]
  const svg = [
    '<svg xmlns="http://www.w3.org/2000/svg" width="920" height="780" viewBox="0 0 920 780"><rect width="100%" height="100%" fill="#fff"/><g font-family="sans-serif" fill="#142b32">',
  ]
  const label = (x, y, value, size) =>
    svg.push(`<text x="${x}" y="${y}" font-size="${size}">${value}</text>`)
  label(
    18,
    33,
    "Where four extra satellite tiles improve projected resolution",
    25,
  )
  label(18, 63, "Zoom levels still missing", 15)
  ;[...colors, "#dbe3e9"].forEach((color, i) => {
    const x = 205 + 86 * i
    svg.push(`<rect x="${x}" y="49" width="19" height="17" fill="${color}"/>`)
    label(x + 25, 63, i === 5 ? "Sky" : i, 15)
  })
  columns.forEach((name, i) => label(151 + i * 192, 98, name, 16))
  rows.forEach(({ name, maps }, r) => {
    const y = 110 + r * 125
    label(12, y + 58, name, 15)
    maps.forEach((cells, c) => {
      const x = 150 + c * 192
      svg.push(
        `<svg x="${x}" y="${y}" width="180" height="102" viewBox="0 0 64 36" shape-rendering="crispEdges"><rect width="64" height="36" fill="#dbe3e9"/>`,
      )
      for (let row = 0; row < 36; row++) {
        for (let col = 0; col < 64; ) {
          const start = col,
            value = cells[row * 64 + col++]
          while (col < 64 && cells[row * 64 + col] === value) col++
          if (value !== undefined)
            svg.push(
              `<rect x="${start}" y="${row}" width="${col - start}" height="1" fill="${colors[value]}"/>`,
            )
        }
      }
      svg.push("</svg>")
    })
  })
  label(
    18,
    754,
    "Modeled from camera rays. Green meets the sampling target. Image content and terrain occlusion are excluded.",
    15,
  )
  require("node:fs").writeFileSync(path, svg.join("\n") + "</g></svg>")
}

async function main() {
  const rows = []
  const base = process.env.EARTH_PREVIEW_URL || "http://127.0.0.1:8014"
  const url = new URL("/harp/rendering_globe-atmosphere.html", base)
  url.searchParams.set("mapbox_token", await mapboxToken())
  const browser = await chromium.launch()
  try {
    for (const [
      name,
      latitude,
      longitude,
      altitude,
      distance,
      tilt,
      heading,
    ] of cases) {
      const page = await browser.newPage({
        viewport: { width: 1280, height: 720 },
      })
      const constrained = process.argv.includes("--constrained")
      const errors = browserErrors(page)
      const requests = []
      await installProbe(page)
      await page.goto(url.href, { waitUntil: "domcontentloaded" })
      await page.waitForFunction(() => !!window.probe?.map.earth)
      if (constrained) {
        const session = await page.context().newCDPSession(page)
        await session.send("Network.enable")
        await session.send("Network.emulateNetworkConditions", {
          offline: false,
          latency: 150,
          downloadThroughput: 500000,
          uploadThroughput: 125000,
        })
      }
      page.on("request", req => {
        const match = new URL(req.url()).pathname.match(
          /\/mapbox\.satellite\/(\d+)\//,
        )
        if (match) requests.push(Number(match[1]))
      })
      const frame = await page.evaluate(
        pose => {
          const m = window.probe.map
          m.lookAt(pose)
          m.update()
          return m.frameNumber
        },
        { target: { latitude, longitude, altitude }, distance, tilt, heading },
      )
      await page.waitForFunction(f => window.probe.map.frameNumber > f, frame)
      await page.waitForTimeout(3000)
      const { samples, drawingWidth } = await page.evaluate(sampleView)
      assert.ok(samples.length && samples.every(s => Number.isFinite(s.z)))
      assert.deepEqual(errors, [])
      const scores = {}
      const maps = [[]]
      compare(samples, "coverage", 0, maps[0])
      for (const policy of ["progressive", "coverage", "focus"]) {
        const cells = []
        maps.push(cells)
        scores[policy] = [4, 16, 64].map(n =>
          compare(samples, policy, n, n === 4 ? cells : undefined),
        )
      }
      rows.push({ name, maps })
      console.log(
        JSON.stringify({
          name,
          constrained,
          drawingWidth,
          samples: samples.length,
          wantsFiner: samples.filter(s => s.z > 15).length,
          observedRequests: requests.length,
          highestRequested: requests.length ? Math.max(...requests) : null,
          deficitRecoveredPct: scores,
        }),
      )
      await page.close()
    }
    if (process.env.EARTH_REFINEMENT_CHART)
      writeChart(rows, process.env.EARTH_REFINEMENT_CHART)
  } finally {
    await browser.close()
  }
}
main().catch(reportFailure)
