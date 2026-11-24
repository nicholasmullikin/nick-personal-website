import React, { useEffect, useState } from "react"

import type { FallbackProperties } from "./rasterMapFallback"

export type MapGraphicsVersion = "webgl2" | "webgl"
type GraphicsSupport = MapGraphicsVersion | "unavailable"
let cachedSupport: GraphicsSupport | undefined

function graphicsSupport(): GraphicsSupport {
  if (cachedSupport) return cachedSupport
  for (const version of ["webgl2", "webgl"] as const) {
    // Try each version on a fresh canvas. Use the browser's preferred GPU,
    // including on Firefox systems that restrict high-performance contexts.
    const canvas = document.createElement("canvas")
    try {
      const context = canvas.getContext(version, {
        powerPreference: "default",
        antialias: false,
        alpha: true,
        depth: true,
        stencil: true,
      }) as WebGLRenderingContext | WebGL2RenderingContext | null
      if (!context) continue
      context.getExtension("WEBGL_lose_context")?.loseContext()
      cachedSupport = version
      return version
    } catch {
      // Some browser policies reject getContext by throwing instead of returning null.
    }
  }
  cachedSupport = "unavailable"
  return cachedSupport
}

const RasterMap = React.lazy(() => import("./rasterMapFallback"))

export function RasterMapFallback(props: FallbackProperties) {
  return (
    <React.Suspense
      fallback={<div style={{ height: props.height ?? 400 }}>Loading map…</div>}
    >
      <RasterMap {...props} />
    </React.Suspense>
  )
}

export function MapGraphics({
  children,
  requiresWebGL2 = false,
  ...fallback
}: FallbackProperties & {
  requiresWebGL2?: boolean
  children: React.ReactNode | ((version: MapGraphicsVersion) => React.ReactNode)
}) {
  const [support, setSupport] = useState<GraphicsSupport | null>(null)
  useEffect(() => setSupport(graphicsSupport()), [])
  if (support === null)
    return <div style={{ height: fallback.height ?? 400 }}>Loading map…</div>
  if (support === "unavailable" || (requiresWebGL2 && support !== "webgl2"))
    return <RasterMapFallback {...fallback} />
  return <>{typeof children === "function" ? children(support) : children}</>
}
