import React, { useEffect, useRef } from "react"

/*
 * Copyright (C) 2023-     XYZ maps contributors
 * Copyright (C) 2019-2021 HERE Europe B.V.
 * Licensed under Apache 2.0, see full license in LICENSE
 * SPDX-License-Identifier: Apache-2.0
 */

import { GeoCoordinates } from "@xyzmaps/harp-geoutils"
import { MapControls, MapControlsUI } from "@xyzmaps/harp-map-controls"
import { CopyrightElementHandler, MapView } from "@xyzmaps/harp-mapview"
import { VectorTileDataSource } from "@xyzmaps/harp-vectortile-datasource"

const XYZMap = () => {
  const mapElement = useRef<HTMLCanvasElement>(null)

  // snippet:harp_gl_hello_world_example_1.ts
  // Look at New York.
  const canvas = mapElement.current
  const NY = new GeoCoordinates(40.707, -74.01)
  const map = new MapView({
    canvas,
    theme: "resources/berlin_tilezen_base.json",
    target: NY,
    tilt: 50,
    heading: -20,
    zoomLevel: 16.1,
  })
  // end:harp_gl_hello_world_example_1.ts

  CopyrightElementHandler.install("copyrightNotice", map)

  // snippet:harp_gl_hello_world_example_map_controls.ts
  // Instantiate the default map controls, allowing the user to pan around freely.
  const mapControls = new MapControls(map)
  mapControls.maxTiltAngle = 50
  // end:harp_gl_hello_world_example_map_controls.ts

  // Add an UI.
  const ui = new MapControlsUI(mapControls, { zoomLevel: "input" })
  canvas.parentElement!.appendChild(ui.domElement)

  // snippet:harp_gl_hello_world_example_3.ts
  // Resize the mapView to maximum.
  map.resize(window.innerWidth, window.innerHeight)

  // React on resize events.
  window.addEventListener("resize", () => {
    map.resize(window.innerWidth, window.innerHeight)
  })
  // end:harp_gl_hello_world_example_3.ts

  addVectorTileDataSource(map)
  const omvDataSource = new VectorTileDataSource({
    url: "https://demo.xyzmaps.org/maps/osm/{z}/{x}/{y}.pbf",
    styleSetName: "tilezen",
  })
  // end:harp_gl_hello_world_example_4.ts

  // snippet:harp_gl_hello_world_example_5.ts
  map.addDataSource(omvDataSource)

  return <canvas ref={mapElement}> </canvas>
}

export function Map4() {
  const isBrowser = typeof window !== "undefined"

  return isBrowser && <XYZMap></XYZMap>
}
