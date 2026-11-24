// A close city view without building tiles must not saturate the entire ground.
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path")
const { createRequire } = require("node:module")
const sharp = createRequire(require.resolve("gatsby-plugin-sharp"))("sharp")
const { chromium, firefox } = require("playwright")
const { mapboxToken, installProbe, previewURL, reportFailure } = require("./lib/earth-browser.cjs")
// Isolate the photo response from weather and moon color. An almost-white
// patch and its neutral neighbor should stay close under the same illumination.
async function checkHighlights(page, browser) {
  const samples = await page.evaluate(() => {
    const { map, THREE } = window.probe
    const terrain = map.visibleTileSet.dataSourceTileList.find(e => e.dataSource.name === "terrain")
    const shader = Array.from(terrain.renderedTiles.values())
      .flatMap(tile => tile.objects).find(mesh => mesh.material?.userData.earthTerrain).material.fragmentShader
    const functions = shader.match(/vec3 (?:photographicRadiance|photographicReflectance|displayColor)\([^]*?\n}/g)
    const material = new THREE.ShaderMaterial({
      vertexShader: "void main(){gl_Position=vec4(position.xy,0.,1.);}",
      fragmentShader: functions.join("\n") + `
        void main(){
          float day=-.2+.4*floor(gl_FragCoord.x)/16.;
          float row=floor(gl_FragCoord.y);
          vec3 photo=row<1.?vec3(1.):row<2.?vec3(.97,1.,.97):vec3(1.,.97,1.);
          vec3 light=vec3(mix(.02,.35,smoothstep(-.12,.18,day)));
          gl_FragColor=vec4(displayColor(photographicReflectance(photo,day)*light),1.);
        }`,
    })
    const scene = new THREE.Scene(), geometry = new THREE.PlaneGeometry(2, 2)
    scene.add(new THREE.Mesh(geometry, material))
    const target = new THREE.WebGLRenderTarget(17, 3)
    const renderer = map.renderer, previous = renderer.getRenderTarget()
    try {
      renderer.setRenderTarget(target)
      renderer.render(scene, new THREE.Camera())
      const pixels = new Uint8Array(17 * 3 * 4)
      renderer.readRenderTargetPixels(target, 0, 0, 17, 3, pixels)
      return Array.from(pixels)
    } finally {
      renderer.setRenderTarget(previous)
      target.dispose()
      geometry.dispose()
      material.dispose()
      map.update()
    }
  })
  assert.ok(samples[0] > 3 && samples[64] > samples[0] + 80, "missing night-to-day exposure ramp")
  let largest = 0
  for (let i = 0; i < samples.length; i += 4)
    largest = Math.max(largest, Math.abs(samples[i] - samples[i + 1]), Math.abs(samples[i + 1] - samples[i + 2]))
  assert.ok(largest <= 5, browser + ": pale highlights acquired a color cast of " + largest)
  console.log(browser + ": maximum highlight channel spread " + largest + "/255 across 17 sun angles")
}
async function main() {
  const token = await mapboxToken()
  for (const [name, engine, launch] of [
    ["chromium", chromium, {}],
    ["firefox-webgl1", firefox, { firefoxUserPrefs: { "webgl.enable-webgl2": false } }],
  ]) {
    const browser = await engine.launch(launch)
    try {
      const context = await browser.newContext({ viewport: { width: 1280, height: 850 } })
      const assets = process.env.EARTH_ASSET_DIR
      if (assets) {
        const shared = fs.readdirSync(assets).find(name => /^earth-shared\..*\.js$/.test(name))
        assert.ok(shared)
        await context.route("**/harp/*.js*", route => {
          let name = new URL(route.request().url()).pathname.split("/").pop()
          if (name.startsWith("earth-shared.")) name = shared
          const file = path.join(assets, name)
          return fs.existsSync(file) ? route.fulfill({ path: file, contentType: "application/javascript" }) : route.continue()
        })
      }
      const page = await context.newPage(), errors = []
      page.on("pageerror", error => errors.push(error.message))
      await installProbe(page)
      await page.goto(`${previewURL}/harp/rendering_globe-atmosphere.html?mapbox_token=${token}`)
      await page.waitForFunction(() => window.probe?.map.earth.environment.status.noiseReady, null, { timeout: 60000 })
      await page.evaluate(() => {
        const map = window.probe.map
        map.earth.setSunHour(23)
        map.earth.environment.setClouds(false)
        map.earth.buildings.setEnabled(false)
        map.lookAt({ target: { latitude: 40.751, longitude: -73.986, altitude: 45 }, distance: 920, tilt: 71, heading: 22 })
        map.update()
      })
      await page.waitForTimeout(7000)
      await checkHighlights(page, name)
      const pixels = await sharp(await page.screenshot()).extract({ left: 200, top: 200, width: 800, height: 500 }).removeAlpha().raw().toBuffer()
      let saturated = 0, sum = 0, sumSquares = 0
      for (let i = 0; i < pixels.length; i += 3) {
        const lum = (pixels[i] + pixels[i + 1] + pixels[i + 2]) / 3
        if (lum > 220) saturated++
        sum += lum
        sumSquares += lum * lum
      }
      const count = pixels.length / 3, deviation = Math.sqrt(sumSquares / count - (sum / count) ** 2)
      assert.equal(errors.length, 0, errors.join("\n"))
      assert.ok(saturated / count < .1, `${name}: near-city terrain is saturated`)
      assert.ok(deviation > 5, `${name}: terrain has lost its photographic structure`)
      console.log(`${name}: ${(100 * saturated / count).toFixed(2)}% saturated, luminance deviation ${deviation.toFixed(1)}`)
    } finally { await browser.close() }
  }
}
main().catch(reportFailure)
