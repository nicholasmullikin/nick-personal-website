// This runs in the browser so it exercises both the WebGL 1 noise atlas and the
// native WebGL 2 volume. A constant coverage map isolates the old genus-switch
// contour from real geographic cloud boundaries.
function sampleRegionalCloudGradients({ noiseGLSL, densityGLSL }) {
  const { map, THREE } = window.probe
  const renderer = map.renderer
  const coverage = new THREE.DataTexture(
    new Uint8Array([209, 209, 209, 255]),
    1,
    1,
  )
  coverage.needsUpdate = true
  const band = new THREE.Vector2()
  const material = new THREE.ShaderMaterial({
    defines: { EARTH_REGIONAL_CLOUDS: 1 },
    uniforms: {
      cloudNoise: map.earth.environment.uniforms.cloudNoise,
      cloudMap: { value: coverage },
      cloudPreset: { value: 0 },
      cloudTime: { value: 12 },
      band: { value: band },
    },
    depthTest: false,
    depthWrite: false,
    vertexShader: `varying vec2 uvv;
      void main(){uvv=position.xy*.5+.5;gl_Position=vec4(position.xy,0.,1.);}`,
    fragmentShader: `precision highp float;
      varying vec2 uvv;uniform vec2 band;uniform float cloudTime;uniform sampler2D cloudMap;
      const float planetRadius=6378.137,cloudCameraAltitude=480.;
      vec2 earthUv(vec3 p){return vec2(.5);}
      ${noiseGLSL}
      ${densityGLSL}
      void main(){
        vec2 location=band+(.5-uvv)*vec2(.060,.016);
        vec3 n=vec3(cos(location.x)*cos(location.y),cos(location.x)*sin(location.y),sin(location.x));
        vec4 radius=planetRadius+vec4(.92,1.83,4.,8.5)*cloudClimate(n);
        gl_FragColor=.5*vec4(cloudDensity(n*radius.r,480.),cloudDensity(n*radius.g,480.),
                            cloudDensity(n*radius.b,480.),cloudDensity(n*radius.a,480.));
      }`,
  })
  const width = 480
  const height = 128
  const target = new THREE.WebGLRenderTarget(width, height)
  const geometry = new THREE.PlaneGeometry(2, 2)
  const mesh = new THREE.Mesh(geometry, material)
  const scene = new THREE.Scene()
  mesh.frustumCulled = false
  scene.add(mesh)
  const previous = renderer.getRenderTarget()
  const pixels = new Uint8Array(width * height * 4)
  function measure() {
    let gradient = 0,
      cloudyGradient = 0,
      cloudySamples = 0,
      hardEdges = 0
    const samples = height * (width - 2) * 4
    for (let y = 0; y < height; y++) {
      for (let x = 1; x < width - 1; x++) {
        for (let c = 0; c < 4; c++) {
          const i = 4 * (y * width + x) + c
          const left = pixels[i - 4],
            here = pixels[i],
            right = pixels[i + 4]
          const change = Math.abs(right - here)
          gradient += change
          // Three quantization levels distinguish a resolved cloud or its rim
          // from empty air across the four sampled height bands.
          if (Math.max(left, here, right) >= 3) {
            cloudyGradient += change
            cloudySamples++
          }
          if (Math.abs(right + left - 2 * here) > 80) hardEdges++
        }
      }
    }
    return {
      meanGradient: gradient / samples,
      cloudyFraction: cloudySamples / samples,
      cloudyGradient: cloudyGradient / Math.max(1, cloudySamples),
      hardEdges: hardEdges / samples,
    }
  }
  const regions = []
  try {
    renderer.setRenderTarget(target)
    for (const [lat, lon] of [
      [40, -80],
      [40, 155],
      [56, 179.8],
      [-30, 13],
    ]) {
      band.set((lat * Math.PI) / 180, (lon * Math.PI) / 180)
      renderer.render(scene, map.camera)
      renderer.readRenderTargetPixels(target, 0, 0, width, height, pixels)
      regions.push({ lat, lon, ...measure() })
    }
    pixels.fill(128)
    return { regions, flat: measure() }
  } finally {
    renderer.setRenderTarget(previous)
    target.dispose()
    coverage.dispose()
    geometry.dispose()
    material.dispose()
  }
}
module.exports = { sampleRegionalCloudGradients }

