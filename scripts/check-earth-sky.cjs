const pw = require("playwright"),
  h = require("./lib/earth-browser.cjs")
;(async () => {
  const b = await pw.firefox.launch({
    firefoxUserPrefs: { "webgl.enable-webgl2": false },
  })
  try {
    const p = await b.newPage()
    await h.installProbe(p)
    await p.goto(h.previewURL + "/harp/earth-background.html")
    await p.waitForFunction(() => window.probe?.imagery.ready)
    console.log(
      await p.evaluate(() => {
        const { map, THREE, background } = window.probe
        background.setPaused(true)
        const sky = map.scene.children.find(
          o =>
            o.material?.uniforms?.transmittanceLut && o.renderOrder === 10000,
        )
        const scene = new THREE.Scene()
        scene.add(sky)
        const c = new THREE.PerspectiveCamera(35, 1, 0.1, 1000)
        const u = sky.material.uniforms
        u.inverseProjection.value.copy(c.projectionMatrixInverse)
        u.cameraRotation.value.identity()
        u.cameraKm.value.set(0, 0, -20000)
        u.sunDirection.value.set(0, 0, -1)
        const target = new THREE.WebGLRenderTarget(1024, 1024),
          r = map.renderer
        r.setRenderTarget(target)
        r.render(scene, c)
        const row = new Uint8Array(1024 * 4)
        r.readRenderTargetPixels(target, 0, 512, 1024, 1, row)
        let count = 0
        for (let x = 460; x < 565; x++) if (row[x * 4] > 235) count++
        if (count < 14 || count > 17)
          throw Error("Unexpected diameter " + count)
        u.cameraKm.value.set(0, 0, 20000)
        r.render(scene, c)
        r.readRenderTargetPixels(target, 512, 512, 1, 1, row)
        if (row[0] > 235) throw Error("Sun visible through Earth")
        r.setRenderTarget(null)
        target.dispose()
        map.scene.add(sky)
        return {
          diameterPixels: count,
          expectedPixels:
            (1024 * Math.tan(0.00465)) / Math.tan((35 * Math.PI) / 360),
        }
      }),
    )
  } finally {
    await b.close()
  }
})().catch(h.reportFailure)
