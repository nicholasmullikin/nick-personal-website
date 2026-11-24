// Reverse the camera over the same target and observe the shader displacement
// on persistent meshes. A pop straight to the parent yields no intermediate frames.
const assert = require("node:assert/strict")
const { chromium } = require("playwright")
const {
  installProbe,
  mapboxToken,
  browserErrors,
  reportFailure,
  previewURL,
} = require("./lib/earth-browser.cjs")

async function sweep(pose) {
  const map = window.probe.map
  map.earth.environment.setClouds(false)
  const tiltTo = tilt => {
    map.lookAt({ ...pose, tilt })
    map.update()
  }
  tiltTo(45)
  await new Promise(resolve => setTimeout(resolve, 3500))
  const seen = new WeakMap(),
    coarsened = new Set(),
    reversed = new Set()
  let peak = 0,
    largestStep = 0,
    lastFrame = -1
  let steps = 0
  const scales = new Set()
  for (const end of [82, 44, 80, 44]) {
    const start = map.tilt
    for (let i = 1; i <= 50; i++) {
      tiltTo(start + ((end - start) * i) / 50)
      await new Promise(requestAnimationFrame)
      if (map.frameNumber === lastFrame) continue
      lastFrame = map.frameNumber
      scales.add(map.dynamicPixelRatio ?? map.pixelRatio)
      const cut = map.visibleTileSet.dataSourceTileList.find(
        e => e.dataSource.name === "terrain",
      )
      let retiring = 0
      for (const tile of cut.renderedTiles.values()) {
        const mesh = tile.objects[0]
        if (!mesh) continue
        const morph = mesh.geometry.userData.terrainTransition
        const before = seen.get(mesh)
        if (morph?.retiring) {
          retiring++
          if (before?.morph === morph && morph.factor > before.factor) {
            coarsened.add(mesh)
            const fraction = mesh.material.uniforms.terrainNormalMix.value / 2
            if (morph.normalDelta && before.retiring) {
              steps++
              largestStep = Math.max(largestStep, fraction - before.fraction)
            }
          }
        } else if (
          morph &&
          before?.morph === morph &&
          coarsened.has(mesh) &&
          morph.factor < before.factor
        ) {
          reversed.add(mesh)
        }
        seen.set(mesh, {
          morph,
          factor: morph?.factor,
          retiring: morph?.retiring,
          fraction: (mesh.material?.uniforms?.terrainNormalMix?.value || 0) / 2,
        })
      }
      peak = Math.max(peak, retiring)
    }
  }
  return {
    coarsened: coarsened.size,
    reversed: reversed.size,
    peak,
    largestStep,
    steps,
    scales: [...scales],
    drawingBuffer: [map.canvas.width, map.canvas.height],
  }
}
async function verifyDisplay(browser, display) {
  const [width, height, dpr] = display.split("x").map(Number)
  const page = await browser.newPage({
    viewport: { width, height },
    deviceScaleFactor: dpr,
  })
  await installProbe(page)
  const errors = browserErrors(page)
  const url = new URL("/harp/rendering_globe-atmosphere.html", previewURL)
  url.searchParams.set("mapbox_token", await mapboxToken())
  url.searchParams.set("layer", "relief")
  await page.goto(url.href)
  await page.waitForFunction(() => window.probe?.map.earth)
  const results = []
  for (const [place, latitude, longitude, altitude, distance, heading] of [
    ["Garibaldi", 49.95, -123.04, 1650, 3500, 330],
    ["Campus Point", 34.406, -119.846, 8, 3500, 320],
  ]) {
    const result = await page.evaluate(sweep, {
      target: { latitude, longitude, altitude },
      distance,
      heading,
    })
    results.push(result)
    console.log(display, place, result)
    if (process.env.EARTH_TEST_SCREENSHOTS) {
      await page.screenshot({
        path: process.env.EARTH_TEST_SCREENSHOTS + "-" + place + ".jpg",
      })
    }
    // Smoothstep has a maximum slope of 1.5. Check the largest observed
    // mesh displacement increment in native pixels on both DPR paths.
    const minFrames = Math.min(
      45,
      Math.max(6, Math.ceil(result.drawingBuffer[1] / 100)),
    )
    assert.ok(result.largestStep <= 1.5 / minFrames + 0.0001)
    assert.ok(
      result.peak <=
        4 * Math.max(2, Math.min(5, Math.ceil(result.drawingBuffer[1] / 640))),
    )
  }
  assert.ok(
    results.some(r => r.coarsened > 0),
    "No visible mesh eased toward its parent",
  )
  assert.ok(
    results.some(r => r.reversed > 0),
    "No outgoing mesh reversed its displacement",
  )
  assert.deepEqual(errors, [])
  await page.close()
}
async function main() {
  const browser = await chromium.launch({
    args: [
      "--enable-gpu",
      "--use-angle=vulkan",
      "--enable-features=Vulkan",
      "--use-vulkan=native",
    ],
  })
  try {
    const displays = process.env.EARTH_TEST_DISPLAY
      ? [process.env.EARTH_TEST_DISPLAY]
      : ["960x640x1", "3840x2160x1", "1920x1080x2"]
    for (const display of displays) await verifyDisplay(browser, display)
  } finally {
    await browser.close()
  }
}
main().catch(reportFailure)