// Integrate the same columns at three viewing distances. Equal-area sampling
// gives the polar caps their true weight in the geographic comparison.
function sampleCloudDescent({ noiseGLSL, densityGLSL }) {
  const { map, THREE } = window.probe
  const renderer = map.renderer
  const material = new THREE.ShaderMaterial({
    uniforms: {
      ...map.earth.environment.uniforms,
      cloudPreset: { value: 0 },
      cloudTime: { value: 30 },
      distanceToEye: { value: 0 },
    },
    vertexShader: `varying vec2 location;
      void main(){location=position.xy;gl_Position=vec4(position.xy,0.,1.);}`,
    fragmentShader: `precision highp float; varying vec2 location;
      const float planetRadius=6378.137,cloudCameraAltitude=480.;
      uniform sampler2D cloudMap; uniform float cloudTime,distanceToEye;
      vec2 earthUv(vec3 p){vec3 n=normalize(p);return vec2(atan(n.y,n.x)/6.2831853+.5,asin(clamp(n.z,-1.,1.))/3.14159265+.5);}
      ${noiseGLSL}
      ${densityGLSL}
      void main(){
        float lon=location.x*3.14159265,z=location.y,r=sqrt(1.-z*z);
        vec3 n=vec3(r*cos(lon),r*sin(lon),z);
        float stepKm=(14.-.35)/40.*cloudClimate(n),tau=0.;
        for(int i=0;i<40;i++){
          vec3 p=n*(planetRadius+.35*cloudClimate(n)+(float(i)+.5)*stepKm);
          tau+=cloudDensity(p,distanceToEye)*stepKm;
        }
        gl_FragColor=vec4(vec3(1.-exp(-tau)),1.);
      }`,
  })
  const size = 128
  const target = new THREE.WebGLRenderTarget(size, size)
  const geometry = new THREE.PlaneGeometry(2, 2)
  const scene = new THREE.Scene()
  const quad = new THREE.Mesh(geometry, material)
  quad.frustumCulled = false
  scene.add(quad)
  const previous = renderer.getRenderTarget()
  try {
    renderer.setRenderTarget(target)
    const fields = [0, 800, 16000].map(distance => {
      material.uniforms.distanceToEye.value = distance
      renderer.render(scene, map.camera)
      const pixels = new Uint8Array(size * size * 4)
      renderer.readRenderTargetPixels(target, 0, 0, size, size, pixels)
      return pixels.filter((_, i) => i % 4 === 0)
    })
    const mean = field => field.reduce((sum, x) => sum + x, 0) / field.length
    const near = fields[0]
    const nearMean = mean(near)
    return fields.slice(1).map(field => {
      const farMean = mean(field)
      let cross = 0,
        nearVariance = 0,
        farVariance = 0
      for (let i = 0; i < field.length; i++) {
        const a = near[i] - nearMean,
          b = field[i] - farMean
        cross += a * b
        nearVariance += a * a
        farVariance += b * b
      }
      return {
        correlation: cross / Math.sqrt(nearVariance * farVariance),
        opacityChange: (farMean - nearMean) / 255,
      }
    })
  } finally {
    renderer.setRenderTarget(previous)
    geometry.dispose()
    material.dispose()
    target.dispose()
  }
}
module.exports.sampleCloudDescent = sampleCloudDescent

// Moving the viewport by whole pixels sends the same rays through the cloud at
// different framebuffer coordinates. Their integrated opacity should agree.
async function measureCloudPan() {
  const { map, THREE } = window.probe
  const renderer = map.renderer
  const original = renderer.render
  const width = 320,
    height = 192,
    shift = 3
  const target = new THREE.WebGLRenderTarget(width, height)
  let timer
  try {
    return await new Promise((resolve, reject) => {
      timer = setTimeout(
        () => reject(Error("No regional cloud draw during pan check")),
        10000,
      )
      renderer.render = function (scene, camera) {
        if (scene.userData.earthPass !== "cloudVolume")
          return original.call(this, scene, camera)
        renderer.render = original
        const previous = renderer.getRenderTarget()
        try {
          const images = [0, shift].map(x => {
            // Target viewports are physical pixels; renderer.setViewport would
            // scale the shift again by the adaptive canvas pixel ratio.
            target.viewport.set(x, 0, width, height)
            renderer.setRenderTarget(target)
            renderer.clear()
            original.call(renderer, scene, camera)
            const pixels = new Uint8Array(width * height * 4)
            renderer.readRenderTargetPixels(target, 0, 0, width, height, pixels)
            return pixels
          })
          let squaredError = 0,
            samples = 0
          for (let y = 2; y < height - 2; y++) {
            for (let x = 2; x < width - shift - 2; x++) {
              const alpha = (y * width + x) * 4 + 3
              const a = images[0][alpha],
                b = images[1][alpha + 4 * shift]
              if (Math.max(a, b) < 12) continue
              squaredError += (a - b) ** 2
              samples++
            }
          }
          resolve({ samples, rms: Math.sqrt(squaredError / samples) })
        } catch (error) {
          reject(error)
        } finally {
          renderer.setRenderTarget(previous)
        }
        return original.call(renderer, scene, camera)
      }
      map.earth.environment.setCloudPreset(0)
      map.lookAt({
        target: { latitude: 49.25, longitude: -37, altitude: 0 },
        distance: 1100000,
        tilt: 8,
        heading: 15,
      })
      map.update()
    })
  } finally {
    clearTimeout(timer)
    renderer.render = original
    target.dispose()
  }
}
module.exports.measureCloudPan = measureCloudPan
