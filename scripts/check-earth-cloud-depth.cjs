// Check local depth-filter passes and the inexpensive orbital/fallback paths.
const assert = require("node:assert/strict")
const { chromium } = require("playwright")
const {
  previewURL,
  mapboxToken,
  installProbe,
  browserErrors,
  reportFailure,
} = require("./lib/earth-browser.cjs")

// One opaque cloud corner and three clear corners expose optical-depth
// interpolation at a cloud rim. Render both actual composite paths over black.
function compareCoverage() {
  const { map, THREE } = window.probe
  const renderer = map.renderer
  const clouds = map.scene.children.filter(
    o => o.material?.uniforms?.sampleOffset,
  )
  const color = new THREE.DataTexture(
    new Uint8Array([255, 255, 255, 255, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
    2,
    2,
  )
  color.minFilter = color.magFilter = THREE.LinearFilter
  color.needsUpdate = true
  // All four depths represent the same cloud altitude on the near side.
  const depth = new THREE.DataTexture(new Uint8Array([16, 0, 0, 255]), 1, 1)
  depth.needsUpdate = true
  const size = 32
  const target = new THREE.WebGLRenderTarget(size, size)
  const previous = renderer.getRenderTarget()
  const clear = renderer.getClearColor(new THREE.Color()),
    alpha = renderer.getClearAlpha()
  const images = []
  try {
    renderer.setClearColor(0, 0)
    for (const filtered of [false, true]) {
      const scene = new THREE.Scene()
      for (const cloud of clouds) {
        if (!!cloud.material.defines.EARTH_DEPTH_FILTER !== filtered) continue
        const material = cloud.material.clone()
        material.uniforms.colorMap.value = color
        material.uniforms.depthMap.value = depth
        material.uniforms.texel.value.set(0.5, 0.5)
        material.visible = true
        const quad = new THREE.Mesh(cloud.geometry, material)
        quad.frustumCulled = false
        quad.renderOrder = cloud.renderOrder
        scene.add(quad)
      }
      renderer.setRenderTarget(target)
      renderer.clear()
      renderer.render(scene, map.camera)
      const pixels = new Uint8Array(size * size * 4)
      renderer.readRenderTargetPixels(target, 0, 0, size, size, pixels)
      images.push(pixels)
      scene.children.forEach(o => o.material.dispose())
    }
  } finally {
    renderer.setRenderTarget(previous)
    renderer.setClearColor(clear, alpha)
    color.dispose()
    depth.dispose()
    target.dispose()
  }
  let samples = 0,
    maxError = 0
  for (let i = 3; i < images[0].length; i += 4) {
    if (images[0][i] < 5 || images[0][i] > 250) continue
    samples++
    maxError = Math.max(maxError, Math.abs(images[0][i] - images[1][i]))
  }
  return { samples, maxError }
}

async function main() {
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage({
      viewport: { width: 960, height: 720 },
    })
    const errors = browserErrors(page)
    await installProbe(page)
    const url = new URL("/harp/rendering_globe-atmosphere.html", previewURL)
    url.searchParams.set("mapbox_token", await mapboxToken())
    await page.goto(url.href)
    await page.waitForFunction(
      () =>
        window.probe?.map.earth.environment.status.noiseReady &&
        window.probe.map.earth.environment.status.cloudReady &&
        window.probe.map.earth.environment.cloudStats.historyFrames > 0,
    )
    const pose = async (distance, tilt) => {
      const previous = await page.evaluate(
        ({ distance, tilt }) => {
          const map = window.probe.map
          const frame = map.frameNumber
          map.lookAt({
            target: { latitude: 49.95, longitude: -123.04, altitude: 1650 },
            distance,
            tilt,
            heading: 330,
          })
          map.update()
          return frame
        },
        { distance, tilt },
      )
      await page.waitForFunction(
        frame => window.probe.map.frameNumber > frame,
        previous,
      )
      return page.evaluate(() =>
        window.probe.map.scene.children
          .filter(
            o =>
              o.material?.uniforms?.sampleOffset &&
              o.renderOrder >= 11000 &&
              o.renderOrder <= 11004 &&
              o.visible &&
              o.material.visible,
          )
          .map(o => o.renderOrder)
          .sort(),
      )
    }
    assert.deepEqual(await pose(1800, 72), [11001, 11002, 11003, 11004])
    assert.deepEqual(await pose(4800000, 30), [11000])
    await pose(85000, 0)
    const coverage = await page.evaluate(compareCoverage)
    assert.ok(coverage.samples > 100, "synthetic rim covered the cloud pass")
    assert.ok(
      coverage.maxError <= 3,
      `cloud rim alpha differed by ${coverage.maxError}/255`,
    )
    assert.deepEqual(await pose(1800, 72), [11001, 11002, 11003, 11004])
    await page.evaluate(() => {
      window.probe.map.earth.environment.clouds.material.visible = false
      window.probe.map.update()
    })
    await page.waitForTimeout(250)
    assert.deepEqual(
      await page.evaluate(() =>
        window.probe.map.scene.children
          .filter(
            o =>
              o.material?.uniforms?.sampleOffset &&
              o.renderOrder >= 11000 &&
              o.renderOrder <= 11004 &&
              o.visible &&
              o.material.visible,
          )
          .map(o => o.renderOrder),
      ),
      [],
    )
    assert.deepEqual(errors, [])
    console.log(
      "Local cloud depth filtering, orbital selection and visibility passed",
    )
  } finally {
    await browser.close()
  }
}
main().catch(reportFailure)
