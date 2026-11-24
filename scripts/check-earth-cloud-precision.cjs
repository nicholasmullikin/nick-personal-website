// Constant cloud density exposes numerical holes independently of weather noise.
const assert = require("node:assert/strict")
const { chromium } = require("playwright")
const { createRequire } = require("node:module")
const sharp = createRequire(require.resolve("gatsby-plugin-sharp"))("sharp")
const {
  previewURL,
  mapboxToken,
  installProbe,
  browserErrors,
  reportFailure,
} = require("./lib/earth-browser.cjs")
// One shell has two visible crossings when a ray grazes above the terrain.
// Round-trip both through the same 16-bit normalized format as the depth texture.
function checkGrazingDepth(cloudDepthGLSL) {
  const { map, THREE } = window.probe
  const renderer = map.renderer
  const radius = 6378.137
  const cameraAltitude = 4
  const tangentAltitude = 1
  const cloudAltitude = 2.5
  const b = -Math.sqrt(
    (cameraAltitude - tangentAltitude) *
      (2 * radius + cameraAltitude + tangentAltitude),
  )
  const root = Math.sqrt(
    (cloudAltitude - tangentAltitude) *
      (2 * radius + cloudAltitude + tangentAltitude),
  )
  const radial = b / (radius + cameraAltitude)
  const material = new THREE.ShaderMaterial({
    uniforms: {
      radial: { value: radial },
      roots: { value: new THREE.Vector2(-b - root, -b + root) },
    },
    vertexShader: "void main(){gl_Position=vec4(position.xy,0.,1.);}",
    fragmentShader: `precision highp float;
      uniform float radial; uniform vec2 roots;
      ${cloudDepthGLSL}
      void main(){
       vec3 origin=vec3(0.,0.,6382.137);
       vec3 dir=vec3(sqrt(1.-radial*radial),0.,radial);
       float expected=gl_FragCoord.x<1.?roots.x:roots.y;
       float depth=encodeCloudDepth(2.5,dot(origin,dir)+expected);
       float stored=floor(depth*65535.+.5)/65535.;
       float actual=cloudShellDistance(origin,dir,4.,stored);
       gl_FragColor=vec4(clamp(abs(expected-actual)*10.,0.,1.),1.,0.,1.);
      }`,
  })
  const scene = new THREE.Scene()
  const geometry = new THREE.PlaneGeometry(2, 2)
  const quad = new THREE.Mesh(geometry, material)
  quad.frustumCulled = false
  scene.add(quad)
  const previous = renderer.getRenderTarget()
  const target = new THREE.WebGLRenderTarget(2, 1)
  try {
    renderer.setRenderTarget(target)
    renderer.render(scene, map.camera)
    const px = new Uint8Array(8)
    renderer.readRenderTargetPixels(target, 0, 0, 2, 1, px)
    return {
      near: px[0] / 2.55,
      far: px[4] / 2.55,
      ran: px[1] === 255 && px[5] === 255,
    }
  } finally {
    renderer.setRenderTarget(previous)
    geometry.dispose()
    material.dispose()
    target.dispose()
  }
}
// Compare the lit bank above a snowy ridge during a short lateral pan.
// A uniform-opacity test cannot detect bands in reflected cloud light.
async function checkMovingCloudBank(mode) {
  const forecast = mode === "forecast"
  const regional = mode === "regional"
  const routes = {
    ridge: [-49.31, -72.96, 1600, 24000, 81, 0, 337, 0],
    forecast: [33, -119, 0, 23000, 12, 8, 80, 0],
    regional: [38, -85, 0, 145000, 40, 0.025, 21, 0.04],
  }
  const [latitude, longitude, altitude, distance, tilt, tiltStep, heading, headingStep] =
    routes[mode || "ridge"]
  const { map, THREE } = window.probe
  const renderer = map.renderer
  const width = 240,
    height = 176
  const target = new THREE.WebGLRenderTarget(width, height)
  const render = renderer.render
  let scene, directMaterial
  renderer.render = function (current, camera) {
    if (current.userData.earthPass === "cloudVolume") scene = current
    return render.call(this, current, camera)
  }
  const previous = renderer.getRenderTarget()
  // Hold each forecast layer constant across the sweep to isolate sampling.
  const coverage = map.earth.environment.uniforms.cloudMap
  const historical = coverage.value
  const fixture = forecast
    ? new THREE.DataTexture(new Uint8Array([185, 117, 94, 255]), 1, 1)
    : null
  let last,
    absoluteSquared = 0,
    absoluteSamples = 0,
    squared = 0,
    samples = 0
  try {
    map.earth.environment.setCloudPreset(0)
    map.earth.environment.setCloudQuality("balanced")
    map.earth.setSunHour((12 + (-112.15 + 72.96) / 15 + 24) % 24)
    if (fixture) {
      fixture.needsUpdate = true
      coverage.value = fixture
      map.earth.environment.uniforms.cloudPreset.value = -1
    }
    for (let frame = 0; frame < 8; frame++) {
      map.lookAt({
        target: {
          latitude,
          longitude: longitude + 0.001 * frame,
          altitude,
        },
        distance,
        tilt: tilt + frame * tiltStep,
        heading: heading + frame * headingStep,
      })
      await new Promise(done => {
        function rendered() {
          map.removeEventListener("didrender", rendered)
          done()
        }
        map.addEventListener("didrender", rendered)
        map.update()
      })
      const mesh = scene.children[0]
      const material = mesh.material
      if (regional && !directMaterial) {
        // Keep the march and lighting identical. Only bypass the column interpolation.
        const interpolation = "mix(leftColumn,rightColumn,u)"
        if (!material.fragmentShader.includes(interpolation))
          throw Error("Regional column reference no longer matches the shader")
        directMaterial = material.clone()
        directMaterial.fragmentShader = material.fragmentShader.replace(
          interpolation,
          "sampleRegionalColumn(p,t)",
        )
      }
      const { cloudSteps, cloudStepRefinement, cloudTime } = material.uniforms
      const elapsed = cloudTime.value
      const budget = cloudSteps.value,
        refinement = cloudStepRefinement.value
      const error = new Int16Array(width * height)
      try {
        if (regional) cloudTime.value = 30
        let current
        for (const reference of [false, true]) {
          if (reference && regional) {
            directMaterial.uniforms = material.uniforms
            mesh.material = directMaterial
          } else if (reference) {
            cloudSteps.value = 160
            cloudStepRefinement.value = 0
          }
          renderer.setRenderTarget(target)
          renderer.clear()
          render.call(renderer, scene, map.camera)
          const pixels = new Uint8Array(width * height * 4)
          renderer.readRenderTargetPixels(target, 0, 0, width, height, pixels)
          if (!reference) {
            current = pixels
            continue
          }
          for (let y = Math.floor(height * 0.27); y < height * 0.56; y++) {
            for (let x = Math.floor(width * 0.2); x < width * 0.83; x++) {
              const i = y * width + x
              if (pixels[4 * i + 3] < 20) continue
              const channel = 4 * i + (forecast || regional ? 3 : 0)
              error[i] = current[channel] - pixels[channel]
              absoluteSquared += error[i] ** 2
              absoluteSamples++
              if (last) {
                squared += (error[i] - last[i]) ** 2
                samples++
              }
            }
          }
        }
      } finally {
        mesh.material = material
        cloudTime.value = elapsed
        cloudSteps.value = budget
        cloudStepRefinement.value = refinement
        renderer.setRenderTarget(previous)
      }
      last = error
    }
    return {
      samples,
      rms: Math.sqrt(squared / samples),
      absoluteRms: Math.sqrt(absoluteSquared / absoluteSamples),
    }
  } finally {
    renderer.render = render
    directMaterial?.dispose()
    if (fixture) {
      coverage.value = historical
      map.earth.environment.setCloudPreset(0)
      fixture.dispose()
    }
    target.dispose()
  }
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
      () => window.probe?.map.earth.environment.cloudStats.historyFrames > 0,
    )
    const { cloudDepthGLSL } = require("./lib/earth-source.cjs").load(
      "cloud-reconstruction.js",
    )
    const grazing = await page.evaluate(checkGrazingDepth, cloudDepthGLSL)
    console.log("Grazing shell depth error (metres)", {
      near: grazing.near,
      far: grazing.far,
    })
    assert.ok(
      grazing.ran && grazing.near < 20 && grazing.far < 20,
      `Both crossings should reconstruct within 20 metres at grazing incidence: ${JSON.stringify(grazing)}`,
    )
    await page.evaluate(() => {
      const map = window.probe.map,
        renderer = map.renderer,
        render = renderer.render
      renderer.render = function (scene, camera) {
        if (scene.userData.earthPass === "cloudVolume")
          window.cloudVolumeMaterial = scene.children[0].material
        return render.call(this, scene, camera)
      }
      map.lookAt({
        target: { latitude: 49.95, longitude: -123.04, altitude: 1650 },
        distance: 1800,
        tilt: 72,
        heading: 330,
      })
      map.update()
    })
    await page.waitForFunction(() => !!window.cloudVolumeMaterial)
    await page.waitForTimeout(6000)
    await page.evaluate(() => {
      const material = window.cloudVolumeMaterial
      const original = "density*=orbitalDensity;"
      if (!material.fragmentShader.includes(original))
        throw Error("Cloud density probe no longer matches shader")
      material.fragmentShader = material.fragmentShader.replace(
        original,
        "density=1.;",
      )
      material.needsUpdate = true
      window.probe.map.update()
    })
    await page.waitForTimeout(3000)
    const image = await page.screenshot()
    const pixels = await sharp(image)
      .removeAlpha()
      .extract({ left: 440, top: 70, width: 420, height: 140 })
      .raw()
      .toBuffer()
    let colorful = 0
    for (let i = 0; i < pixels.length; i += 3)
      if (
        Math.max(pixels[i], pixels[i + 1], pixels[i + 2]) -
          Math.min(pixels[i], pixels[i + 1], pixels[i + 2]) >
        25
      )
        colorful++
    assert.ok(
      colorful < 50,
      `constant-density skyline leaked ${colorful} colorful terrain pixels`,
    )
    // Start with the unmodified density shader for the moving-bank check.
    await page.reload()
    await page.waitForFunction(
      () =>
        window.probe?.map.earth.environment.status.cloudReady &&
        window.probe.map.earth.environment.status.noiseReady,
    )
    const moving = await page.evaluate(checkMovingCloudBank)
    console.log("Moving cloud-bank error against dense reference", moving)
    assert.ok(
      moving.samples > 5000 && moving.rms < 3,
      "Cloud lighting flickered during the ridge pan",
    )
    const forecast = await page.evaluate(checkMovingCloudBank, "forecast")
    console.log("Forecast opacity error through the angle sweep", forecast)
    assert.ok(
      forecast.samples > 5000 && forecast.absoluteRms < 9,
      "Layered forecast lost coverage as the camera tilted",
    )
    const regional = await page.evaluate(checkMovingCloudBank, "regional")
    console.log("Regional opacity error against direct column samples", regional)
    assert.ok(
      regional.samples > 5000 && regional.absoluteRms < 15,
      "Regional cloud edge diverged from directly sampled weather during the pan",
    )
    assert.deepEqual(errors, [])
    console.log(`Constant-density skyline: ${colorful} leaked terrain pixels`)
  } finally {
    await browser.close()
  }
}
main().catch(reportFailure)
