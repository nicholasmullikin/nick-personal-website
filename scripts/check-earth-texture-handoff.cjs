// Hold fine elevation until detailed satellite pages cover the coarse mesh.
// The first refined draw must still sample those pages at the same positions.
const assert = require("node:assert/strict")
const { chromium } = require("playwright")
const {
  browserErrors,
  installProbe,
  mapboxToken,
  previewURL,
  reportFailure,
} = require("./lib/earth-browser.cjs")

async function main() {
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage({
      viewport: { width: 960, height: 650 },
    })
    const errors = browserErrors(page)
    let hold = true
    const held = []
    await installProbe(page)
    await page.route("**/mapbox.terrain-rgb/**", route => {
      const level = Number(
        new URL(route.request().url()).pathname.match(
          /terrain-rgb\/(\d+)\//,
        )?.[1],
      )
      if (hold && level >= 13) held.push(route)
      else return route.continue()
    })
    const url = new URL("/harp/rendering_globe-atmosphere.html", previewURL)
    url.searchParams.set("view", "32.8917,-117.2536,3,280,77,72")
    url.searchParams.set("mapbox_token", await mapboxToken())
    await page.goto(url.href, { waitUntil: "domcontentloaded" })
    await page.waitForFunction(() => window.probe?.map.earth?.environment)
    await page.evaluate(() => {
      const earth = window.probe.map.earth
      earth.environment.setClouds(false)
      earth.buildings.setEnabled(false)
    })
    await page.waitForFunction(
      () => {
        const stats = window.probe?.map.earth?.stats
        return stats?.detailHighestZoom >= 17 && !stats.fading && !stats.pending
      },
      null,
      { timeout: 90000 },
    )
    assert.ok(held.length > 0, "fine elevation requests were intercepted")
    await page.evaluate(() => {
      const map = window.probe.map
      const samples = []
      for (const x of [0.2, 0.48, 0.8]) {
        for (const y of [0.35, 0.53, 0.74]) {
          const hit = map.earth.elevationProvider.rayCast(
            x * map.canvas.clientWidth,
            y * map.canvas.clientHeight,
          )
          if (!hit) continue
          const point = map.projection.unprojectPoint(hit)
          samples.push({
            x: (point.longitude + 180) / 360,
            y:
              (1 -
                Math.asinh(Math.tan((point.latitude * Math.PI) / 180)) /
                  Math.PI) /
              2,
          })
        }
      }
      // Read the actual GPU uniforms. The planner's ideal pages can already
      // look correct while a newly created material is still blank or fading.
      function read(sample) {
        const ground = map.visibleTileSet.dataSourceTileList.find(
          s => s.dataSource.name === "terrain",
        )
        let best
        for (const tile of ground.renderedTiles.values()) {
          const { level, column, row } = tile.tileKey
          const n = 2 ** level,
            u = sample.x * n - column,
            v = 1 - (sample.y * n - row)
          if (
            u < 0 ||
            u >= 1 ||
            v < 0 ||
            v >= 1 ||
            (best && best.geometry >= level)
          )
            continue
          const mat = tile.objects.find(
            o => o.visible && o.material?.userData.earthTerrain,
          )?.material
          if (!mat) continue
          const uniforms = mat.uniforms
          const from = uniforms.fromBase.value
            ? 0
            : level + Math.log2(uniforms.fromUv.value.x)
          const to = uniforms.toBase.value
            ? 0
            : level + Math.log2(uniforms.toUv.value.x)
          let photo = from + (to - from) * uniforms.blend.value
          for (let i = 0; i < mat.defines.EARTH_DETAIL_SLOTS; i++) {
            const fade = uniforms["detailFade" + i].value
            const uv = uniforms["detailUv" + i].value
            const xx = u * uv.x + uv.z,
              yy = v * uv.y + uv.w
            if (fade && xx >= 0 && xx <= 1 && yy >= 0 && yy <= 1)
              photo += (level + Math.log2(uv.x) - photo) * fade
          }
          best = { geometry: level, photo }
        }
        return best
      }
      const rows = samples
        .map(point => ({ point, before: read(point) }))
        .filter(row => row.before?.photo >= 16)
      window.handoffSamples = rows
      const source = map.getDataSourceByName("terrain")
      const originalZoom = source.getDataZoomLevel
      const originalSubdivision = source.shouldSubdivide
      const snapshots = new Map()
      let borrowed = 0
      let disposedWhileDrawn = 0
      let reversing = false
      let direction = 1
      window.handoffLifetime = () => ({
        borrowed,
        disposedWhileDrawn,
        reversing,
        disposals: [...snapshots.values()].map(snapshot => snapshot.disposals),
      })
      window.coarsenTerrain = () => {
        for (const row of rows) {
          row.before = read(row.point)
          delete row.after
        }
        direction = -1
        // Advance fade time by rendered frames during the forced cuts. A slow
        // software frame can otherwise consume the whole 380 ms crossfade
        // before the fixture has a chance to exercise a reversal.
        let frameTime = performance.now()
        const clock = Object.getOwnPropertyDescriptor(performance, "now")
        Object.defineProperty(performance, "now", { configurable: true, value: () => frameTime })
        const advance = () => {
          frameTime += 4
          if (borrowed > 0) {
            map.removeEventListener("didrender", advance)
            if (clock) Object.defineProperty(performance, "now", clock)
            else delete performance.now
          }
        }
        map.addEventListener("didrender", advance)
        source.getDataZoomLevel = () => 12
        source.shouldSubdivide = (_zoom, key) => key.level < 12
        source.stationaryTileSelectionRevision++
        source.requestUpdate()
        map.update()
      }
      map.addEventListener("didrender", () => {
        for (const row of rows) {
          if (row.after) continue
          const now = read(row.point)
          if (now && direction * (now.geometry - row.before.geometry) > 0)
            row.after = now
        }
        if (direction === -1) {
          const ground = map.visibleTileSet.dataSourceTileList.find(
            list => list.dataSource === source,
          )
          let sawCoarseSnapshot = false
          for (const tile of ground.renderedTiles.values()) {
            for (const mesh of tile.objects) {
              const uniforms = mesh.material?.uniforms
              const texture = uniforms?.fromMap?.value
              if (
                !mesh.visible ||
                !texture?.isCanvasTexture ||
                uniforms.blend.value >= 0.99
              )
                continue
              const level = tile.tileKey.level
              let record = snapshots.get(texture)
              if (!record) {
                record = { level, disposals: 0 }
                snapshots.set(texture, record)
                texture.addEventListener("dispose", () => record.disposals++)
              }
              if (record.disposals) disposedWhileDrawn++
              if (level > record.level) borrowed++
              if (level === 12) sawCoarseSnapshot = true
            }
          }
          if (sawCoarseSnapshot && !reversing && rows.every(row => row.after)) {
            reversing = true
            // Step through the immediate children to exercise a borrowed
            // composite. A direct jump to a leaf can use its own sharp page.
            source.getDataZoomLevel = () => 13
            source.shouldSubdivide = (_zoom, key) => key.level < 13
            source.stationaryTileSelectionRevision++
            source.requestUpdate()
            map.update()
          } else if (borrowed > 0 && source.getDataZoomLevel !== originalZoom) {
            source.getDataZoomLevel = originalZoom
            source.shouldSubdivide = originalSubdivision
            source.stationaryTileSelectionRevision++
            source.requestUpdate()
            map.update()
          }
        }
      })
    })
    try {
      assert.ok(
        await page.evaluate(() => window.handoffSamples.length >= 3),
        "coarse terrain had sharp imagery",
      )
      hold = false
      await Promise.all(held.map(route => route.continue()))
      for (const direction of ["refinement", "coarsening"]) {
        if (direction === "coarsening") {
          await page.waitForFunction(
            () => {
              const map = window.probe.map,
                stats = map.earth.stats
              return (
                !stats.pending &&
                !stats.fading &&
                map.visibleTileSet.dataSourceTileList.find(
                  s => s.dataSource.name === "terrain",
                )?.allVisibleTileLoaded
              )
            },
            null,
            { timeout: 90000 },
          )
          await page.evaluate(() => window.coarsenTerrain())
        }
        await page.waitForFunction(
          () => window.handoffSamples.every(row => row.after),
          null,
          { timeout: 30000 },
        )
        const rows = await page.evaluate(() => window.handoffSamples)
        const drops = rows.map(row => row.before.photo - row.after.photo)
        assert.ok(
          Math.max(...drops) < 1.05,
          `${direction} lost ground texture levels on its first draw: ${JSON.stringify(drops)}`,
        )
        console.log(
          `${direction}: ${rows.length} ground samples retained imagery, worst loss ${Math.max(0, ...drops).toFixed(2)} levels`,
        )
      }
      // Zoom back before the coarse composite has finished fading. Finer
      // materials must be able to hold each same texture past its original owner.
      await page
        .waitForFunction(
          () => {
            const lifetime = window.handoffLifetime()
            return (
              lifetime.borrowed > 0 &&
              lifetime.disposals.every(count => count > 0)
            )
          },
          null,
          { timeout: 30000 },
        )
        .catch(async error => {
          throw Error(
            error.message +
              " " +
              JSON.stringify(
                await page.evaluate(() => window.handoffLifetime()),
              ),
          )
        })
      const lifetime = await page.evaluate(() => window.handoffLifetime())
      assert.equal(lifetime.disposedWhileDrawn, 0)
      assert.ok(lifetime.disposals.every(count => count === 1))
      console.log(
        `reverse handoff reused fading composites; all ${lifetime.disposals.length} textures released once`,
      )
      assert.deepEqual(errors, [])
    } finally {
      hold = false
    }
  } finally {
    await browser.close()
  }
}
main().catch(reportFailure)
