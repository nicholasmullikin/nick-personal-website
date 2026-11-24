import React from "react"

import { Map5 } from "./map5"
import { MapGraphics } from "./mapGraphics"

export default function EarthMapPage({ search }: { search: string }) {
  return (
    <MapGraphics height="100%">
      <Map5 fullWindow search={search} />
    </MapGraphics>
  )
}
