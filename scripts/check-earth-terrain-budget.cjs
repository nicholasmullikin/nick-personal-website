// Regress the desktop, low-angle views where the old selector discarded distant tiles.
const assert = require("node:assert/strict")
const { chromium } = require("playwright")
const {
  previewURL,
  mapboxToken,
  installProbe,
  browserErrors,
  reportFailure,
} = require("./lib/earth-browser.cjs")
function inspectCoverage() {
  const { map, THREE } = window.probe,
    { entries, selected, limit } = window.terrainTrace
  const tiles = map.visibleTileSet.dataSourceTileList.find(
    e => e.dataSource.name === "terrain",
  ).renderedTiles
  const drawn = new Set(
    [...tiles.values()]
      .filter(t => t.objects.some(o => o.isMesh && o.visible))
      .map(t => t.tileKey.mortonCode()),
  )
  const warm = selected.filter(e =>
    window.warmKeys?.has(e.tileKey.mortonCode()),
  )
  const demoted = warm.filter(e => {
    const t = [...tiles.values()].find(
      t => t.tileKey.mortonCode() === e.tileKey.mortonCode(),
    )
    return !t || t.objects[0]?.userData.terrainCropLevel !== undefined
  })
  const uncovered = entries.filter(e => {
    for (let k = e.tileKey; ; k = k.parent()) {
      if (drawn.has(k.mortonCode())) return false
      if (k.level === 0) return true
    }
  })
  // Check the actual drawable triangles, including the outer screen.
  // Rays that reach 500 m below sea level must have crossed terrain.
  const ray = new THREE.Raycaster(),
    point = new THREE.Vector3()
  const sphere = new THREE.Sphere(new THREE.Vector3(), 6378137 - 500)
  const surfaces = []
  let overlaps = 0
  for (const t of tiles.values()) {
    const mesh = t.objects.find(o => o.isMesh && o.visible)
    if (!mesh) continue
    for (let parent = t.tileKey; parent.level > 0; ) {
      parent = parent.parent()
      if (drawn.has(parent.mortonCode())) overlaps++
    }
    const surface = new THREE.Mesh(mesh.geometry, mesh.material)
    surface.matrixWorld
      .copy(t.boundingBox.getRotationMatrix())
      .setPosition(t.center)
    surfaces.push(surface)
  }
  const hits = []
  let ground = 0,
    misses = 0
  for (let y = 0; y < 12; y++)
    for (let x = 0; x < 22; x++) {
      ray.setFromCamera(
        new THREE.Vector2((x + 0.5) / 11 - 1, 1 - (y + 0.5) / 6),
        map.camera,
      )
      if (
        !ray.ray.intersectSphere(sphere, point) ||
        point.distanceTo(map.camera.position) >= map.camera.far
      )
        continue
      ground++
      hits.length = 0
      for (const surface of surfaces) {
        surface.raycast(ray, hits)
        if (hits.length) break
      }
      if (!hits.length) misses++
    }
  return {
    ground,
    warm: warm.length,
    demoted: demoted.length,
    crops: [...tiles.values()].filter(
      t => t.objects[0]?.userData.terrainCropLevel !== undefined,
    ).length,
    misses,
    overlaps,
    wanted: entries.length,
    selected: selected.length,
    drawn: drawn.size,
    limit,
    uncovered: uncovered.length,
  }
}
async function main() {
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage({
      viewport: { width: 1600, height: 900 },
    })
    const errors = browserErrors(page)
    await installProbe(page)
    await page.goto(
      previewURL +
        "/harp/rendering_globe-atmosphere.html?mapbox_token=" +
        (await mapboxToken()),
    )
    await page.waitForFunction(() =>
      window.probe?.map.getDataSourceByName("terrain"),
    )
    await page.evaluate(() => {
      const map = window.probe.map
      map.earth.environment.setClouds(false)
      const terrain = map.getDataSourceByName("terrain")
      const select = terrain.selectBudgetedTiles
      const plan = terrain.planTileRequests
      let raw
      terrain.selectBudgetedTiles = function (entries, limit) {
        const selected = select.call(this, entries, limit)
        raw = { entries, selected, limit }
        return selected
      }
      terrain.planTileRequests = function (selected, ...args) {
        window.terrainTrace =
          raw?.selected === selected
            ? raw
            : {
                entries: selected,
                selected,
                limit: map.visibleTileSet.options.maxVisibleDataSourceTiles,
              }
        raw = undefined
        return plan.call(this, selected, ...args)
      }
    })
    for (const [site, latitude, longitude, altitude, heading] of [
      ["coast", 34.402, -119.841, 8, 320],
      ["inland", 27.9, 86.8, 4800, 0],
    ]) {
      for (const tilt of [80, 82, 84]) {
        await page.evaluate(
          v => {
            window.terrainTrace = null
            window.probe.map.lookAt(v)
          },
          {
            target: { latitude, longitude, altitude },
            distance: 1200,
            tilt,
            heading,
          },
        )
        await page.waitForFunction(
          () =>
            window.terrainTrace &&
            window.probe.map.visibleTileSet.dataSourceTileList.find(
              e => e.dataSource.name === "terrain",
            )?.allVisibleTileLoaded,
          null,
          { timeout: 120000, polling: 200 },
        )
        const result = await page.evaluate(inspectCoverage)
        console.log({ site, tilt, ...result })
        assert.ok(result.wanted > 0)
        assert.ok(result.ground > 0, "expected ground rays below the horizon")
        assert.equal(
          result.overlaps,
          0,
          "a coarse parent must not draw over a loaded child",
        )
        assert.equal(
          result.misses,
          0,
          "every off-axis ground ray must hit a drawn terrain mesh",
        )
        assert.ok(result.selected <= result.limit)
        assert.equal(result.uncovered, 0)
      }
    }
    // Turn a warm, close ridge camera while every new DEM response is held.
    // The original high-detail tiles still in view must stay on screen.
    const ridge = {
      target: { latitude: 49.95, longitude: -123.04, altitude: 1650 },
      distance: 1800,
      tilt: 76,
      heading: 330,
    }
    await page.evaluate(v => {
      window.terrainTrace = null
      window.probe.map.lookAt(v)
    }, ridge)
    await page.waitForFunction(
      () =>
        window.terrainTrace &&
        window.probe.map.visibleTileSet.dataSourceTileList.find(
          e => e.dataSource.name === "terrain",
        )?.allVisibleTileLoaded,
      null,
      { timeout: 120000 },
    )
    await page.evaluate(() => {
      window.warmKeys = new Set(
        window.terrainTrace.selected.map(e => e.tileKey.mortonCode()),
      )
    })
    const waiting = []
    await page.route("**/mapbox.terrain-rgb/**", route => {
      waiting.push(route)
    })
    let crops = 0,
      shared = 0
    for (const heading of [340, 355, 15, 35, 55, 330]) {
      await page.evaluate(
        v => {
          window.terrainTrace = null
          window.probe.map.lookAt(v)
        },
        { ...ridge, heading },
      )
      await page.waitForFunction(() => window.terrainTrace)
      const result = await page.evaluate(inspectCoverage)
      console.log({ site: "frozen ridge turn", heading, ...result })
      assert.equal(result.overlaps, 0)
      assert.equal(result.demoted, 0)
      assert.equal(result.misses, 0)
      crops += result.crops
      shared += result.warm
    }
    assert.ok(crops > 0 && shared > 0 && waiting.length > 0)
    await page.unroute("**/mapbox.terrain-rgb/**")
    await Promise.allSettled(waiting.map(route => route.continue()))
    assert.deepEqual(errors, [])
  } finally {
    await browser.close()
  }
}
main().catch(reportFailure)
