const {
  sampleRegionalCloudGradients,
  sampleCloudDescent,
  measureCloudPan,
} = require("./lib/earth-cloud-regional.cjs")
const { openControls } = require("./lib/earth-browser.cjs")
// Cloud genera, shell crossings, reconstruction, quality bounds, WebGL 1 fallback.
const { chromium, firefox } = require("playwright"),
  fs = require("node:fs/promises"),
  path = require("node:path"),
  assert = require("node:assert/strict"),
  { createRequire } = require("node:module")
const sharp = createRequire(require.resolve("gatsby-plugin-sharp"))("sharp")
const {
  previewURL,
  mapboxToken,
  installProbe,
  browserErrors,
  reportFailure,
} = require("./lib/earth-browser.cjs")
async function cloudPixelDifference(
  a,
  b,
  width = 900,
  height = 500,
  threshold = 15,
) {
  const pixels = buffer =>
    sharp(buffer)
      .extract({ left: 0, top: 0, width, height })
      .removeAlpha()
      .raw()
      .toBuffer()
  const x = await pixels(a),
    y = await pixels(b)
  let changed = 0
  for (let i = 0; i < x.length; i += 3)
    if (
      Math.abs(x[i] - y[i]) +
        Math.abs(x[i + 1] - y[i + 1]) +
        Math.abs(x[i + 2] - y[i + 2]) >
      threshold
    )
      changed++
  return changed
}
async function main() {
  const output = path.resolve(process.argv[2] || "/tmp/earth-clouds"),
    token = await mapboxToken(),
    results = []
  await fs.mkdir(output, { recursive: true })
  const matrix = [
    ["chromium", chromium, {}],
    [
      "firefox-webgl1",
      firefox,
      { firefoxUserPrefs: { "webgl.enable-webgl2": false } },
    ],
    ["no-depth-texture", chromium, {}],
  ]
  for (const [name, type, launch] of matrix.filter(
    ([name]) =>
      !process.env.EARTH_CLOUD_BROWSERS ||
      process.env.EARTH_CLOUD_BROWSERS.split(",").includes(name),
  )) {
    const browser = await type.launch({ headless: true, ...launch })
    try {
      const page = await browser.newPage({
          viewport: { width: 1000, height: 700 },
        }),
        errors = browserErrors(page)
      await installProbe(page)
      if (name === "no-depth-texture")
        await page.addInitScript(() => {
          const getContext = HTMLCanvasElement.prototype.getContext
          HTMLCanvasElement.prototype.getContext = function (name, ...args) {
            return name === "webgl2"
              ? null
              : getContext.call(this, name, ...args)
          }
          const original = WebGLRenderingContext.prototype.getExtension
          WebGLRenderingContext.prototype.getExtension = function (name) {
            return name === "WEBGL_depth_texture"
              ? null
              : original.call(this, name)
          }
        })
      await page.goto(
        `${previewURL}/harp/rendering_globe-atmosphere.html?mapbox_token=${token}`,
      )
      await page.waitForFunction(
        () => window.probe?.map.earth.environment.status.noiseReady,
      )
      await openControls(page, "Explore")
      await page.getByRole("button", { name: "Sky", exact: true }).click()
      await page.waitForTimeout(1500)
      const types =
        name === "no-depth-texture"
          ? [9, 10, 1]
          : [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
      const { noiseGLSL, densityGLSL } = require("./lib/earth-source.cjs").load(
        "cloud-model.js",
      )
      const atlas = await page.evaluate(noiseGLSL => {
        const { map, THREE } = window.probe,
          renderer = map.renderer,
          scene = new THREE.Scene()
        const material = new THREE.ShaderMaterial({
          uniforms: {
            cloudNoise: map.earth.environment.uniforms.cloudNoise,
            cloudTime: { value: 0 },
          },
          depthTest: false,
          depthWrite: false,
          vertexShader:
            "varying vec2 uvv;void main(){uvv=position.xy*.5+.5;gl_Position=vec4(position.xy,0.,1.);}",
          fragmentShader:
            "precision highp float;varying vec2 uvv;uniform float cloudTime;" +
            noiseGLSL +
            "void main(){float i=floor(uvv.x*16.);float boundary=floor(i/2.)/8.;float z=boundary+(mod(i,2.)<.5?-.00001:.00001);gl_FragColor=cloudNoise3(vec3(.138,.297,z));}",
        })
        const geometry = new THREE.PlaneGeometry(2, 2)
        scene.add(new THREE.Mesh(geometry, material))
        const target = new THREE.WebGLRenderTarget(16, 1),
          previous = renderer.getRenderTarget(),
          pixels = new Uint8Array(64)
        renderer.setRenderTarget(target)
        renderer.render(scene, map.camera)
        renderer.readRenderTargetPixels(target, 0, 0, 16, 1, pixels)
        renderer.setRenderTarget(previous)
        target.dispose()
        geometry.dispose()
        material.dispose()
        return [...pixels]
      }, noiseGLSL)
      for (let i = 0; i < 8; i++)
        for (let channel = 0; channel < 4; channel++)
          assert.ok(
            Math.abs(atlas[i * 8 + channel] - atlas[i * 8 + 4 + channel]) < 3,
            "GPU volume samples are continuous across slice rows",
          )
      const { regions, flat } = await page.evaluate(
        sampleRegionalCloudGradients,
        {
          noiseGLSL,
          densityGLSL,
        },
      )
      assert.equal(flat.cloudyFraction, 1)
      assert.equal(
        flat.cloudyGradient,
        0,
        "a flat, fully covered field has no cell detail",
      )
      const meanGradient =
        regions.reduce((sum, r) => sum + r.meanGradient, 0) / regions.length
      assert.ok(
        meanGradient > 1.8,
        `${name}: regional fields retain overall contrast`,
      )
      for (const region of regions) {
        assert.ok(
          region.cloudyFraction > 0.1,
          `${name}: regional sample needs resolved clouds at ${region.lat}, ${region.lon}`,
        )
        assert.ok(
          region.cloudyGradient > 1.8,
          `${name}: regional cloud cells retain detail at ${region.lat}, ${region.lon}`,
        )
        assert.ok(
          region.hardEdges < 0.0005,
          `${name}: regional cloud density has hard rims at ${region.lat}, ${region.lon}`,
        )
      }
      await page.waitForFunction(
        () => window.probe.map.earth.environment.status.cloudReady,
      )
      const descent = await page.evaluate(sampleCloudDescent, {
        noiseGLSL,
        densityGLSL,
      })
      for (const [i, result] of descent.entries()) {
        assert.ok(
          result.correlation > [0.9, 0.8][i],
          `${name}: cloud banks moved during descent`,
        )
        assert.ok(
          Math.abs(result.opacityChange) < 0.04,
          `${name}: cloud cover changed during descent`,
        )
      }
      const signatures = []
      for (const id of types) {
        await openControls(page, "Environment")
        await page
          .getByLabel("Cloud type", { exact: true })
          .selectOption(String(id))
        if (name !== "no-depth-texture")
          await page.waitForFunction(
            () =>
              window.probe.map.earth.environment.cloudStats.historyFrames >= 12,
            null,
            { timeout: 30000 },
          )
        else await page.waitForTimeout(300)
        const screenshot = await page.screenshot({
          path: path.join(output, `${name}-${id}.png`),
        })
        const { data } = await sharp(screenshot)
          .extract({ left: 0, top: 0, width: 900, height: 250 })
          .resize(24, 12)
          .removeAlpha()
          .raw()
          .toBuffer({ resolveWithObject: true })
        signatures.push({ id, pixels: [...data] })
      }
      // Different genera must produce different rendered sky patterns, not labels alone.
      for (let i = 1; i < signatures.length; i++) {
        const difference =
          signatures[i].pixels.reduce(
            (n, v, j) => n + Math.abs(v - signatures[i - 1].pixels[j]),
            0,
          ) / signatures[i].pixels.length
        assert.ok(
          difference > 0.1,
          `${name}: genera ${signatures[i - 1].id}/${signatures[i].id} differ`,
        )
      }
      const qualities = []
      for (const [q, limit] of [
        ["low", 130000],
        ["balanced", 260000],
        ["high", 560000],
      ]) {
        await openControls(page, "Environment")
        await page.getByLabel("Cloud quality", { exact: true }).selectOption(q)
        await page.waitForFunction(
          ({ q, limit }) => {
            const s = window.probe.map.earth.environment.cloudStats
            return (
              s.quality === q &&
              (s.lowResolution
                ? s.width * s.height <= limit &&
                  s.steps === { low: 24, balanced: 40, high: 64 }[q]
                : s.steps === 24)
            )
          },
          { q, limit },
        )
        const stats = await page.evaluate(() => ({
          ...window.probe.map.earth.environment.cloudStats,
        }))
        if (name !== "no-depth-texture")
          assert.ok(stats.width * stats.height <= limit)
        else {
          assert.equal(stats.lowResolution, false)
          assert.equal(stats.steps, 24)
        }
        qualities.push(stats)
      }
      await openControls(page, "Environment")
      await page
        .getByLabel("Cloud quality", { exact: true })
        .selectOption("balanced")
      await page
        .getByRole("button", { name: "Fullscreen", exact: true })
        .click()
      await page.waitForFunction(() => !!document.fullscreenElement)
      await page
        .getByRole("button", { name: "Exit fullscreen", exact: true })
        .click()
      await page.waitForFunction(() => !document.fullscreenElement)
      // Many faint samples must accumulate into visible cirrus at high quality.
      await openControls(page, "Environment")
      await page.getByLabel("Cloud type", { exact: true }).selectOption("1")
      await openControls(page, "Environment")
      await page
        .getByLabel("Cloud quality", { exact: true })
        .selectOption("high")
      await page.evaluate(() =>
        window.probe.map.lookAt({
          target: { latitude: 35, longitude: -125, altitude: 0 },
          distance: 55000,
          tilt: 0,
          heading: 0,
        }),
      )
      if (name !== "no-depth-texture")
        await page.waitForFunction(
          () =>
            window.probe.map.earth.environment.cloudStats.historyFrames >= 12,
        )
      else await page.waitForTimeout(300)
      const thin = await page.screenshot({
        path: path.join(output, `${name}-thin-cirrus.png`),
      })
      await page.evaluate(() => {
        window.probe.map.earth.environment.clouds.material.visible = false
        window.probe.map.update()
      })
      await page.waitForTimeout(200)
      const thinClear = await page.screenshot()
      const thinCloudPixels = await cloudPixelDifference(thin, thinClear)
      assert.ok(
        thinCloudPixels > 1000,
        `${name}: thin cirrus accumulates at high quality (${thinCloudPixels})`,
      )
      await page.evaluate(() => {
        window.probe.map.earth.environment.clouds.material.visible = true
        window.probe.map.update()
      })
      await openControls(page, "Environment")
      await page
        .getByLabel("Cloud quality", { exact: true })
        .selectOption("balanced")
      await openControls(page, "Environment")
      await page.getByLabel("Cloud type", { exact: true }).selectOption("10")
      // Below, inside, and above a cloud layer, then an orbital and polar/dateline view.
      for (const [view, distance, tilt, latitude, longitude] of [
        ["inside", 10000, 75, 35, -125],
        ["above", 55000, 0, 35, -125],
        ["polar", 120000, 60, 81, 179.9],
      ]) {
        await page.evaluate(
          ({ distance, tilt, latitude, longitude }) =>
            window.probe.map.lookAt({
              target: { latitude, longitude, altitude: 0 },
              distance,
              tilt,
              heading: 0,
            }),
          { distance, tilt, latitude, longitude },
        )
        await page.waitForTimeout(700)
        await page.screenshot({
          path: path.join(output, `${name}-${view}.png`),
        })
      }
      if (name !== "no-depth-texture") {
        const pan = await page.evaluate(measureCloudPan)
        assert.ok(pan.samples > 1000, `${name}: pan check needs visible clouds`)
        assert.ok(
          pan.rms < 1,
          `${name}: pan changed cloud opacity by ${pan.rms}/255 RMS`,
        )
      }
      await page.getByRole("button", { name: "Earth", exact: true }).click()
      await openControls(page, "Environment")
      await page.getByLabel("Cloud type", { exact: true }).selectOption("0")
      await page.waitForTimeout(1500)
      const orbit = await page.screenshot({
        path: path.join(output, `${name}-orbit.png`),
      })
      // Hide only the cloud draw: leave ground shadows and lighting unchanged.
      await page.evaluate(() => {
        window.probe.map.earth.environment.clouds.material.visible = false
        window.probe.map.update()
      })
      await page.waitForTimeout(500)
      const clear = await page.screenshot({
        path: path.join(output, `${name}-orbit-no-cloud-draw.png`),
      })
      const pixels = async buffer =>
        sharp(buffer)
          .extract({ left: 0, top: 0, width: 1000, height: 550 })
          .removeAlpha()
          .raw()
          .toBuffer()
      const a = await pixels(orbit),
        b = await pixels(clear)
      let cloudPixels = 0
      for (let i = 0; i < a.length; i += 3)
        if (
          Math.abs(a[i] - b[i]) +
            Math.abs(a[i + 1] - b[i + 1]) +
            Math.abs(a[i + 2] - b[i + 2]) >
          25
        )
          cloudPixels++
      assert.ok(
        cloudPixels > 1000,
        `${name}: clouds themselves remain visible against Earth from orbit (${cloudPixels})`,
      )
      await page.evaluate(() => {
        window.probe.map.earth.environment.clouds.material.visible = true
        window.probe.map.update()
      })
      const before = await page.evaluate(
        () => window.probe.map.earth.environment.uniforms.cloudTime.value,
      )
      await page.waitForTimeout(400)
      assert.ok(
        (await page.evaluate(
          () => window.probe.map.earth.environment.uniforms.cloudTime.value,
        )) > before,
        "wind advances",
      )
      const capabilities = await page.evaluate(() => {
        const gl = window.probe.map.renderer.getContext(),
          ext = gl.getExtension("WEBGL_debug_renderer_info")
        return {
          webgl2: window.probe.map.renderer.capabilities.isWebGL2,
          renderer: ext
            ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)
            : "unknown",
        }
      })
      await page.evaluate(() => window.probe.map.dispose())
      await page.waitForTimeout(200)
      assert.equal(
        await page.evaluate(
          () => window.probe.map.renderer.info.memory.geometries,
        ),
        0,
        "cloud geometry is released",
      )
      assert.deepEqual(errors, [])
      results.push({
        name,
        capabilities,
        qualities,
        genera: types,
        cloudPixels,
        thinCloudPixels,
        errors,
      })
      console.log(name, "passed", capabilities)
    } finally {
      await browser.close()
    }
  }
  await fs.writeFile(
    path.join(output, "metrics.json"),
    JSON.stringify(results, null, 2),
  )
}
main().catch(reportFailure)
