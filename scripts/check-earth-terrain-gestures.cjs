// Exercise real wheel input over oblique terrain where a sea-level sphere
// and the cursor's visible mesh intersection can be kilometres apart.
const assert = require("node:assert/strict")
const { chromium, firefox } = require("playwright")
const { installProbe, mapboxToken, previewURL, settleImagery, browserErrors, reportFailure } =
  require("./lib/earth-browser.cjs")

async function anchorAtTerrain(page) {
  return page.evaluate(() => {
    const { map } = window.probe
    const elevation = map.earth.elevationProvider
    const cameraGround = elevation.getHeight(map.projection.unprojectPoint(map.camera.position)) || 0
    let best
    for (const x of [340, 600, 480]) {
      for (const y of [340, 425, 540]) {
        const hit = elevation.rayCast(x, y)
        if (!hit) continue
        const relief = Math.abs(map.projection.unprojectAltitude(hit) - cameraGround)
        if (!best || relief > best.relief) best = { x, y, hit, relief }
      }
    }
    if (!best) throw Error("No visible terrain for the input test")
    const { x, y, hit } = best
    window.projectGestureAnchor = () => {
      const ndc = hit.clone().project(map.camera)
      return { x: ((ndc.x + 1) * innerWidth) / 2, y: ((1 - ndc.y) * innerHeight) / 2, zoom: map.zoomLevel }
    }
    return { x, y, zoom: map.zoomLevel }
  })
}
// Exercise the handoff from a wheel animation to a drag, a bookmarked view,
// and the next wheel event in the same renderer.
async function checkZoomInterruption(page) {
  const result = await page.evaluate(async () => {
    const map = window.probe.map
    const canvas = map.canvas
    const target = { latitude: 0, longitude: -150, altitude: 0 }
    const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
    const point = { clientX: canvas.clientWidth / 2, clientY: canvas.clientHeight / 2 }
    const wheel = deltaY => canvas.dispatchEvent(new WheelEvent("wheel", { ...point, deltaY, cancelable: true }))
    map.lookAt({ target, distance: 100000, tilt: 15 })
    await wait(220)
    for (let i = 0; i < 12; i++) wheel(-100)
    canvas.dispatchEvent(new MouseEvent("mousedown", { ...point, button: 2, bubbles: true }))
    window.dispatchEvent(new MouseEvent("mousemove", { ...point, clientX: point.clientX + 4, buttons: 2 }))
    window.dispatchEvent(new MouseEvent("mouseup", { ...point, button: 2 }))
    map.lookAt({ target, distance: 2000000, tilt: 10 })
    await wait(250)
    const before = map.zoomLevel
    wheel(100)
    await wait(350)
    return { before, after: map.zoomLevel }
  })
  console.log("Wheel after interrupted zoom and camera change", result)
  const expected = -0.32 * Math.tanh(1.5)
  assert.ok(Math.abs(result.after - result.before - expected) < 0.07, "Wheel resumed an interrupted zoom")
}

