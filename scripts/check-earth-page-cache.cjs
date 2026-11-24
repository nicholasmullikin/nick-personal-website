// Validate the staged worker, native GPU mip uploads and the north-up Canvas2D
// image used in terrain fades. This check needs no satellite credentials.
const assert = require("node:assert/strict")
const fs = require("node:fs/promises")
const path = require("node:path")
const { chromium, firefox } = require("playwright")
const { source } = require("./lib/earth-source.cjs")
const { previewURL, reportFailure } = require("./lib/earth-browser.cjs")

async function run(engine, label, options) {
  const browser = await engine.launch(options)
  try {
    const page = await browser.newPage()
    await page.goto(new URL("/harp/earth-build.json", previewURL).href)
    const snapshot = await fs.readFile(
      path.join(source, "page-snapshot.js"),
      "utf8",
    )
    await page.addScriptTag({
      content:
        "{const module={};" +
        snapshot +
        ";window.drawPage=module.exports.drawCompressed;}",
    })
    const results = await page.evaluate(async () => {
      const size = 256
      const canvas = document.createElement("canvas")
      canvas.width = canvas.height = size
      const gl = canvas.getContext("webgl2") || canvas.getContext("webgl")
      if (!gl) throw Error("GL unavailable")
      const program = gl.createProgram()
      function attach(type, source) {
        const shader = gl.createShader(type)
        gl.shaderSource(shader, source)
        gl.compileShader(shader)
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS))
          throw Error(gl.getShaderInfoLog(shader))
        gl.attachShader(program, shader)
      }
      attach(
        gl.VERTEX_SHADER,
        "attribute vec2 p;varying vec2 uv;void main(){uv=(p+1.)*.5;gl_Position=vec4(p,0.,1.);}",
      )
      attach(
        gl.FRAGMENT_SHADER,
        "precision highp float;uniform sampler2D tex;varying vec2 uv;void main(){gl_FragColor=texture2D(tex,uv);}",
      )
      gl.linkProgram(program)
      if (!gl.getProgramParameter(program, gl.LINK_STATUS))
        throw Error(gl.getProgramInfoLog(program))
      gl.useProgram(program)
      const vertices = gl.createBuffer()
      gl.bindBuffer(gl.ARRAY_BUFFER, vertices)
      gl.bufferData(
        gl.ARRAY_BUFFER,
        new Float32Array([-1, -1, 3, -1, -1, 3]),
        gl.STATIC_DRAW,
      )
      const pos = gl.getAttribLocation(program, "p")
      gl.vertexAttribPointer(pos, 2, gl.FLOAT, false, 0, 0)
      gl.enableVertexAttribArray(pos)
      const original = new OffscreenCanvas(size, size)
      const g = original.getContext("2d"),
        image = g.createImageData(size, size)
      for (let y = 0; y < size; y++)
        for (let x = 0; x < size; x++) {
          const i = (y * size + x) * 4,
            stripes = (x >> 3) ^ (y >> 4)
          image.data[i] = 29 + 0.55 * x + (stripes & 1) * 18
          image.data[i + 1] = 25 + 0.69 * y
          image.data[i + 2] = 34 + 0.3 * x + 0.15 * y
          image.data[i + 3] = 255
        }
      g.putImageData(image, 0, 0)
      const blob = await original.convertToBlob({ type: "image/png" })
      const output = []
      for (const [codec, extension, constant, blockBytes] of [
        [
          "bc7",
          "EXT_texture_compression_bptc",
          "COMPRESSED_RGBA_BPTC_UNORM_EXT",
          16,
        ],
        ["etc2", "WEBGL_compressed_texture_etc", "COMPRESSED_RGB8_ETC2", 8],
      ]) {
        const ext = gl.getExtension(extension)
        if (!ext) continue
        const worker = new Worker("earth-bc7.bundle.js")
        function encode(id, blob) {
          return new Promise((resolve, reject) => {
            const timeout = setTimeout(
              () => reject(Error("worker timed out")),
              10000,
            )
            worker.onerror = event => {
              clearTimeout(timeout)
              reject(Error(event.message))
            }
            worker.onmessage = ({ data }) => {
              clearTimeout(timeout)
              data.error
                ? reject(Error("worker encode failed"))
                : resolve(data.result)
            }
            worker.postMessage({ id, codec, blob })
          })
        }
        try {
          const result = await encode(1, blob)
          if (!result?.bytes) throw Error(codec + " missing encoded page")
          const texture = gl.createTexture()
          gl.bindTexture(gl.TEXTURE_2D, texture)
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
          gl.texParameteri(
            gl.TEXTURE_2D,
            gl.TEXTURE_MIN_FILTER,
            gl.NEAREST_MIPMAP_NEAREST,
          )
          const page = {
            id: output.length + 1,
            userData: { pageCodec: codec },
            mipmaps: [],
          }
          let offset = 0
          for (
            let width = size, z = 0;
            width >= 1;
            width = Math.floor(width / 2), z++
          ) {
            const length = blockBytes * Math.ceil(width / 4) ** 2,
              data = result.bytes.subarray(offset, offset + length)
            offset += length
            page.mipmaps.push({ width, height: width, data })
            gl.compressedTexImage2D(
              gl.TEXTURE_2D,
              z,
              ext[constant],
              width,
              width,
              0,
              data,
            )
          }
          if (offset !== result.bytes.byteLength || gl.getError())
            throw Error(codec + " mip upload failed")
          let worstSnapshot = 0,
            squared = 0
          for (const { width } of page.mipmaps) {
            gl.viewport(0, 0, width, width)
            gl.drawArrays(gl.TRIANGLES, 0, 3)
            const pixels = new Uint8Array(width * width * 4)
            gl.readPixels(0, 0, width, width, gl.RGBA, gl.UNSIGNED_BYTE, pixels)
            const snap = new OffscreenCanvas(width, width).getContext("2d")
            window.drawPage(snap, page, 0, 0, size, size, 0, 0, width, width)
            const compare = snap.getImageData(0, 0, width, width).data
            for (let y = 0; y < width; y++)
              for (let x = 0; x < width; x++)
                for (let c = 0; c < 4; c++) {
                  const i = (y * width + x) * 4 + c,
                    actual = pixels[((width - y - 1) * width + x) * 4 + c]
                  worstSnapshot = Math.max(
                    worstSnapshot,
                    Math.abs(actual - compare[i]),
                  )
                  if (width === size && c < 3)
                    squared += (actual - image.data[i]) ** 2
                }
          }
          gl.deleteTexture(texture)
          // Transparent content must transfer its original pixels. A new job
          // also proves the worker is reusable after its first mip chain.
          g.clearRect(0, 0, 20, 30)
          const fallback = await encode(
            2,
            await original.convertToBlob({ type: "image/png" }),
          )
          if (!fallback?.image) throw Error(codec + " lost transparent source")
          fallback.image.close()
          g.putImageData(image, 0, 0)
          output.push({
            codec,
            worstSnapshot,
            psnr: 10 * Math.log10((255 ** 2 * 3 * size ** 2) / squared),
            bytes: offset,
            glError: gl.getError(),
          })
        } finally {
          worker.terminate()
        }
      }
      return output
    })
    assert.ok(results.length > 0, label + " exposes no testable codec")
    for (const item of results) {
      console.log(JSON.stringify({ label, ...item }))
      assert.equal(item.glError, 0)
      assert.ok(item.worstSnapshot <= 1, "Canvas fade and GPU source diverged")
      assert.ok(item.psnr > 39, "source color or orientation diverged")
    }
  } finally {
    await browser.close()
  }
}
async function main() {
  const kind = process.env.EARTH_CACHE_BROWSER
  if (kind === "integrated")
    return run(chromium, "native-integrated", {
      args: [
        "--ozone-platform=x11",
        "--enable-gpu",
        "--use-angle=gl-egl",
        "--ignore-gpu-blocklist",
      ],
    })
  if (kind !== "firefox")
    await run(chromium, "chromium", {
      args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
    })
  if (kind !== "chromium")
    await run(firefox, "firefox-webgl1", {
      firefoxUserPrefs: { "webgl.enable-webgl2": false },
    })
}
main().catch(reportFailure)
