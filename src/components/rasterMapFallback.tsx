import React, { useEffect, useRef } from "react"

import OLMap from "ol/Map"
import View from "ol/View"
import TileLayer from "ol/layer/Tile"
import { fromLonLat } from "ol/proj"
import OSM from "ol/source/OSM"
import "ol/ol.css"

export interface FallbackProperties {
  center?: [number, number]
  zoom?: number
  height?: React.CSSProperties["height"]
}

export default function RasterMapFallback({
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
        borderRadius: height === "100%" ? 0 : 8,
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
