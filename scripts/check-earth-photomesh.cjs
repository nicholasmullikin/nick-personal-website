// Read the same stencil bit that suppresses native terrain and footprints.
// A loaded tile can be entirely transparent; only drawn survey pixels count.
const assert = require("node:assert/strict")
const { chromium, firefox } = require("playwright")
const {
  previewURL,
  mapboxToken,
  installProbe,
  browserErrors,
  reportFailure,
} = require("./lib/earth-browser.cjs")
function measureCoverage(disable = false) {
  const { map, THREE } = window.probe,
    r = map.renderer,
    gl = r.getContext()
  if (disable) map.earth.survey.setEnabled(false)
  map.renderSync()
  const scene = new THREE.Scene(),
    camera = new THREE.Camera(),
    geometry = new THREE.PlaneGeometry(2, 2)
  const material = new THREE.ShaderMaterial({
    vertexShader: "void main(){gl_Position=vec4(position.xy,0.,1.);}",
    fragmentShader: "void main(){gl_FragColor=vec4(1.);}",
    depthTest: false,
    depthWrite: false,
    stencilWrite: true,
    stencilWriteMask: 0,
    stencilRef: 64,
    stencilFuncMask: 64,
    stencilFunc: THREE.EqualStencilFunc,
  })
  const quad = new THREE.Mesh(geometry, material)
  quad.frustumCulled = false
  scene.add(quad)
  const auto = r.autoClear,
    color = r.getClearColor(new THREE.Color()),
    alpha = r.getClearAlpha()
  try {
    r.autoClear = false
    r.setClearColor(0, 1)
    r.clear(true, false, false)
    r.render(scene, camera)
    const w = Math.floor(gl.drawingBufferWidth * 0.45),
      h = Math.floor(gl.drawingBufferHeight * 0.32)
    const pixels = new Uint8Array(w * h * 4)
    gl.readPixels(
      Math.floor((gl.drawingBufferWidth - w) / 2),
      Math.floor(gl.drawingBufferHeight * 0.2),
      w,
      h,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      pixels,
    )
    let hits = 0
    for (let i = 0; i < pixels.length; i += 4) if (pixels[i] > 127) hits++
    return {
      coverage: hits / (w * h),
      gl: gl.getError(),
      ...map.earth.survey.stats,
    }
  } finally {
    r.setClearColor(color, alpha)
    r.autoClear = auto
    r.state.buffers.stencil.setMask(255)
    geometry.dispose()
    material.dispose()
    map.update()
  }
}
async function check(engine) {
  const browser =
    engine === "firefox"
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
    for (const [name, pose] of [
      ["Helsinki", [60.1702, 24.952, 9, 1050, 68, 8]],
      ["Luxembourg", [49.611, 6.132, 298, 660, 70, 42]],
    ]) {
      const page = await browser.newPage({
        viewport: { width: 960, height: 660 },
      })
      const errors = browserErrors(page)
      await installProbe(page)
      await page.goto(
        previewURL +
          "/harp/rendering_globe-atmosphere.html?survey=1&view=" +
          pose.join(",") +
          "&mapbox_token=" +
          (await mapboxToken()),
      )
      await page.waitForFunction(
        () => window.probe?.map.earth.survey.stats.visible > 0,
        null,
        { timeout: 90000 },
      )
      await page.evaluate(() =>
        window.probe.map.earth.environment.setClouds(false),
      )
      let start = 0
      for (let i = 0; i < 35 && start < 0.8; i++) {
        await page.waitForTimeout(1000)
        start = (await page.evaluate(measureCoverage)).coverage
      }
      assert.ok(
        start >= 0.8,
        name + " never established initial survey coverage",
      )
      await page.evaluate(p => {
        const m = window.probe.map
        m.lookAt({
          target: { latitude: p[0], longitude: p[1], altitude: p[2] },
          distance: 150,
          tilt: p[4],
          heading: p[5],
        })
        m.update()
      }, pose)
      const measurements = []
      for (let i = 0; i < 12; i++) {
        await page.waitForTimeout(2000)
        const row = await page.evaluate(measureCoverage)
        assert.equal(row.gl, 0)
        measurements.push(row.coverage)
      }
      const off = await page.evaluate(measureCoverage, true)
      console.log(
        engine,
        name,
        JSON.stringify({
          start,
          afterApproach: measurements,
          disabled: off.coverage,
        }),
      )
      assert.ok(
        Math.min(...measurements) > 0.65,
        name + " lost resident survey coverage on approach",
      )
      assert.equal(
        off.coverage,
        0,
        "unloading the source must clear its stencil",
      )
      assert.deepEqual(errors, [])
      await page.close()
    }
  } finally {
    await browser.close()
  }
}
;(async () => {
  for (const engine of process.argv.length > 2
    ? process.argv.slice(2)
    : ["chromium", "firefox"])
    await check(engine)
})().catch(reportFailure)
