// Replays identical camera paths through the interactive Earth renderer.
const { chromium, firefox } = require("playwright")
const fs = require("node:fs/promises")
const path = require("node:path")
const {
  installProbe,
  mapboxToken,
  browserErrors,
  reportFailure,
} = require("./lib/earth-browser.cjs")
const scenarios = {
  lagoon: [34.4092, -119.8453, 1, 260, 78, 325, 15.4],
  coast: [34.4050363, -119.8439841, 4.8, 449, 79.2, -39.88, 16.6],
  lake: [47.3602, 8.546, 406, 560, 80, 55, 5.2],
  ocean: [0, -140, 0, 650, 68, 248, 18.2],
  moon: [0, -140, 0, 650, 72, 274, 3],
  cloud: [0, -140, 0, 440, 83, 249, 18.8],
  waterfront: [47.36555, 8.5426, 406, 120, 82, 26, 5.5],
  inlet: [34.40845, -119.8461, 1, 90, 81, 12, 15.5],
  dusk: [47.3602, 8.546, 406, 560, 80, 55, 7.75],
  sunset: [0, -140, 0, 650, 81, 249, 19.1],
  alpine: [47.1211, 9.2114, 419, 480, 82, 346, 4.8],
  cloudbank: [0, -140, 0, 420, 84, 31, 16.2],
  rainsea: [0, -140, 0, 360, 82, 249, 18.6],
  ridge: [47.1211, 9.2114, 419, 480, 82, 211, 7.6],
  fairsea: [0, -140, 0, 360, 82, 249, 18.6],
  overcast: [47.36555, 8.5426, 406, 120, 82, 26, 5.5],
  quay: [47.36555, 8.5426, 406, 120, 82, 26, 9.2],
  down: [34.4092, -119.8453, 1, 430, 10, 282, 14],
  dry: [35.55, -116.35, 430, 650, 65, 40, 14],
  orbit: [0, -140, 0, 3200000, 24, 260, 18.2],
}
async function captureStill(page, filename) {
  let image
  try {
    image = await page.screenshot({ type: "jpeg", quality: 88 })
  } catch (error) {
    if (!String(error).includes("Unable to capture screenshot")) throw error
    // Capture the rendered drawing buffer before the compositor discards it.
    // This fallback omits the HTML controls but preserves native resolution.
    const data = await page.evaluate(async () => {
      const map = window.probe.map
      if (map.renderer.getContext().isContextLost())
        throw Error("WebGL context lost during screenshot")
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          map.removeEventListener("didrender", painted)
          reject(new Error("No rendered frame available for capture"))
        }, 10000)
        const painted = () => {
          clearTimeout(timeout)
          map.removeEventListener("didrender", painted)
          try {
            resolve(map.canvas.toDataURL("image/jpeg", 0.88))
          } catch (error) {
            reject(error)
          }
        }
        map.addEventListener("didrender", painted)
        map.update()
      })
    })
    if (!data.startsWith("data:image/jpeg;base64,")) throw error
    image = Buffer.from(data.split(",")[1], "base64")
  }
  const pending = filename + ".tmp"
  await fs.writeFile(pending, image)
  await fs.rename(pending, filename)
}
async function launchBrowser(browserName) {
  return browserName.startsWith("firefox")
    ? await firefox.launch({
        firefoxUserPrefs:
          browserName === "firefox1" ? { "webgl.enable-webgl2": false } : {},
      })
    : await chromium.launch({
        args:
          browserName === "egl"
            ? ["--enable-gpu", "--use-angle=gl-egl", "--ignore-gpu-blocklist"]
            : [
                "--enable-gpu",
                "--use-angle=vulkan",
                "--enable-features=Vulkan",
                "--use-vulkan=native",
              ],
      })
}

