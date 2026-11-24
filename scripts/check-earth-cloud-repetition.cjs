// Compare translated patches of the actual noise volume and vertical cloud opacity.
// Optional argument: a previous cloud-model.js to evaluate on the same GPU.
const assert = require("node:assert/strict")
const path = require("node:path")
const { chromium, firefox } = require("playwright")
const { load } = require("./lib/earth-source.cjs")
const {
  previewURL,
  mapboxToken,
  installProbe,
  browserErrors,
  reportFailure,
} = require("./lib/earth-browser.cjs")

const fields = [
  // mode 0 is an individual packed-noise channel, 1 a local cloud column,
  // and 2 the automatic regional column with constant geographic coverage.
  {
    name: "noise-detail",
    mode: 0,
    frequency: 0.32,
    latitude: 0,
    longitude: 0,
    channel: 2,
  },
  {
    name: "noise-weather",
    mode: 0,
    frequency: 0.0013,
    latitude: 0,
    longitude: 90,
    channel: 0,
  },
  {
    name: "noise-oblique",
    mode: 0,
    frequency: 0.065,
    latitude: 35,
    longitude: -125,
    channel: 0,
  },
  {
    name: "cirrocumulus",
    mode: 1,
    frequency: 0.24,
    latitude: 0,
    longitude: 0,
    genus: 2,
    base: 8,
    top: 9.4,
    distance: 3,
  },
  {
    name: "stratocumulus",
    mode: 1,
    frequency: 0.095,
    latitude: 0,
    longitude: 0,
    genus: 7,
    base: 0.7,
    top: 2.4,
    distance: 3,
  },
  {
    name: "cumulus",
    mode: 1,
    frequency: 0.035,
    latitude: 0,
    longitude: 90,
    genus: 9,
    base: 0.9,
    top: 4.6,
    distance: 3,
  },
  {
    name: "storm",
    mode: 1,
    frequency: 0.018,
    latitude: 35,
    longitude: -125,
    genus: 10,
    base: 0.8,
    top: 14,
    distance: 19,
  },
  {
    name: "regional",
    mode: 2,
    frequency: 0.01,
    latitude: -30,
    longitude: 13,
    base: 0.35,
    top: 14,
    distance: 480,
  },
  {
    name: "orbital",
    mode: 2,
    frequency: 0.0013,
    latitude: 56,
    longitude: 179.8,
    base: 0.35,
    top: 14,
    distance: 5600,
  },
]

