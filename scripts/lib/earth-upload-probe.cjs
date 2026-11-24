// Installed only by the opt-in navigation benchmark. Query mode reserves
// the GPU timer extension for uploads, so normal frame GPU timing is absent.
async function installUploadProbe(page, gpuTiming) {
  await page.addInitScript(captureUploads, gpuTiming)
}

function captureUploads(gpuTiming) {
  const sources = new WeakMap()
  const urls = new Map()
  const textures = new WeakMap()
  const contexts = new WeakMap()
  const originalExtensions = new Map()
  const trace = { frame: 0, dropped: 0, records: [] }
  window.earthUploadTrace = trace

  function classify(url) {
    const path = new URL(url, location.href).pathname
    if (path.includes("/mapbox.satellite/")) return "satellite"
    if (path.includes("/earth-background/")) return "background"
    if (path.includes("/resources/earth/night/")) return "night"
    if (path.endsWith("/cloud-coverage.webp")) return "cloudCoverage"
    if (/\/cloud-noise\.(webp|png)$/.test(path)) return "cloudNoise"
    if (/\.(webp|jpe?g|png)$/i.test(path)) return "static"
    return "other"
  }
  const blob = Response.prototype.blob
  Response.prototype.blob = async function () {
    const result = await blob.call(this)
    sources.set(result, classify(this.url))
    return result
  }
  const open = XMLHttpRequest.prototype.open
  XMLHttpRequest.prototype.open = function (method, url, ...args) {
    const group = classify(url)
    this.addEventListener(
      "load",
      () => {
        if (this.responseType === "blob" && this.response)
          sources.set(this.response, group)
      },
      { once: true },
    )
    return open.call(this, method, url, ...args)
  }
  const createUrl = URL.createObjectURL
  const revokeUrl = URL.revokeObjectURL
  URL.createObjectURL = function (obj) {
    const url = createUrl.call(URL, obj)
    if (sources.has(obj)) urls.set(url, sources.get(obj))
    return url
  }
  URL.revokeObjectURL = function (url) {
    urls.delete(url)
    revokeUrl.call(URL, url)
  }
  const src = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, "src")
  Object.defineProperty(HTMLImageElement.prototype, "src", {
    ...src,
    set(url) {
      if (urls.has(url)) sources.set(this, urls.get(url))
      src.set.call(this, url)
    },
  })
  if (window.createImageBitmap) {
    const create = window.createImageBitmap
    window.createImageBitmap = async (...args) => {
      const image = await create.apply(window, args)
      if (sources.has(args[0])) sources.set(image, sources.get(args[0]))
      return image
    }
  }

  function context(gl, proto, webgl2) {
    if (contexts.has(gl)) return contexts.get(gl)
    const ext =
      gpuTiming &&
      originalExtensions
        .get(proto)
        .call(
          gl,
          webgl2
            ? "EXT_disjoint_timer_query_webgl2"
            : "EXT_disjoint_timer_query",
        )
    const api = !ext
      ? null
      : webgl2
        ? {
            create: () => gl.createQuery(),
            start: q => gl.beginQuery(ext.TIME_ELAPSED_EXT, q),
            stop: () => gl.endQuery(ext.TIME_ELAPSED_EXT),
            ready: q => gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE),
            elapsed: q => gl.getQueryParameter(q, gl.QUERY_RESULT),
            free: q => gl.deleteQuery(q),
          }
        : {
            create: () => ext.createQueryEXT(),
            start: q => ext.beginQueryEXT(ext.TIME_ELAPSED_EXT, q),
            stop: () => ext.endQueryEXT(ext.TIME_ELAPSED_EXT),
            ready: q =>
              ext.getQueryObjectEXT(q, ext.QUERY_RESULT_AVAILABLE_EXT),
            elapsed: q => ext.getQueryObjectEXT(q, ext.QUERY_RESULT_EXT),
            free: q => ext.deleteQueryEXT(q),
          }
    const state = {
      unit: gl.TEXTURE0,
      bindings: new Map(),
      api,
      pending: [],
      timer: 0,
      count: 0,
    }
    state.poll = () => {
      const disjoint = gl.getParameter(ext.GPU_DISJOINT_EXT)
      state.pending = state.pending.filter(({ query, record }) => {
        if (!disjoint && !api.ready(query)) return true
        if (!disjoint) record.gpuMs = api.elapsed(query) / 1e6
        api.free(query)
        return false
      })
      state.timer = state.pending.length ? setTimeout(state.poll, 50) : 0
    }
    contexts.set(gl, state)
    return state
  }
  for (const type of ["WebGLRenderingContext", "WebGL2RenderingContext"]) {
    const proto = window[type]?.prototype
    if (!proto) continue
    const webgl2 = type === "WebGL2RenderingContext"
    const getExtension = proto.getExtension
    originalExtensions.set(proto, getExtension)
    if (gpuTiming)
      proto.getExtension = function (name) {
        if (name.toLowerCase().includes("disjoint_timer_query")) return null
        return getExtension.call(this, name)
      }
    const activate = proto.activeTexture
    proto.activeTexture = function (unit) {
      context(this, proto, webgl2).unit = unit
      return activate.call(this, unit)
    }
    const bind = proto.bindTexture
    proto.bindTexture = function (target, texture) {
      const state = context(this, proto, webgl2)
      state.bindings.set((state.unit - this.TEXTURE0) * 65536 + target, texture)
      return bind.call(this, target, texture)
    }
    for (const method of [
      "texImage2D",
      "texSubImage2D",
      "texImage3D",
      "texSubImage3D",
      "compressedTexImage2D",
      "compressedTexSubImage2D",
      "texStorage2D",
      "texStorage3D",
      "generateMipmap",
    ]) {
      const run = proto[method]
      if (!run) continue
      proto[method] = function (...args) {
        const state = context(this, proto, webgl2)
        const texture = state.bindings.get(
          (state.unit - this.TEXTURE0) * 65536 + args[0],
        )
        let group = texture && textures.get(texture),
          width,
          height,
          depth
        if (method.startsWith("texStorage")) {
          group = "allocation"
          width = args[3]
          height = args[4]
          if (method === "texStorage3D") depth = args[5]
        } else if (method.startsWith("compressedTex")) {
          const sub = method === "compressedTexSubImage2D"
          const format = args[sub ? 6 : 2]
          group =
            format === 0x8e8c
              ? "bc7"
              : format === 0x9274
                ? "etc2"
                : "compressed"
          const size = sub ? 4 : 3
          width = args[size]
          height = args[size + 1]
        } else if (method !== "generateMipmap") {
          const source = args.at(-1)
          if (sources.has(source)) group = sources.get(source)
          else if (source instanceof HTMLCanvasElement) group = "canvas"
          else if (source instanceof HTMLImageElement) group = "image"
          else if (
            typeof ImageBitmap !== "undefined" &&
            source instanceof ImageBitmap
          )
            group = "bitmap"
          else group = source === null ? "allocation" : "buffer"
          if (source?.width !== undefined) {
            width = source.width
            height = source.height
          } else {
            const volume = method.endsWith("3D")
            const size = method.startsWith("texSubImage") ? (volume ? 5 : 4) : 3
            width = args[size]
            height = args[size + 1]
            if (volume) depth = args[size + 2]
          }
        }
        if (texture && group && group !== "allocation")
          textures.set(texture, group)
        if (!group) return run.apply(this, args)
        if (trace.records.length >= 32768) {
          trace.dropped++
          return run.apply(this, args)
        }
        const record = {
          frame: trace.frame,
          group,
          method,
          width,
          height,
          depth,
        }
        // Sample GPU commands sparsely; retrieving every driver query can
        // itself stall the navigation being measured.
        const query =
          state.api && state.count++ % 4 === 0 && state.pending.length < 16
            ? state.api.create()
            : null
        if (query) state.api.start(query)
        const start = performance.now()
        try {
          return run.apply(this, args)
        } finally {
          record.cpuMs = performance.now() - start
          if (query) {
            state.api.stop()
            state.pending.push({ query, record })
            if (!state.timer) state.timer = setTimeout(state.poll, 50)
          }
          trace.records.push(record)
        }
      }
    }
  }
}