async function capture(browser, args, visual) {
  const [
    dir,
    model = "baseline",
    browserName = "chromium",
    resolution = "960x620",
    cases = Object.keys(scenarios).join(","),
    wind = "breezy",
  ] = args
  const [width, height] = resolution.split("x").map(Number)
  await fs.mkdir(dir, { recursive: true })
  const startedMs = Date.now()
  const page = await browser.newPage({ viewport: { width, height } })
  try {
    await page.clock.setFixedTime(new Date("2026-11-20T12:00:00Z"))
    const errors = browserErrors(page)
    await installProbe(page)
    const url = new URL(
      "/harp/rendering_globe-atmosphere.html",
      process.env.EARTH_PREVIEW_URL || "http://127.0.0.1:8014",
    )
    url.searchParams.set("reflection", model)
    url.searchParams.set("wind", wind)
    const glint = visual?.glint || process.env.EARTH_GLINT
    if (glint) url.searchParams.set("glint", glint)
    url.searchParams.set("mapbox_token", await mapboxToken())
    await page.goto(url.href, { waitUntil: "domcontentloaded" })
    await page.waitForFunction(() => window.probe?.map?.earth)
    // One fixed instant for A/B stills, followed by the same wave and cloud
    // phase at each camera position when a motion sequence is requested.
    await page.evaluate(() => {
      window.waterTestTime = 30
      Object.defineProperty(
        window.probe.map.earth.environment.uniforms.cloudTime,
        "value",
        {
          get: () => window.waterTestTime,
          set: () => {},
        },
      )
    })
    if (visual?.largeShore) {
      await page.evaluate(() => {
        const renderer = window.probe.map.renderer
        const original = renderer.setRenderTarget.bind(renderer)
        renderer.setRenderTarget = (target, ...rest) => {
          if (
            target?.width === 512 &&
            target.height === 320 &&
            target.depthBuffer
          ) {
            target.setSize(1024, 640)
            window.largeShoreTestActive = true
          }
          return original(target, ...rest)
        }
      })
    }
    if (process.env.EARTH_WATER_DIAGNOSTICS)
      await page.evaluate(() => {
        const { map } = window.probe,
          r = map.renderer,
          render = r.render
        r.render = function (scene, cam) {
          const out = render.call(r, scene, cam)
          if (scene.userData.earthPass === "waterClouds") {
            const rt = r.getRenderTarget(),
              data = new Uint8Array(rt.width * rt.height * 4)
            r.readRenderTargetPixels(rt, 0, 0, rt.width, rt.height, data)
            const u = scene.children[0].material.uniforms,
              sun = u.sunDirection.value
            const az = Math.atan2(
              sun.dot(u.waterNorth.value),
              sun.dot(u.waterEast.value),
            )
            const x = Math.min(
              rt.width - 1,
              Math.max(0, Math.floor((az / (2 * Math.PI) + 0.5) * rt.width)),
            )
            const y = Math.min(
              rt.height - 1,
              Math.floor(
                Math.sqrt(Math.max(0, sun.dot(u.waterUp.value))) * rt.height,
              ),
            )
            const alpha = data.filter((_, i) => i % 4 === 3)
            window.waterCloudAudit = {
              sunXY: [x, y],
              sunOpacity: alpha[y * rt.width + x] / 255,
              meanOpacity:
                alpha.reduce((a, b) => a + b, 0) / alpha.length / 255,
              peak: Math.max(...alpha),
              preset: u.cloudPreset.value,
              originRadius: u.origin.value.length(),
              bounds: u.bounds.value.toArray(),
            }
          }
          return out
        }
      })
    for (const name of cases.split(",")) {
      const pose = [...scenarios[name]]
      pose[5] += visual?.headingOffset || 0
      await page.evaluate(
        ({ pose, name }) => {
          const [latitude, longitude, altitude, distance, tilt, heading, hour] =
            pose
          const map = window.probe.map,
            earth = map.earth
          window.waterTestTime = 30
          earth.setSunHour(hour)
          earth.environment.setClouds(
            ["cloud", "cloudbank", "overcast", "rainsea"].includes(name),
          )
          if (["cloud", "cloudbank"].includes(name))
            earth.environment.setCloudPreset(9)
          if (["overcast", "rainsea"].includes(name))
            earth.environment.setCloudPreset(6)
          map.lookAt({
            target: { latitude, longitude, altitude },
            distance,
            tilt,
            heading,
          })
          map.update()
        },
        { pose, name },
      )
      await page.waitForTimeout(2000)
      const settled = await page
        .waitForFunction(
          () => {
            const m = window.probe.map,
              s = m.earth.stats
            return (
              s.cache &&
              !s.fading &&
              !s.pending &&
              m.visibleTileSet.dataSourceTileList.find(
                e => e.dataSource.name === "terrain",
              )?.allVisibleTileLoaded
            )
          },
          null,
          { timeout: 30000 },
        )
        .then(
          () => true,
          () => false,
        )
      if (visual) {
        const info = await page.evaluate(() => {
          const map = window.probe.map,
            gl = map.renderer.getContext()
          return {
            size: [gl.drawingBufferWidth, gl.drawingBufferHeight],
            linked:
              !gl.isContextLost() &&
              map.renderer.info.programs.every(p =>
                gl.getProgramParameter(p.program, gl.LINK_STATUS),
              ),
            largeShore: !!window.largeShoreTestActive,
            bundle: Array.from(document.scripts)
              .map(s => s.src.split("/").pop())
              .find(s => s.startsWith("rendering_globe-atmosphere_bundle")),
          }
        })
        if (
          !settled ||
          !info.linked ||
          errors.length ||
          (visual.largeShore && !info.largeShore)
        ) {
          throw Error(
            "Visual validation failed for " +
              name +
              ": " +
              JSON.stringify({ settled, info, errors }),
          )
        }
        await captureStill(page, path.join(dir, name + ".jpg"))
        await fs.writeFile(
          path.join(dir, name + ".json"),
          JSON.stringify({
            pose,
            model,
            wind,
            glint,
            startedMs,
            finishedMs: Date.now(),
            ...info,
          }),
        )
        continue
      }
      const stats = await page.evaluate(
        async ({ pose, moving }) => {
          const map = window.probe.map,
            profiler = map.earth.performance,
            frames = []
          profiler.reset()
          const start = performance.now()
          let last = start
          await new Promise(resolve => {
            function step() {
              const now = performance.now()
              frames.push(now - last)
              last = now
              if (moving && frames.length < 180) {
                const [latitude, longitude, altitude, distance, tilt, heading] =
                  pose
                const t = frames.length / 180
                map.lookAt({
                  target: { latitude, longitude, altitude },
                  distance,
                  tilt,
                  heading: heading + 12 * Math.sin(2 * Math.PI * t),
                })
                window.waterTestTime = 30 + 4 * t
              }
              if (
                frames.length >= (moving ? 180 : 125) ||
                now - start > 18000
              ) {
                map.removeEventListener("didrender", step)
                resolve()
              } else requestAnimationFrame(() => map.update())
            }
            map.addEventListener("didrender", step)
            map.update()
          })
          const gl = map.renderer.getContext(),
            ext = gl.getExtension("WEBGL_debug_renderer_info")
          frames.sort((a, b) => a - b)
          const failedPrograms = (map.renderer.info.programs || [])
            .filter(p => !gl.getProgramParameter(p.program, gl.LINK_STATUS))
            .map(p =>
              [
                gl.getProgramInfoLog(p.program),
                ...gl
                  .getAttachedShaders(p.program)
                  .map(s => gl.getShaderInfoLog(s)),
              ].join(" "),
            )
          return {
            failedPrograms,
            cloudAudit: window.waterCloudAudit,
            size: [gl.drawingBufferWidth, gl.drawingBufferHeight],
            renderer: ext && gl.getParameter(ext.UNMASKED_RENDERER_WEBGL),
            gpu: profiler.snapshot().gpu,
            cpu: profiler.snapshot().cpu.frame,
            wallP95: frames[Math.floor(0.95 * frames.length)],
            build: Array.from(document.scripts)
              .map(s => s.src.split("/").pop())
              .find(s => s.startsWith("rendering_globe-atmosphere_bundle")),
            reflections: map.earth.reflectionStats,
            water: map.earth.water.stats,
            oceanTiles: map.earth.stats.oceanTiles,
          }
        },
        { pose, moving: !!process.env.EARTH_WATER_MOTION },
      )
      const stem = path.join(
        dir,
        [browserName, resolution, model, wind, name].join("-"),
      )
      await captureStill(page, stem + ".jpg")
      await fs.writeFile(
        stem + ".json",
        JSON.stringify(
          {
            model,
            wind,
            name,
            pose,
            moving: !!process.env.EARTH_WATER_MOTION,
            settled,
            stats,
            errors,
          },
          null,
          2,
        ),
      )
      if (errors.length || stats.failedPrograms.length)
        throw Error([...errors, ...stats.failedPrograms].join("\n"))
      if (
        process.env.EARTH_WATER_DIAGNOSTICS &&
        name === "rainsea" &&
        !(stats.cloudAudit?.sunOpacity > 0.8)
      )
        throw Error("Overcast cloud deck failed to occlude the solar disk")
      if (process.env.EARTH_WATER_ABLATE && stats.reflections?.shore?.draws) {
        await page.evaluate(() => {
          const m = window.probe.map
          window.waterResume = m.prepareRenderTiles
          m.prepareRenderTiles = () => {}
          const entry = m.visibleTileSet.dataSourceTileList.find(
            e => e.dataSource.name === "terrain",
          )
          window.waterMaterials = [
            ...new Set(
              [...entry.renderedTiles.values()]
                .flatMap(t => t.objects.map(o => o.material))
                .filter(mat => mat?.defines?.EARTH_MAPPED_WATER),
            ),
          ]
        })
        for (const part of ["complete", "no-shore", "coverage"]) {
          await page.evaluate(async part => {
            const m = window.probe.map
            for (const mat of window.waterMaterials) {
              mat.uniforms.waterSceneReady.value = part === "no-shore" ? 0 : 1
              if (part === "coverage") {
                mat.defines.EARTH_WATER_DEBUG = 1
                mat.needsUpdate = true
              }
            }
            const painted = new Promise(done => {
              const once = () => {
                m.removeEventListener("didrender", once)
                done()
              }
              m.addEventListener("didrender", once)
            })
            m.update()
            await painted
          }, part)
          await page.screenshot({ path: stem + "-" + part + ".png" })
        }
        await page.evaluate(() => {
          for (const mat of window.waterMaterials) {
            delete mat.defines.EARTH_WATER_DEBUG
            mat.needsUpdate = true
          }
          window.probe.map.prepareRenderTiles = window.waterResume
          window.probe.map.update()
        })
      }
      if (process.env.EARTH_WATER_FRAMES) {
        const count = Number(process.env.EARTH_WATER_FRAMES)
        const framesDir = stem + "-frames"
        await fs.mkdir(framesDir, { recursive: true })
        for (let i = 0; i < count; i++) {
          await page.evaluate(
            ({ pose, t }) => {
              const [latitude, longitude, altitude, distance, tilt, heading] =
                pose
              window.waterTestTime = 30 + t * 5
              window.probe.map.lookAt({
                target: { latitude, longitude, altitude },
                distance: distance * (1 - 0.12 * Math.sin(Math.PI * t)),
                tilt,
                heading: heading + 20 * Math.sin(2 * Math.PI * t),
              })
              window.probe.map.update()
            },
            { pose, t: i / (count - 1) },
          )
          await page.waitForTimeout(80)
          await page.screenshot({
            path: path.join(framesDir, String(i).padStart(4, "0") + ".jpg"),
            quality: 85,
          })
        }
      }
      console.log(
        model,
        name,
        stats.size,
        stats.oceanTiles,
        stats.water.tiles,
        stats.gpu.frame?.p95,
      )
    }
  } finally {
    await page.close()
  }
}

async function main() {
  const args = process.argv.slice(2)
  const visual = args[0] === "--visual-batch"
  const browser = await launchBrowser(
    visual ? "chromium" : args[2] || "chromium",
  )
  try {
    if (!visual) return await capture(browser, args)
    const [, dir, input, workers] = args
    const queue = JSON.parse(await fs.readFile(input, "utf8"))
    const errors = []
    async function worker() {
      while (queue.length) {
        const trial = queue.shift()
        try {
          await capture(
            browser,
            [dir, trial.model, "chromium", "800x500", trial.scene, trial.wind],
            trial,
          )
        } catch (error) {
          errors.push(trial.scene + ": " + error.message)
        }
      }
    }
    await Promise.all(Array.from({ length: Number(workers) }, worker))
    if (errors.length) throw Error(errors.join("\n"))
  } finally {
    await browser.close()
  }
}
main().catch(reportFailure)
