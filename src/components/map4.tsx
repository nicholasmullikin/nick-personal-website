import React, { useEffect, useRef } from "react"

import maplibregl from "maplibre-gl"
import "maplibre-gl/dist/maplibre-gl.css"

export function Map4() {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!containerRef.current) return

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: "https://tiles.openfreemap.org/styles/liberty",
      center: [-74.01, 40.707],
      zoom: 15,
      pitch: 60,
      bearing: -20,
      attributionControl: { compact: true },
    })

    const emptyImage: ImageData = new ImageData(1, 1)
    map.on("styleimagemissing", event => {
      if (!map.hasImage(event.id)) {
        map.addImage(event.id, emptyImage)
      }
    })

    map.addControl(new maplibregl.NavigationControl(), "top-right")

    map.on("load", () => {
      const layers = map.getStyle().layers
      const labelLayerId = layers?.find(
        l =>
          l.type === "symbol" &&
          (l.layout as { "text-field"?: unknown })?.["text-field"],
      )?.id

      if (!map.getLayer("3d-buildings")) {
        map.addLayer(
          {
            id: "3d-buildings",
            source: "openmaptiles",
            "source-layer": "building",
            type: "fill-extrusion",
            minzoom: 14,
            paint: {
              "fill-extrusion-color": "#aaa",
              "fill-extrusion-height": [
                "interpolate",
                ["linear"],
                ["zoom"],
                14,
                0,
                15.05,
                ["get", "render_height"],
              ],
              "fill-extrusion-base": [
                "interpolate",
                ["linear"],
                ["zoom"],
                14,
                0,
                15.05,
                ["get", "render_min_height"],
              ],
              "fill-extrusion-opacity": 0.85,
            },
          },
          labelLayerId,
        )
      }
    })

    return () => map.remove()
  }, [])

  return (
    <div
      ref={containerRef}
      style={{ width: "100%", height: "400px", borderRadius: 8 }}
    />
  )
}