function survey({ noiseGLSL, densityGLSL, fields }) {
  const { THREE, map } = window.probe
  const width = 256,
    pixelsPerPeriod = 32
  const renderer = map.renderer
  const material = new THREE.ShaderMaterial({
    defines: { EARTH_REGIONAL_CLOUDS: 1 },
    uniforms: {
      ...map.earth.environment.uniforms,
      cloudTime: { value: 30 },
      origin: { value: new THREE.Vector3() },
      east: { value: new THREE.Vector3() },
      north: { value: new THREE.Vector3() },
      frequency: { value: 1 },
      thickness: { value: new THREE.Vector2() },
      genus: { value: 0 },
      distanceToEye: { value: 0 },
      mode: { value: 0 },
      channel: { value: new THREE.Vector4() },
    },
    vertexShader:
      "varying vec2 coord;void main(){coord=position.xy;gl_Position=vec4(position.xy,0.,1.);}",
    fragmentShader: `precision highp float;varying vec2 coord;
      const float planetRadius=6378.137,cloudCameraAltitude=480.;
      uniform sampler2D cloudMap;uniform float cloudTime,frequency,genus,distanceToEye;
      uniform int mode;uniform vec2 thickness;uniform vec3 origin,east,north;uniform vec4 channel;
      vec2 earthUv(vec3 p){return vec2(.5);}
      ${noiseGLSL}
      ${densityGLSL}
      void main(){
        vec3 tangent=(east*coord.x+north*coord.y)*4.;
        // Keep the isolated raw field Cartesian for exact axial tile periods.
        if(mode==0){gl_FragColor=vec4(vec3(dot(cloudNoise3(origin*planetRadius*frequency+tangent),channel)),1.);return;}
        float arc=length(tangent)/(frequency*planetRadius);
        vec3 n=cos(arc)*origin+sin(arc)*normalize(tangent);
        vec3 ground=n*planetRadius;float climate=cloudClimate(n);
        float dh=(thickness.y-thickness.x)/32.,tau=0.;
        for(int i=0;i<32;i++){
          float h=thickness.x+(float(i)+.5)*dh;
          vec3 p=ground+n*h*climate;
          float density;
          if(mode==2){
            vec3 advected=ground+cloudWind(0.);
            vec4 weather=cloudNoise3(advected*.0013);
            density=columnDensity(regionalCloudColumn(advected,n,h,.65,weather,distanceToEye),h);
          }else density=cloudGenus(p,h,genus,.83,distanceToEye);
          tau+=density*dh*climate;
        }
        gl_FragColor=vec4(vec3(1.-exp(-tau)),1.);
      }`,
    depthTest: false,
    depthWrite: false,
  })
  const geometry = new THREE.PlaneGeometry(2, 2),
    scene = new THREE.Scene(),
    mesh = new THREE.Mesh(geometry, material)
  mesh.frustumCulled = false
  scene.add(mesh)
  const previous = renderer.getRenderTarget(),
    target = new THREE.WebGLRenderTarget(width, width)
  const pixels = new Uint8Array(width * width * 4),
    result = []
  try {
    renderer.setRenderTarget(target)
    for (const field of fields) {
      const lat = (field.latitude * Math.PI) / 180,
        lon = (field.longitude * Math.PI) / 180
      const u = material.uniforms
      u.origin.value.set(
        Math.cos(lat) * Math.cos(lon),
        Math.cos(lat) * Math.sin(lon),
        Math.sin(lat),
      )
      u.east.value.set(-Math.sin(lon), Math.cos(lon), 0)
      u.north.value.crossVectors(u.origin.value, u.east.value)
      u.frequency.value = field.frequency
      u.mode.value = field.mode
      u.channel.value.set(0, 0, 0, 0).setComponent(field.channel || 0, 1)
      u.thickness.value.set(field.base || 0, field.top || 1)
      u.genus.value = field.genus || 0
      u.distanceToEye.value = field.distance || 0
      renderer.render(scene, map.camera)
      const gl = renderer.getContext()
      if (
        gl.isContextLost() ||
        renderer.info.programs.some(
          p => !gl.getProgramParameter(p.program, gl.LINK_STATUS),
        )
      )
        throw Error("Cloud diagnostic shader failed")
      renderer.readRenderTargetPixels(target, 0, 0, width, width, pixels)
      const values = pixels.filter((_, i) => i % 4 === 0)
      const mean = values.reduce((a, b) => a + b, 0) / values.length
      const deviation = Math.sqrt(
        values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length,
      )
      // Same central patch for all translations. Sweep a disc in 2D so merely
      // rotating a finite tile can still be detected. Never wrap map edges.
      function correlation(dx, dy) {
        let a = 0,
          b = 0,
          aa = 0,
          bb = 0,
          ab = 0,
          n = 0
        for (let y = 66; y < width - 66; y += 4)
          for (let x = 66; x < width - 66; x += 4) {
            const i = y * width + x,
              v = values[i],
              w = values[i + dy * width + dx]
            a += v
            b += w
            aa += v * v
            bb += w * w
            ab += v * w
            n++
          }
        const variance = (n * aa - a * a) * (n * bb - b * b)
        return variance > 0 ? (n * ab - a * b) / Math.sqrt(variance) : 0
      }
      let peak = -1,
        best
      for (let dy = -64; dy <= 64; dy += 2)
        for (let dx = -64; dx <= 64; dx += 2) {
          const lag = Math.hypot(dx, dy) / pixelsPerPeriod
          if (lag < 0.8 || lag > 2.01) continue
          const rho = correlation(dx, dy)
          if (rho > peak) {
            peak = rho
            best = [dx / pixelsPerPeriod, dy / pixelsPerPeriod]
          }
        }
      result.push({
        field: field.name,
        periodKm: 1 / field.frequency,
        mean: mean / 255,
        sd: deviation / 255,
        east: correlation(pixelsPerPeriod, 0),
        north: correlation(0, pixelsPerPeriod),
        peak,
        lag: best,
      })
    }
  } finally {
    renderer.setRenderTarget(previous)
    target.dispose()
    material.dispose()
    geometry.dispose()
  }
  return result
}

async function main() {
  const models = []
  if (process.argv[2])
    models.push(["baseline", require(path.resolve(process.argv[2]))])
  models.push(["current", load("cloud-model.js")])
  const legacy = process.env.EARTH_CLOUD_BROWSER === "firefox-webgl1"
  const browser = legacy
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
    const page = await browser.newPage()
    await installProbe(page)
    const errors = browserErrors(page)
    const url = new URL("/harp/rendering_globe-atmosphere.html", previewURL)
    url.searchParams.set("mapbox_token", await mapboxToken())
    await page.goto(url.href)
    await page.waitForFunction(
      () => window.probe?.map?.earth.environment.status.noiseReady,
    )
    if (legacy)
      assert.equal(
        await page.evaluate(
          () => window.probe.map.renderer.capabilities.isWebGL2,
        ),
        false,
        "Firefox diagnostic must exercise the WebGL 1 path",
      )
    for (const [version, { noiseGLSL, densityGLSL }] of models) {
      const rows = await page.evaluate(survey, {
        noiseGLSL,
        densityGLSL,
        fields,
      })
      console.log(version, JSON.stringify(rows))
      for (const row of rows) {
        const label = version + " " + row.field
        assert.ok(row.sd > 0.012, label + " lost variation")
        if (version === "current")
          assert.ok(row.peak < 0.6, label + " has a strong translated copy")
      }
    }
    assert.deepEqual(errors, [])
  } finally {
    await browser.close()
  }
}
main().catch(reportFailure)
