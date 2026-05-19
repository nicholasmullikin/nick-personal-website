// react
import React, { useState, useEffect, useRef } from "react"

// openlayers

import Map from "ol/Map"
import View from "ol/View"
import TileLayer from "ol/layer/Tile"
import VectorLayer from "ol/layer/Vector"
import VectorSource from "ol/source/Vector"
import XYZ from "ol/source/XYZ"
import { transform } from "ol/proj"
import { toStringXY } from "ol/coordinate"
import Geometry from "ol/geom/Geometry"
import Feature from "ol/Feature"
import MapBrowserEvent from "ol/MapBrowserEvent"

function MapWrapper(props: { features: Feature<Geometry>[] }) {
  // set intial state
  const [map, setMap] = useState<Map | null>(null)
  const [featuresLayer, setFeaturesLayer] =
    useState<VectorLayer<Feature<Geometry>>>()
  const [selectedCoord, setSelectedCoord] = useState<number[] | null>(null)

  // pull refs
  const mapElement = useRef<HTMLDivElement>(null)

  // create state ref that can be accessed in OpenLayers onclick callback function
  //  https://stackoverflow.com/a/60643670
  const mapRef = useRef<Map | null>(null)
  mapRef.current = map

  // initialize map on first render - logic formerly put into componentDidMount
  useEffect(() => {
    // create and add vector source layer
    const initalFeaturesLayer = new VectorLayer({
      source: new VectorSource(),
    })
    if (mapElement.current) {
      // create map
      const initialMap = new Map({
        target: mapElement.current,
        layers: [
          // USGS Topo
          new TileLayer({
            source: new XYZ({
              url: "https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/tile/{z}/{y}/{x}",
            }),
          }),

          // Google Maps Terrain
          /* new TileLayer({
            source: new XYZ({
              url: 'http://mt0.google.com/vt/lyrs=p&hl=en&x={x}&y={y}&z={z}',
            })
          }), */

          initalFeaturesLayer,
        ],
        view: new View({
          projection: "EPSG:3857",
          center: [0, 0],
          zoom: 2,
        }),
        controls: [],
      })

      // set map onclick handler
      initialMap.on("click", handleMapClick)

      // save map and vector layer references to state
      setMap(initialMap)
      setFeaturesLayer(initalFeaturesLayer)
    }
  }, [])

  // update map if features prop changes - logic formerly put into componentDidUpdate
  useEffect(() => {
    if (props.features?.length && featuresLayer != null && map) {
      // may be null on first render

      // set features to map
      featuresLayer.setSource(
        new VectorSource({
          features: props.features, // make sure features is an array
        }),
      )

      const featureSource = featuresLayer.getSource()
      if (featureSource !== null) {
        // fit map to feature extent (with 100px of padding)
        map.getView().fit(featureSource.getExtent(), {
          padding: [100, 100, 100, 100],
        })
      }
    }
  }, [props.features])

  // map click handler
  const handleMapClick = (event: MapBrowserEvent<MouseEvent>) => {
    if (mapRef.current) {
      // get clicked coordinate using mapRef to access current React state inside OpenLayers callback
      //  https://stackoverflow.com/a/60643670
      const clickedCoord = mapRef.current.getCoordinateFromPixel(event.pixel)

      // transform coord to EPSG 4326 standard Lat Long
      const transormedCoord = transform(clickedCoord, "EPSG:3857", "EPSG:4326")

      // set React state
      setSelectedCoord(transormedCoord)
    }
  }

  // render component
  return (
    <div style={{ height: "300px" }}>
      <div
        ref={mapElement}
        className="map-container"
        style={{ height: "300px" }}
      ></div>

      <div className="clicked-coord-label">
        <p>{selectedCoord ? toStringXY(selectedCoord, 5) : ""}</p>
      </div>
    </div>
  )
}

export default MapWrapper