async function main() {
  const useFirefox = process.env.EARTH_GESTURE_BROWSER === "firefox"
  const browser = useFirefox
    ? await firefox.launch({ firefoxUserPrefs: { "webgl.enable-webgl2": false } })
    : await chromium.launch({ args: ["--enable-gpu", "--use-angle=vulkan", "--enable-features=Vulkan", "--use-vulkan=native"] })
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 720 } })
    await installProbe(page)
    const errors = browserErrors(page)
    await page.goto(previewURL + "/harp/rendering_globe-atmosphere.html?mapbox_token=" + await mapboxToken())
    await page.waitForFunction(() => window.probe?.map.earth)
    await page.evaluate(() => window.probe.map.earth.environment.setClouds(false))
    for (const [pose, latitude, longitude, altitude, distance, tilt, heading] of [
      ["Garibaldi", 49.95, -123.04, 1650, 3500, 78, 330],
      ["Alps", 45.91, 6.87, 3000, 5700, 78, 185],
      ["Campus Point", 34.406, -119.846, 8, 650, 72, 320],
    ]) {
      for (const [pulses, dy] of [[1,-100],[10,-10],[12,1],[1,100]]) {
        await page.evaluate(args => {
          window.probe.map.lookAt(args)
          window.probe.map.update()
        }, { target: { latitude, longitude, altitude }, distance, tilt, heading })
        await settleImagery(page)
        const anchor = await anchorAtTerrain(page)
        await page.mouse.move(anchor.x, anchor.y)
        for (let i = 0; i < pulses; i++) {
          await page.mouse.wheel(0, dy)
          await page.waitForTimeout(20)
        }
        await page.waitForTimeout(700)
        const after = await page.evaluate(() => window.projectGestureAnchor())
        const drift = Math.hypot(after.x - anchor.x, after.y - anchor.y)
        const zoom = after.zoom - anchor.zoom
        console.log(pose, pulses, dy, { drift, zoom })
        assert.ok(drift < 3, "Picked ground moved away from the cursor")
        assert.equal(Math.sign(zoom), -Math.sign(dy), "Wrong zoom direction")
        const expected = -pulses * 0.32 * Math.tanh(1.5 * dy / 100)
        assert.ok(Math.abs(zoom - expected) < 0.08, "Unexpected wheel sensitivity")
      }
    }
    // Compare rendered zoom against landmark motion measured in satellite view.
    const burstCases = [
      ["five quick notches", Array(5).fill(-100), 35, 1.43],
      ["sustained spin", Array(12).fill(-100), 35, 3.44],
      ["slower spin", Array(12).fill(-100), 80, 3.44],
      ["reverse mid-spin", [-100,-100,-100,100,100,100], 33, 0],
      ["Firefox line-mode notches", Array(5).fill(-3), 35, 1.43, 1],
      ["fractional precision input", Array(10).fill(-10), 35, 0.47],
    ]
    for (const [name, deltas, gap, expected, mode = 0] of burstCases) {
      await page.evaluate(() => window.probe.map.lookAt({
        target: { latitude: 0, longitude: -150, altitude: 0 }, distance: 100000, tilt: 0,
      }))
      await page.waitForTimeout(250)
      const zoom = () => page.evaluate(() => window.probe.map.zoomLevel)
      const before = await zoom()
      const samples = []
      await page.mouse.move(480, 360)
      for (const deltaY of deltas) {
        if (mode) {
          await page.locator("#mapCanvas").dispatchEvent("wheel", {
            deltaY, deltaMode: mode, clientX: 480, clientY: 360,
          })
        } else {
          await page.mouse.wheel(0, deltaY)
        }
        await page.waitForTimeout(gap)
        samples.push(await zoom() - before)
      }
      await page.waitForTimeout(500)
      const actual = await zoom() - before
      console.log(name, actual, "during gesture", samples)
      assert.ok(Math.abs(actual - expected) < 0.07, name)
      if (deltas.length === 12) {
        for (const i of [3, 6, 9])
          assert.ok(samples[i + 2] - samples[i] > 0.25, "scroll stalled during " + name)
      }
    }
    // An off-centre zoom out from a high ridge can put the centre ray over
    // the horizon. The reverse gesture must still bring the surface back.
    await page.evaluate(() => window.probe.map.lookAt({
      target: { latitude: 35.8, longitude: 78.2, altitude: 4800 },
      distance: 90000, tilt: 80, heading: 40,
    }))
    await page.waitForTimeout(500)
    const sweep = await page.evaluate(async () => {
      const { map, THREE } = window.probe
      const direction = new THREE.Vector3()
      const nearest = new THREE.Vector3()
      let maximumMiss = 0
      const zooms = []
      function measure() {
        const eye = map.camera.position
        map.camera.getWorldDirection(direction)
        nearest.copy(eye).addScaledVector(direction, Math.max(0, -eye.dot(direction)))
        maximumMiss = Math.max(maximumMiss, map.projection.groundDistance(nearest))
      }
      map.addEventListener("didrender", measure)
      try {
        for (const sign of [1, -1, 1, -1]) {
          for (let i = 0; i < 34; i++) {
            map.canvas.dispatchEvent(new WheelEvent("wheel", {
              deltaY: sign * 120, clientX: 540, clientY: 465, cancelable: true,
            }))
            await new Promise(resolve => setTimeout(resolve, 14))
          }
          await new Promise(resolve => setTimeout(resolve, 250))
          zooms.push(map.zoomLevel)
        }
      } finally {
        map.removeEventListener("didrender", measure)
      }
      return { maximumMiss, zooms }
    })
    console.log("Off-centre orbit reversals", sweep)
    assert.ok(sweep.maximumMiss < 9000, "The centre ray lost the entire Earth")
    for (const i of [0, 2]) {
      assert.ok(sweep.zooms[i] < 3 && sweep.zooms[i + 1] > 8, "Orbit-to-ground reversal stalled")
    }
    await checkZoomInterruption(page)
    assert.deepEqual(errors, [])
  } finally {await browser.close()}
}
main().catch(reportFailure)
