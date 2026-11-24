// Compare the real panorama against the same pixels with longitude rotated by
// half a turn. The reference's mip seam is on the far side of the planet.
// Run Chromium on the native GPU because software filtering can hide this bug.
const assert = require("node:assert/strict")
const { createRequire } = require("node:module")
const { chromium, firefox } = require("playwright")
const {
  previewURL,
  installProbe,
  browserErrors,
  reportFailure,
} = require("./lib/earth-browser.cjs")
const sharp = createRequire(require.resolve("gatsby-plugin-sharp"))("sharp")

async function main() {
  const engine =
    process.env.EARTH_SAMPLER_BROWSER === "firefox" ? firefox : chromium
  const browser = await engine.launch(
    engine === firefox
      ? { firefoxUserPrefs: { "webgl.enable-webgl2": false } }
      : {
          args: [
            "--enable-gpu",
            "--use-angle=vulkan",
            "--enable-features=Vulkan",
            "--use-vulkan=native",
          ],
        },
  )
  try {
    const page = await browser.newPage({
      viewport: { width: 900, height: 580 },
    })
    const errors = browserErrors(page)
    await installProbe(page)
    await page.goto(
      new URL("/harp/rendering_globe-atmosphere.html", previewURL).href,
      { waitUntil: "domcontentloaded" },
    )
    await page.waitForFunction(() => window.probe?.map.earth)
    await page.evaluate(() => {
      const map = window.probe.map
      map.earth.environment.setClouds(false)
      map.earth.buildings.setEnabled(false)
      map.lookAt({
        target: { latitude: -45, longitude: 179.8 },
        distance: 4700000,
        tilt: 38,
        heading: 0,
      })
    })
    await page.waitForFunction(() => {
      const map = window.probe.map
      return (
        map.visibleTileSet.dataSourceTileList.find(
          e => e.dataSource.name === "terrain",
        )?.allVisibleTileLoaded &&
        map.scene.children.some(
          node =>
            node.material?.uniforms?.fallbackSurface?.value.image.width ===
            4096,
        )
      )
    })
    await page.evaluate(async () => {
      const { map, THREE } = window.probe
      map.lockVisibleTileSet = true
      const photo = await createImageBitmap(
        await (await fetch("/earth-background/surface.webp")).blob(),
      )
      const canvas = document.createElement("canvas")
      canvas.width = photo.width
      canvas.height = photo.height
      const ctx = canvas.getContext("2d")
      ctx.drawImage(photo, -photo.width / 2, 0)
      ctx.drawImage(photo, photo.width / 2, 0)
      photo.close()
      const texture = new THREE.CanvasTexture(canvas)
      texture.wrapS = THREE.RepeatWrapping
      texture.minFilter = THREE.LinearMipmapLinearFilter
      texture.anisotropy = Math.min(
        8,
        map.renderer.capabilities.getMaxAnisotropy(),
      )
      const materials = []
      const marker = "vec3 radial=normalize(worldKm),normal="
      map.scene.traverse(node => {
        const mat = node.material
        if (!mat?.userData.earthTerrain) return
        if (!mat.fragmentShader.includes(marker))
          throw Error("Missing terrain albedo insertion point")
        mat.uniforms.rotatedPhoto = { value: texture }
        mat.uniforms.useRotatedPhoto = { value: 0 }
        mat.fragmentShader = mat.fragmentShader
          .replace(
            "uniform float overlayMode;",
            "uniform sampler2D rotatedPhoto;uniform float useRotatedPhoto;uniform float overlayMode;",
          )
          .replace(
            marker,
            `
          vec3 direction=normalize(worldKm);
          vec2 rotatedUv=vec2(atan(-direction.y,-direction.x)/6.283185307+.5,asin(clamp(direction.z,-1.,1.))/3.141592654+.5);
          gl_FragColor=vec4(useRotatedPhoto>.5?texture2D(rotatedPhoto,rotatedUv).rgb:pow(albedo,vec3(1./2.2)),1.);return;
          ` + marker,
          )
        mat.needsUpdate = true
        materials.push(mat)
      })
      if (!materials.length) throw Error("No visible panorama terrain")
      window.renderComparison = reference => {
        for (const mat of materials)
          mat.uniforms.useRotatedPhoto.value = reference ? 1 : 0
        const frame = map.frameNumber
        map.update()
        return frame
      }
    })
    const grab = async reference => {
      const frame = await page.evaluate(
        value => window.renderComparison(value),
        reference,
      )
      await page.waitForFunction(
        before => window.probe.map.frameNumber > before,
        frame,
      )
      // This narrow strip crosses the geographic wrap below all UI.
      return sharp(await page.screenshot())
        .extract({ left: 436, top: 200, width: 32, height: 315 })
        .removeAlpha()
        .raw()
        .toBuffer()
    }
    const surface = await grab(false),
      reference = await grab(true)
    let max = 0,
      changed = 0
    for (let i = 0; i < surface.length; i += 3) {
      const difference = Math.max(
        ...[0, 1, 2].map(c => Math.abs(surface[i + c] - reference[i + c])),
      )
      max = Math.max(max, difference)
      if (difference > 5) changed++
    }
    assert.ok(
      changed < 12,
      `discontinuous panorama across ${changed} pixels (max channel error ${max})`,
    )
    assert.deepEqual(errors, [])
    console.log(JSON.stringify({ changed, pixels: surface.length / 3, max }))
  } finally {
    await browser.close()
  }
}
main().catch(reportFailure)
