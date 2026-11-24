// Opt-in reference comparison. Fetch nine native satellite pages per pose,
// render them on the same frozen DEM, and measure only their visible pixels.
// Usage: EARTH_PREVIEW_URL=... node scripts/check-earth-photo-quality.cjs [output-directory]
const assert = require("node:assert/strict")
const fs = require("node:fs/promises")
const path = require("node:path")
const { createRequire } = require("node:module")
const { chromium } = require("playwright")
const {
  installProbe,
  mapboxToken,
  browserErrors,
  previewURL,
  reportFailure,
} = require("./lib/earth-browser.cjs")
const sharp = createRequire(
  require.resolve("gatsby-plugin-sharp/package.json"),
)("sharp")
const landscapePoses = [
  {
    name: "manhattan",
    latitude: 40.7529,
    longitude: -73.9822,
    altitude: 13,
    distance: 560,
    tilt: 75,
    heading: 32,
    reference: [17, 38599, 49258],
  },
  {
    name: "campus",
    latitude: 34.4102,
    longitude: -119.8478,
    altitude: 10,
    distance: 550,
    tilt: 70,
    heading: 320,
    reference: [17, 21898, 52176],
  },
  {
    name: "garibaldi",
    latitude: 49.95,
    longitude: -123.04,
    altitude: 1650,
    distance: 1800,
    tilt: 72,
    heading: 330,
    reference: [16, 10368, 22236],
  },
]

// Close roofs and street markings expose genuine source detail at level 20.
function streetPose(name, latitude, longitude, altitude) {
  const level = 20
  const n = 2 ** level
  const x = (longitude + 180) / 360
  const y = (1 - Math.asinh(Math.tan((latitude * Math.PI) / 180)) / Math.PI) / 2
  return {
    name,
    latitude,
    longitude,
    altitude,
    tilt: 40,
    heading: 20,
    distance: 75,
    reference: [level, Math.floor(x * n) - 1, Math.floor(y * n) - 1],
  }
}
const suites = {
  landscape: landscapePoses,
  street: [
    streetPose("manhattan", 40.751, -73.986, 13),
    streetPose("campus", 34.4111, -119.8474, 10),
    streetPose("utrecht", 52.0917, 5.121, 5),
    streetPose("zurich", 47.376, 8.541, 415),
    streetPose("sydney", -33.868, 151.208, 28),
    streetPose("san-francisco", 37.7857, -122.4167, 32),
  ],
}

