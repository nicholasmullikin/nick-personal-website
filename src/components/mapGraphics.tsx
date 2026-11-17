import React, { useEffect, useRef, useState } from "react"

import OLMap from "ol/Map"
import View from "ol/View"
import TileLayer from "ol/layer/Tile"
import { fromLonLat } from "ol/proj"
import OSM from "ol/source/OSM"
import "ol/ol.css"

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

interface FallbackProperties {
  center?: [number, number]
  zoom?: number
  height?: number
}

export function RasterMapFallback({
  center = [0, 20],
  zoom = 1,
  height = 400,
}: FallbackProperties) {
  const targetRef = useRef<HTMLDivElement>(null)
  const [longitude, latitude] = center
  useEffect(() => {
    if (!targetRef.current) return
    const map = new OLMap({
      target: targetRef.current,
      layers: [new TileLayer({ source: new OSM() })],
      view: new View({ center: fromLonLat([longitude, latitude]), zoom }),
    })
    return () => {
      map.setTarget(undefined)
      map.dispose()
    }
  }, [longitude, latitude, zoom])
  return (
    <div
      data-testid="map-graphics-fallback"
      style={{
        position: "relative",
        height,
        borderRadius: 8,
        overflow: "hidden",
      }}
    >
      <div
        ref={targetRef}
        aria-label="Interactive 2D map"
        style={{ width: "100%", height: "100%" }}
      />
      <p
        role="status"
        style={{
          position: "absolute",
          top: 8,
          left: 48,
          right: 8,
          margin: 0,
          padding: "8px 12px",
          borderRadius: 6,
          background: "#14202ded",
          color: "white",
          fontSize: "0.8rem",
          pointerEvents: "none",
        }}
      >
        3D rendering is unavailable in this browser. You can still pan and zoom
        this 2D map.
      </p>
    </div>
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
