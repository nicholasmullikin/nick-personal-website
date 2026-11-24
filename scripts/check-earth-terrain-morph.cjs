// Hold native DEMs until coarse terrain is visible. Freeze a real promotion and
// compare its vertex shader, surface queries, and pointer picking to baked geometry.
const assert = require("node:assert/strict")
const { chromium, firefox } = require("playwright")
const {
  mapboxToken,
  previewURL,
  installProbe,
  browserErrors,
  reportFailure,
} = require("./lib/earth-browser.cjs")

async function compareSurfaces() {
  const { map, THREE } = window.probe
  const renderer = map.renderer
  const source = map.getDataSourceByName("terrain")
  const deadline = performance.now() + 15000
  let tiles
  for (;;) {
    const cut = map.visibleTileSet.dataSourceTileList.find(
      entry => entry.dataSource === source,
    )
    tiles = Array.from(cut?.renderedTiles.values() || [])
    if (
      tiles.filter(
        tile =>
          tile.objects[0]?.geometry.userData.terrainTransition?.factor > 0.0002,
      ).length >= 2
    )
      break
    if (performance.now() > deadline)
      throw Error("No active elevation promotion captured")
    await new Promise(requestAnimationFrame)
  }

  const gpu = new THREE.Scene(),
    baked = new THREE.Scene(),
    world = new THREE.Scene()
  const width = 480,
    height = 320
  const target = new THREE.WebGLRenderTarget(width, height)
  const savedTarget = renderer.getRenderTarget()
  const copies = [],
    scales = new Map(),
    heightErrors = [],
    rayErrors = []
  const point = new THREE.Vector3()
  function meshFor(tile, geometry, relative) {
    const mesh = new THREE.Mesh(geometry, tile.objects[0].material)
    mesh.frustumCulled = false
    mesh.position.copy(tile.center)
    if (relative) mesh.position.sub(map.camera.position)
    mesh.setRotationFromMatrix(tile.boundingBox.getRotationMatrix())
    return mesh
  }
  function pixels(scene) {
    renderer.setRenderTarget(target)
    renderer.clear()
    renderer.render(scene, map.m_rteCamera)
    const bytes = new Uint8Array(width * height * 4)
    renderer.readRenderTargetPixels(target, 0, 0, width, height, bytes)
    return bytes
  }
  function percentile(values, q) {
    values.sort((a, b) => a - b)
    return values[Math.floor(q * values.length)]
  }
  try {
    for (const tile of tiles) {
      const mesh = tile.objects[0]
      if (!mesh?.isMesh) continue
      const original = mesh.geometry
      let geometry = original
      const morph = geometry.userData.terrainTransition
      if (morph) {
        geometry = original.clone()
        copies.push(geometry)
        scales.set(mesh.material, {
          height: mesh.material.uniforms.terrainSourceScale.value,
          light: mesh.material.uniforms.terrainNormalMix.value,
        })
        const { position, uv, normal, terrainSourceNormal } =
          geometry.attributes
        if (terrainSourceNormal) {
          const mixed = new Float32Array(3 * normal.count)
          const weight = mesh.material.uniforms.terrainNormalMix.value
          for (let i = 0; i < normal.count; i++) {
            mixed[3 * i] = normal.getX(i) + weight * terrainSourceNormal.getX(i)
            mixed[3 * i + 1] =
              normal.getY(i) + weight * terrainSourceNormal.getY(i)
            mixed[3 * i + 2] =
              normal.getZ(i) + weight * terrainSourceNormal.getZ(i)
          }
          geometry.setAttribute("normal", new THREE.BufferAttribute(mixed, 3))
        }
        for (let i = 0; i < position.count; i++) {
          position.setZ(i, position.getZ(i) + morph.delta[i] * morph.factor)
        }
        geometry.computeBoundingSphere()
        geometry.computeBoundingBox()

        const transform = tile.boundingBox
          .getRotationMatrix()
          .setPosition(tile.center)
        const cells =
          original.userData.attributeMetadata.position.terrainGridWidth - 1
        const size = 2 ** tile.tileKey.level
        const step = Math.max(1, Math.floor(position.count / 37))
        for (let i = 7; i < position.count; i += step) {
          const u = Math.round(cells * uv.getX(i)) / cells
          const v = Math.round(cells * (1 - uv.getY(i))) / cells
          if (u <= 0 || v <= 0 || u >= 1 || v >= 1 || !morph.delta[i]) continue
          const x = (tile.tileKey.column + u) / size,
            y = (tile.tileKey.row + v) / size
          const sampled = map.earth.elevationProvider.getHeight({
            longitude: x * 360 - 180,
            latitude:
              (Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) * 180) / Math.PI,
          })
          const exact =
            point
              .fromBufferAttribute(position, i)
              .applyMatrix4(transform)
              .length() - 6378137
          heightErrors.push(Math.abs(sampled - exact))
        }
      }
      gpu.add(meshFor(tile, original, true))
      baked.add(meshFor(tile, geometry, true))
      world.add(meshFor(tile, geometry, false))
    }

    const actual = pixels(gpu)
    for (const material of scales.keys())
      material.uniforms.terrainNormalMix.value = 0
    const nativeLighting = pixels(gpu)
    for (const material of scales.keys())
      material.uniforms.terrainSourceScale.value = 0
    const expected = pixels(baked),
      unmorphed = pixels(gpu)
    let error = 0,
      visiblyMoved = 0,
      visiblyRelit = 0
    for (let i = 0; i < actual.length; i += 4) {
      let difference = 0,
        movement = 0,
        lighting = 0
      for (let channel = i; channel < i + 3; channel++) {
        difference = Math.max(
          difference,
          Math.abs(actual[channel] - expected[channel]),
        )
        movement += Math.abs(actual[channel] - unmorphed[channel])
        lighting += Math.abs(actual[channel] - nativeLighting[channel])
      }
      error += difference
      if (movement > 3) visiblyMoved++
      if (lighting > 3) visiblyRelit++
    }

    world.updateMatrixWorld(true)
    const caster = new THREE.Raycaster()
    for (let row = 2; row < 7; row++) {
      for (let col = 1; col < 8; col++) {
        const x = (col + 0.25) / 9,
          y = (row + 0.3) / 8
        caster.setFromCamera(
          new THREE.Vector2(2 * x - 1, 1 - 2 * y),
          map.camera,
        )
        const [hit] = caster.intersectObjects(world.children, false)
        const found = map.earth.elevationProvider.rayCast(
          x * map.canvas.clientWidth,
          y * map.canvas.clientHeight,
        )
        if (hit && found) rayErrors.push(hit.point.distanceTo(found))
      }
    }
    return {
      webgl2: renderer.capabilities.isWebGL2,
      visiblyMoved,
      visiblyRelit,
      meanPixelError: error / (width * height),
      landmarks: heightErrors.length,
      heightP99: percentile(heightErrors, 0.99),
      rays: rayErrors.length,
      rayP95: percentile(rayErrors, 0.95),
      glError: renderer.getContext().getError(),
    }
  } finally {
    for (const [material, value] of scales) {
      material.uniforms.terrainSourceScale.value = value.height
      material.uniforms.terrainNormalMix.value = value.light
    }
    renderer.setRenderTarget(savedTarget)
    target.dispose()
    for (const geometry of copies) geometry.dispose()
  }
}

