// Compare the PNG and lossless WebP through the actual WebGL upload path, then
// exercise the PNG fallback when WebP cannot be fetched or decoded.
const assert = require("node:assert/strict")
const { chromium, firefox } = require("playwright")
const {
  previewURL,
  mapboxToken,
  installProbe,
  browserErrors,
  reportFailure,
} = require("./lib/earth-browser.cjs")
async function main() {
  for (const [name, engine, options] of [
    [
      "chromium",
      chromium,
      process.env.EARTH_GPU_VULKAN
        ? {
            args: [
              "--enable-gpu",
              "--use-angle=vulkan",
              "--enable-features=Vulkan",
              "--use-vulkan=native",
            ],
          }
        : {},
    ],
    [
      "firefox-webgl1",
      firefox,
      { firefoxUserPrefs: { "webgl.enable-webgl2": false } },
    ],
  ]) {
    const browser = await engine.launch(options)
    try {
      const page = await browser.newPage()
      await page.goto(previewURL + "/harp/earth-background.html")
      const result = await page.evaluate(async () => {
        const gl = document.createElement("canvas").getContext("webgl")
        const target = gl.createTexture()
        gl.bindTexture(gl.TEXTURE_2D, target)
        gl.texImage2D(
          gl.TEXTURE_2D,
          0,
          gl.RGBA,
          528,
          528,
          0,
          gl.RGBA,
          gl.UNSIGNED_BYTE,
          null,
        )
        const fbo = gl.createFramebuffer()
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbo)
        gl.framebufferTexture2D(
          gl.FRAMEBUFFER,
          gl.COLOR_ATTACHMENT0,
          gl.TEXTURE_2D,
          target,
          0,
        )
        gl.viewport(0, 0, 528, 528)
        const program = gl.createProgram()
        for (const [type, source] of [
          [
            gl.VERTEX_SHADER,
            "attribute vec2 p;varying vec2 uv;void main(){uv=p*.5+.5;gl_Position=vec4(p,0.,1.);}",
          ],
          [
            gl.FRAGMENT_SHADER,
            "precision highp float;varying vec2 uv;uniform sampler2D tex;void main(){gl_FragColor=texture2D(tex,uv);}",
          ],
        ]) {
          const shader = gl.createShader(type)
          gl.shaderSource(shader, source)
          gl.compileShader(shader)
          if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS))
            throw Error(gl.getShaderInfoLog(shader))
          gl.attachShader(program, shader)
        }
        gl.linkProgram(program)
        gl.useProgram(program)
        const buffer = gl.createBuffer()
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
        gl.bufferData(
          gl.ARRAY_BUFFER,
          new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
          gl.STATIC_DRAW,
        )
        const position = gl.getAttribLocation(program, "p")
        gl.enableVertexAttribArray(position)
        gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0)
        const samples = []
        for (const file of ["cloud-noise.png", "cloud-noise.webp"]) {
          const image = new Image()
          image.src = "resources/earth/" + file
          await image.decode()
          const texture = gl.createTexture()
          gl.bindTexture(gl.TEXTURE_2D, texture)
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
          gl.texImage2D(
            gl.TEXTURE_2D,
            0,
            gl.RGBA,
            gl.RGBA,
            gl.UNSIGNED_BYTE,
            image,
          )
          gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
          const bytes = new Uint8Array(528 * 528 * 4)
          gl.readPixels(0, 0, 528, 528, gl.RGBA, gl.UNSIGNED_BYTE, bytes)
          samples.push(bytes)
          gl.deleteTexture(texture)
        }
        let different = 0
        for (let i = 0; i < samples[0].length; i++)
          if (samples[0][i] !== samples[1][i]) different++
        return { different, error: gl.getError() }
      })
      assert.deepEqual(
        result,
        { different: 0, error: 0 },
        `${name}: GPU atlas must match PNG`,
      )
      await page.close()
      for (const failure of ["network", "decode"]) {
        const fallback = await browser.newPage()
        const errors = browserErrors(fallback)
        let pngRequests = 0
        await installProbe(fallback)
        await fallback.route("**/cloud-noise.webp", route =>
          failure === "network"
            ? route.abort()
            : route.fulfill({ body: "bad image" }),
        )
        fallback.on("request", req => {
          if (req.url().includes("cloud-noise.png")) pngRequests++
        })
        const url = new URL("/harp/rendering_globe-atmosphere.html", previewURL)
        url.searchParams.set("mapbox_token", await mapboxToken())
        await fallback.goto(url.href)
        await fallback.waitForFunction(
          () => window.probe?.map.earth.environment.status.noiseReady,
        )
        assert.equal(
          pngRequests,
          1,
          `${name}: one PNG fallback after ${failure} failure`,
        )
        assert.deepEqual(errors, [])
        await fallback.close()
      }
      console.log(name, "GPU atlas matches and PNG fallback passed")
    } finally {
      await browser.close()
    }
  }
}
main().catch(reportFailure)
