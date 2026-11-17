const {
  mapboxToken,
  reportFailure,
  installProbe,
} = require("./lib/earth-browser.cjs")
// Browser regression against the actual vendored assets and live DEM imagery.
// Run: node scripts/check-map-continuity.cjs [artifact-directory]
const { chromium } = require("playwright")
const fs = require("node:fs/promises")
const path = require("node:path")
const http = require("node:http")
const assert = require("node:assert/strict")
const root = path.resolve(
  process.env.HARP_ASSET_ROOT || path.join(__dirname, "../static/harp"),
)
const output = path.resolve(process.argv[2] || "/tmp/harp-continuity")
async function main() {
  await fs.mkdir(output, { recursive: true })
  const token = await mapboxToken()
  const server = http.createServer(async (req, res) => {
    const pathname = new URL(req.url, "http://localhost").pathname
    const assetRoot = pathname.startsWith("/img/")
      ? path.resolve(__dirname, "../static")
      : root
    const file = path.resolve(assetRoot, "." + pathname)
    if (!file.startsWith(assetRoot + path.sep)) {
      res.writeHead(403).end()
      return
    }
    try {
      let body = await fs.readFile(file)
      const ext = path.extname(file)
      res.setHeader(
        "Content-Type",
        ext === ".js"
          ? "application/javascript"
          : ext === ".html"
            ? "text/html"
            : ext === ".json"
              ? "application/json"
              : "application/octet-stream",
      )
      res.end(body)
    } catch {
      res.writeHead(404).end()
    }
  })
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve))
  let browser
  try {
    browser = await chromium.launch({ headless: true })
    const page = await browser.newPage({
      viewport: { width: 800, height: 500 },
    })
    await installProbe(page)
    const errors = []
    page.on("pageerror", e => errors.push(e.message))
    await page.goto(
      `http://127.0.0.1:${server.address().port}/rendering_globe-atmosphere.html?mapbox_token=${token}`,
    )
    const cases = [
      {
        name: "original",
        zoomLevel: 8,
        tilt: 52,
        heading: 28,
        target: { latitude: 36.1, longitude: -112.15 },
      },
      {
        name: "zoom-in",
        zoomLevel: 9,
        tilt: 65,
        heading: 95,
        target: { latitude: 36.1, longitude: -112.15 },
      },
      {
        name: "pan-and-zoom-out",
        zoomLevel: 7,
        tilt: 45,
        heading: -40,
        target: { latitude: 37, longitude: -111 },
      },
      {
        name: "return-original",
        zoomLevel: 8,
        tilt: 52,
        heading: 28,
        target: { latitude: 36.1, longitude: -112.15 },
      },
    ]
    const results = []
    for (const view of cases) {
      await page.waitForFunction(() => window.probe?.map)
      await page.evaluate(view => window.probe.map.lookAt(view), view)
      await page.waitForTimeout(10000)
      await page.waitForFunction(
        () =>
          window.probe.map.earth.stats.cache > 0 &&
          window.probe.map.earth.stats.pending === 0 &&
          window.probe.map.earth.stats.fading === 0,
        null,
        { timeout: 60000 },
      )
      const metrics = await page.evaluate(() => {
        const { map, THREE } = window.probe,
          W = 64,
          N = 63
        const tiles = [
          ...map.visibleTileSet.dataSourceTileList
            .find(e => e.dataSource.name === "terrain")
            .renderedTiles.values(),
        ]
        const read = (t, i, field) => {
          const o = t.objects.find(o => o.isMesh),
            v = new THREE.Vector3().fromBufferAttribute(
              o.geometry.attributes[field],
              i,
            )
          const m = t.boundingBox
            .getRotationMatrix()
            .clone()
            .setPosition(t.center)
          return field === "position"
            ? v.applyMatrix4(m)
            : v.applyMatrix3(new THREE.Matrix3().setFromMatrix4(m))
        }
        let maxGap = 0,
          maxNormalError = 0,
          pairs = 0
        for (const a of tiles)
          for (const b of tiles) {
            const { level: z, column: x, row: y } = a.tileKey,
              { level: zz, column: xx, row: yy } = b.tileKey
            if (zz < z) continue
            const s = 2 ** (zz - z)
            let ia, ib, start
            if (xx === (x + 1) * s && yy >= y * s && yy < (y + 1) * s) {
              ia = i => i * W + N
              ib = i => i * W
              start = yy / s - y
            } else if (yy === (y + 1) * s && xx >= x * s && xx < (x + 1) * s) {
              ia = i => N * W + i
              ib = i => i
              start = xx / s - x
            } else if (
              zz > z &&
              xx + 1 === x * s &&
              yy >= y * s &&
              yy < (y + 1) * s
            ) {
              ia = i => i * W
              ib = i => i * W + N
              start = yy / s - y
            } else if (
              zz > z &&
              yy + 1 === y * s &&
              xx >= x * s &&
              xx < (x + 1) * s
            ) {
              ia = i => i
              ib = i => N * W + i
              start = xx / s - x
            } else continue
            pairs++
            for (let i = 0; i < W; i++) {
              const u = (start + i / N / s) * N,
                j = Math.floor(u)
              for (const field of ["position", "normal"]) {
                const expected = read(a, ia(j), field).lerp(
                  read(a, ia(Math.min(j + 1, N)), field),
                  u - j,
                )
                const delta = expected.distanceTo(read(b, ib(i), field))
                if (field === "position") maxGap = Math.max(maxGap, delta)
                else maxNormalError = Math.max(maxNormalError, delta)
              }
            }
          }
        return { tiles: tiles.length, pairs, maxGap, maxNormalError }
      })
      assert.ok(metrics.pairs > 0, `${view.name}: no adjacent terrain`)
      assert.ok(metrics.maxGap < 0.25, `${view.name}: ${metrics.maxGap}m gap`)
      assert.ok(
        metrics.maxNormalError < 0.00001,
        `${view.name}: normals differ by ${metrics.maxNormalError}`,
      )
      results.push({ view: view.name, ...metrics })
      console.log(view.name, metrics)
      await page.evaluate(() => {
        document
          .querySelector("#debug-hud")
          ?.style.setProperty("visibility", "hidden")
        for (const c of document.querySelectorAll("canvas"))
          if (c.id !== "mapCanvas") c.style.visibility = "hidden"
      })
      await page.screenshot({ path: path.join(output, view.name + ".png") })
    }
    await page.evaluate(() => {
      const { map } = window.probe
      for (const e of map.visibleTileSet.dataSourceTileList)
        if (e.dataSource.name === "terrain")
          for (const t of e.renderedTiles.values())
            for (const o of t.objects)
              if (o.isMesh) {
                o.material.fragmentShader = o.material.fragmentShader.replace(
                  "gl_FragColor=vec4(displayColor(lit*transmission+haze),1.);",
                  "gl_FragColor=vec4(vec3(.7),1.);",
                )
                o.material.needsUpdate = true
              }
      map.update()
    })
    await page.waitForTimeout(500)
    await page.screenshot({ path: path.join(output, "solid.png") })
    assert.deepEqual(errors, [], "Browser errors")
    await fs.writeFile(
      path.join(output, "metrics.json"),
      JSON.stringify(results, null, 2) + "\n",
    )
  } finally {
    await browser?.close()
    await new Promise(resolve => server.close(resolve))
  }
}
main().catch(reportFailure)