async function main() {
  const useFirefox = process.env.EARTH_BROWSER === "firefox"
  const browser = useFirefox
    ? await firefox.launch({
        firefoxUserPrefs: { "webgl.enable-webgl2": false },
      })
    : await chromium.launch({
        args: [
          "--enable-gpu",
          "--use-angle=vulkan",
          "--enable-features=Vulkan",
          "--use-vulkan=native",
        ],
      })
  try {
    const page = await browser.newPage({
      viewport: { width: 850, height: 600 },
    })
    const errors = browserErrors(page)
    await installProbe(page)
    let hold = true
    const waiting = []
    await page.route("**/mapbox.terrain-rgb/**", route => {
      const nativeLevel = new URL(route.request().url()).pathname.match(
        /terrain-rgb\/(\d+)/,
      )?.[1]
      if (hold && Number(nativeLevel) >= 13) waiting.push(route)
      else return route.continue()
    })
    const url = new URL("/harp/rendering_globe-atmosphere.html", previewURL)
    url.searchParams.set("mapbox_token", await mapboxToken())
    url.searchParams.set("view", "36.0617,-112.1075,2162,270,77,2")
    await page.goto(url.href)
    await page.waitForFunction(() => window.probe?.map?.earth)
    await page.evaluate(() => {
      const { earth } = window.probe.map
      earth.environment.setClouds(false)
      earth.setSunHour(13.5)
      earth.buildings.setEnabled(false)
    })
    // Wait for native requests *and* visible coarse tiles for the same footprint.
    await page.waitForFunction(() => {
      const cut = window.probe.map.visibleTileSet.dataSourceTileList.find(
        entry => entry.dataSource.name === "terrain",
      )
      return Array.from(cut?.renderedTiles.values() || []).some(
        tile => tile.tileKey.level >= 12,
      )
    })
    for (let i = 0; !waiting.length && i < 100; i++)
      await page.waitForTimeout(50)
    assert.ok(waiting.length, "expected withheld native terrain requests")
    const result = page.evaluate(compareSurfaces)
    hold = false
    await Promise.allSettled(waiting.map(route => route.continue()))
    const measurement = await result
    console.log(JSON.stringify(measurement, null, 2))
    assert.deepEqual(errors, [])
    assert.equal(measurement.glError, 0)
    assert.ok(
      measurement.visiblyRelit > 20,
      "the terrain lighting must morph with its shape",
    )
    assert.ok(
      measurement.visiblyMoved > 20,
      "the rendered scene must contain an active morph",
    )
    assert.ok(
      measurement.meanPixelError < 0.05,
      "shader displacement differs from the baked mesh",
    )
    assert.ok(
      measurement.landmarks >= 5 && measurement.heightP99 < 0.05,
      "height error exceeds 5 cm",
    )
    assert.ok(
      measurement.rays >= 8 && measurement.rayP95 < 0.1,
      "picking error exceeds 10 cm",
    )
    if (useFirefox) assert.equal(measurement.webgl2, false)
  } finally {
    await browser.close()
  }
}
main().catch(reportFailure)
