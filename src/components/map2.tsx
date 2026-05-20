import React, { useEffect, useRef, useState } from "react"

import Feature from "ol/Feature"
import Geometry from "ol/geom/Geometry"
import TileLayer from "ol/layer/Tile"
import VectorLayer from "ol/layer/Vector"
import Map from "ol/Map"
import { toStringXY } from "ol/coordinate"
import { transform } from "ol/proj"
import VectorSource from "ol/source/Vector"
import XYZ from "ol/source/XYZ"
import View from "ol/View"

import "ol/ol.css"

type FeatureSource = VectorSource<Feature<Geometry>>

interface Map2Properties {
  features?: Feature<Geometry>[]
}

function Map2({ features = [] }: Map2Properties) {
  const [map, setMap] = useState<Map | null>(null)
  const [featuresLayer, setFeaturesLayer] =
    useState<VectorLayer<FeatureSource> | null>(null)
  const [selectedCoord, setSelectedCoord] = useState<number[] | null>(null)

  const mapElement = useRef<HTMLDivElement>(null)
  const mapRef = useRef<Map | null>(null)
  mapRef.current = map

  useEffect(() => {
    if (!mapElement.current) return

    const initalFeaturesLayer = new VectorLayer<FeatureSource>({
      source: new VectorSource<Feature<Geometry>>(),
    })

    const initialMap = new Map({
      target: mapElement.current,
      layers: [
        new TileLayer({
          source: new XYZ({
            url: "https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/tile/{z}/{y}/{x}",
          }),
        }),
        initalFeaturesLayer,
      ],
      view: new View({
        projection: "EPSG:3857",
        center: [0, 0],
        zoom: 2,
      }),
      controls: [],
    })

    const handleMapClick = (event: { pixel: import("ol/pixel").Pixel }) => {
      if (!mapRef.current) return
      const clickedCoord = mapRef.current.getCoordinateFromPixel(event.pixel)
      const transformedCoord = transform(clickedCoord, "EPSG:3857", "EPSG:4326")
      setSelectedCoord(transformedCoord)
    }

    initialMap.on("click", handleMapClick)
    setMap(initialMap)
    setFeaturesLayer(initalFeaturesLayer)

    return () => {
      initialMap.setTarget(undefined)
    }
  }, [])

  useEffect(() => {
    if (!map || !featuresLayer || features.length === 0) return
    featuresLayer.setSource(new VectorSource<Feature<Geometry>>({ features }))
    const source = featuresLayer.getSource()
    const extent = source?.getExtent()
    if (extent) {
      map.getView().fit(extent, { padding: [100, 100, 100, 100] })
    }
  }, [features, featuresLayer, map])

  return (
    <div style={{ width: "100%" }}>
      <div
        ref={mapElement}
        style={{ width: "100%", height: "400px", borderRadius: 8 }}
      />
      <p style={{ marginTop: 8, fontSize: 14 }}>
        Click to log lat/lng:{" "}
        <code>{selectedCoord ? toStringXY(selectedCoord, 5) : "—"}</code>
      </p>
    </div>
  )
}

export default Map2
export { Map2 }