function summarizeUploads(trace) {
  const groups = new Map(),
    frames = new Map()
  function times(values) {
    if (!values.length) return null
    const sorted = values.sort((a, b) => a - b)
    return {
      samples: sorted.length,
      p50: sorted[sorted.length >> 1],
      p95: sorted[Math.floor(sorted.length * 0.95)],
      max: sorted.at(-1),
    }
  }
  for (const r of trace.records) {
    const k = r.group + "/" + r.method
    if (!groups.has(k)) groups.set(k, { cpu: [], gpu: [] })
    const g = groups.get(k)
    g.cpu.push(r.cpuMs)
    if (r.gpuMs !== undefined) g.gpu.push(r.gpuMs)
    if (!r.frame) continue
    const frame = frames.get(r.frame) || { cpu: 0, uploads: 0 }
    frame.cpu += r.cpuMs
    if (r.method !== "generateMipmap") frame.uploads++
    frames.set(r.frame, frame)
  }
  return {
    dropped: trace.dropped,
    bySource: Object.fromEntries(
      [...groups].map(([key, g]) => [
        key,
        { cpuMs: times(g.cpu), gpuMs: times(g.gpu) },
      ]),
    ),
    framesWithUploads: {
      cpuMs: times([...frames.values()].map(f => f.cpu)),
      uploads: times([...frames.values()].map(f => f.uploads)),
    },
  }
}
module.exports = { installUploadProbe, summarizeUploads }