// This function runs in the page, after the ordinary streaming workload has settled.
async function prepareReference([level, col, row]) {
  const { map, THREE } = window.probe
  map.lockVisibleTileSet = true
  map.prepareRenderTiles = () => {}
  const atlas = document.createElement("canvas")
  atlas.width = atlas.height = 2048
  const ctx = atlas.getContext("2d")
  const token = new URL(location.href).searchParams.get("mapbox_token")
  await Promise.all(
    Array.from({ length: 9 }, async (_, i) => {
      const x = i % 3,
        y = Math.floor(i / 3)
      const url = new URL(
        `https://api.mapbox.com/v4/mapbox.satellite/${level}/${col + x}/${row + y}@2x.webp`,
      )
      url.searchParams.set("access_token", token)
      const response = await fetch(url)
      if (!response.ok)
        throw Error("Reference image failed: HTTP " + response.status)
      const bitmap = await createImageBitmap(await response.blob())
      ctx.drawImage(bitmap, 512 * x, 512 * y)
      bitmap.close()
    }),
  )
  // A power-of-two atlas preserves trilinear mipmaps on WebGL 1. The source
  // and candidate use the same camera, geometry, filter and pixel grid.
  const texture = new THREE.CanvasTexture(atlas)
  texture.anisotropy = Math.min(8, map.renderer.capabilities.getMaxAnisotropy())
  texture.minFilter = THREE.LinearMipmapLinearFilter
  const terrain = map.visibleTileSet.dataSourceTileList.find(
    e => e.dataSource.name === "terrain",
  )
  const materials = []
  for (const tile of terrain.renderedTiles.values()) {
    const k = tile.tileKey,
      scale = 2 ** (level - k.level)
    for (const mesh of tile.objects) {
      const mat = mesh.material
      if (!mat?.userData?.earthTerrain) continue
      materials.push(mat)
      mat.uniforms.photoReference = { value: texture }
      mat.uniforms.photoMode = { value: 0 }
      mat.uniforms.photoUv = {
        value: new THREE.Vector4(
          scale / 4,
          scale / 4,
          (k.column * scale - col) / 4,
          1 - ((k.row + 1) * scale - row) / 4,
        ),
      }
      const marker = "vec3 radial=normalize(worldKm),normal="
      if (!mat.fragmentShader.includes(marker))
        throw Error("Missing terrain albedo diagnostic insertion point")
      mat.fragmentShader = mat.fragmentShader
        .replace(
          "uniform float overlayMode;",
          "uniform float photoMode; uniform vec4 photoUv; uniform sampler2D photoReference; uniform float overlayMode;",
        )
        .replace(
          marker,
          `
          vec2 photo=tileUv*photoUv.xy+photoUv.zw;
          if(photo.x<.002||photo.x>.748||photo.y<.252||photo.y>.998){gl_FragColor=vec4(0.,0.,0.,1.);return;}
          if(photoMode>1.5){gl_FragColor=vec4(1.,0.,1.,1.);return;}
          gl_FragColor=vec4(photoMode>.5 ? texture2D(photoReference,photo).rgb : pow(albedo,vec3(1./2.2)),1.);return;
          ` + marker,
        )
      mat.needsUpdate = true
    }
  }
  window.setPhotoMode = mode => {
    for (const mat of materials) mat.uniforms.photoMode.value = mode
    const frame = map.frameNumber
    map.update()
    return frame
  }
}

// Non-overlapping 8x8 luminance blocks. Only blocks completely inside the
// reference footprint contribute, excluding silhouettes, page aprons and UI.
async function compare(actual, reference, mask) {
  const [a, b, m] = await Promise.all(
    [actual, reference, mask].map(buffer =>
      sharp(buffer).removeAlpha().raw().toBuffer({ resolveWithObject: true }),
    ),
  )
  const { width, height, channels } = a.info
  assert.equal(channels, 3)
  let blocks = 0,
    structures = 0,
    error = 0
  for (let y = 0; y + 8 <= height; y += 8) {
    for (let x = 0; x + 8 <= width; x += 8) {
      let n = 0,
        sa = 0,
        sb = 0,
        saa = 0,
        sbb = 0,
        sab = 0,
        squared = 0
      for (let j = y; j < y + 8; j++) {
        for (let i = x; i < x + 8; i++) {
          const p = 3 * (j * width + i)
          if (m.data[p] !== 255 || m.data[p + 1] !== 0 || m.data[p + 2] !== 255)
            continue
          const av =
            0.2126 * a.data[p] + 0.7152 * a.data[p + 1] + 0.0722 * a.data[p + 2]
          const bv =
            0.2126 * b.data[p] + 0.7152 * b.data[p + 1] + 0.0722 * b.data[p + 2]
          n++
          sa += av
          sb += bv
          saa += av * av
          sbb += bv * bv
          sab += av * bv
          for (let c = 0; c < 3; c++)
            squared += (a.data[p + c] - b.data[p + c]) ** 2
        }
      }
      if (n !== 64) continue
      const ma = sa / n,
        mb = sb / n,
        c1 = (255 * 0.01) ** 2,
        c2 = (255 * 0.03) ** 2
      structures +=
        ((2 * ma * mb + c1) * (2 * (sab / n - ma * mb) + c2)) /
        ((ma * ma + mb * mb + c1) *
          (saa / n - ma * ma + sbb / n - mb * mb + c2))
      error += squared
      blocks++
    }
  }
  const pixels = 64 * blocks
  assert.ok(
    pixels > 2000,
    "the native reference covered too few visible pixels",
  )
  return {
    pixels,
    ssim: structures / blocks,
    psnr: error ? 10 * Math.log10((255 ** 2 * 3 * pixels) / error) : null,
  }
}

async function main() {
  const suite = process.env.EARTH_PHOTO_SUITE || "landscape"
  const poses = suites[suite]
  assert.ok(poses, "EARTH_PHOTO_SUITE must be landscape or street")
  const memory = Number(process.env.EARTH_PHOTO_MEMORY_GIB || 0)
  const codec = process.env.EARTH_PHOTO_CACHE
  assert.ok(
    !codec || ["off", "auto", "bc7", "etc2"].includes(codec),
    "invalid EARTH_PHOTO_CACHE",
  )
  const out = process.argv[2] && path.resolve(process.argv[2])
  if (out) await fs.mkdir(out, { recursive: true })
  const token = await mapboxToken()
  assert.ok(
    token,
    "provide Mapbox credentials for comparison with native imagery",
  )
  const integrated = process.env.EARTH_PHOTO_GPU === "integrated"
  const browser = await chromium.launch({
    args: integrated
      ? ["--enable-gpu", "--use-angle=gl-egl", "--ignore-gpu-blocklist"]
      : [
          "--enable-gpu",
          "--use-angle=vulkan",
          "--enable-features=Vulkan",
          "--use-vulkan=native",
        ],
  })
  try {
    for (const pose of poses) {
      const page = await browser.newPage({
        viewport: { width: 960, height: 720 },
      })
      const errors = browserErrors(page)
      if (memory > 0) {
        await page.addInitScript(value => {
          Object.defineProperty(navigator, "deviceMemory", { get: () => value })
        }, memory)
      }
      await installProbe(page)
      const url = new URL("/harp/rendering_globe-atmosphere.html", previewURL)
      url.searchParams.set("mapbox_token", token)
      if (codec) url.searchParams.set("texture_cache", codec)
      await page.goto(url.href, { waitUntil: "domcontentloaded" })
      await page.waitForFunction(() => window.probe?.map?.earth)
      await page.evaluate(p => {
        const m = window.probe.map
        m.earth.environment.setClouds(false)
        m.earth.buildings.setEnabled(false)
        m.earth.setSunHour(14)
        m.lookAt({
          target: {
            latitude: p.latitude,
            longitude: p.longitude,
            altitude: p.altitude,
          },
          distance: p.distance,
          tilt: p.tilt,
          heading: p.heading,
        })
        m.update()
      }, pose)
      await page.waitForFunction(
        () => {
          const m = window.probe.map,
            s = m.earth.stats,
            t = m.visibleTileSet.dataSourceTileList.find(
              e => e.dataSource.name === "terrain",
            )
          return (
            t?.allVisibleTileLoaded &&
            s.detailBindings > 0 &&
            !m.cameraIsMoving &&
            !s.fading &&
            !s.pending
          )
        },
        null,
        { timeout: 90000, polling: 150 },
      )
      const stats = await page.evaluate(() => ({
        ...window.probe.map.earth.stats,
      }))
      await page.evaluate(prepareReference, pose.reference)
      const frames = []
      for (const [i, kind] of ["candidate", "reference", "mask"].entries()) {
        const frame = await page.evaluate(i => window.setPhotoMode(i), i)
        await page.waitForFunction(f => window.probe.map.frameNumber > f, frame)
        frames.push(
          await page.screenshot({
            path: out ? path.join(out, `${pose.name}-${kind}.png`) : undefined,
          }),
        )
      }
      assert.deepEqual(errors, [])
      console.log(
        JSON.stringify({
          name: pose.name,
          nativeLevel: pose.reference[0],
          compressedPages: stats.compressedPages,
          meanMissingLevels: stats.meanMissingLevels,
          ...(await compare(...frames)),
          imageryBytes: stats.encodedBytes,
          imageryRequests: stats.requests,
        }),
      )
      await page.close()
    }
  } finally {
    await browser.close()
  }
}
main().catch(reportFailure)
