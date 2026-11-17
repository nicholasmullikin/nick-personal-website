import React, { Suspense } from "react"

import styled from "styled-components"
import { setConsoleFunction } from "three"

import { Map1 } from "~/src/components/map"
import { Map3 } from "~/src/components/map3"
import { Map4 } from "~/src/components/map4"
import { Map5 } from "~/src/components/map5"
import { MapGraphics } from "~/src/components/mapGraphics"

const SILENCED_THREE_WARNINGS = ["Clock: This module has been deprecated"]

setConsoleFunction((type, message, ...rest) => {
  if (
    type === "warn" &&
    SILENCED_THREE_WARNINGS.some(needle => message.includes(needle))
  ) {
    return
  }
  const method = (
    console as unknown as Record<string, (...args: unknown[]) => void>
  )[type]
  method?.(message, ...rest)
})

const MapFallback = () => <Fallback>Loading map…</Fallback>

const MapsBlock = () => {
  if (typeof window === "undefined") return null

  return (
    <Stack>
      <Slot>
        <h3>1. OpenLayers texture on a Three.js sphere</h3>
        <Description>
          An OpenLayers 2D raster map is rendered into an off-screen{" "}
          <code>&lt;canvas&gt;</code>, then used as a live texture on a Three.js
          sphere. Drag to orbit.
        </Description>
        <Suspense fallback={<MapFallback />}>
          <MapGraphics requiresWebGL2>
            <Map1 />
          </MapGraphics>
        </Suspense>
      </Slot>
      <Slot>
        <h3>2. Three.js earth with displacement</h3>
        <Description>
          A Three.js earth using <code>@react-three/fiber</code>. A bathymetry
          map drives <code>displacementScale</code> and a color map textures the
          surface.
        </Description>
        <Suspense fallback={<MapFallback />}>
          <MapGraphics requiresWebGL2>
            <Map3 />
          </MapGraphics>
        </Suspense>
      </Slot>
      <Slot>
        <h3>3. MapLibre GL — 3D vector tiles</h3>
        <Description>
          A pitched{" "}
          <a href="https://maplibre.org/" target="_blank" rel="noreferrer">
            MapLibre GL
          </a>{" "}
          map of New York, with the OSM <code>building</code> vector tile layer
          extruded to actual building heights.
        </Description>
        <Suspense fallback={<MapFallback />}>
          <MapGraphics center={[-74.01, 40.707]} zoom={15}>
            {contextType => <Map4 contextType={contextType} />}
          </MapGraphics>
        </Suspense>
      </Slot>
      <Slot>
        <h3>4. Interactive Earth with harp.gl</h3>
        <Description>
          Explore satellite imagery over real-scale terrain, from orbit to
          mountain valleys and cities. OpenStreetMap buildings appear as you
          approach a city, while city lights emerge after sunset and animated
          clouds drift above the surface. Drag to move, scroll to zoom, and
          choose a city or landscape preset. Use the Sun slider, Day/Night
          buttons, or play button to explore the lighting. Clouds and night
          lights use historical NASA composites, not live weather or imagery.
        </Description>
        <Suspense fallback={<MapFallback />}>
          <MapGraphics height={500}>
            <Map5 />
          </MapGraphics>
        </Suspense>
      </Slot>
    </Stack>
  )
}

const Stack = styled.section`
  display: flex;
  flex-direction: column;
  gap: var(--sizing-xl);
  margin-top: var(--sizing-lg);
`

const Slot = styled.div`
  h3 {
    margin-bottom: var(--sizing-xs);
    font-size: 1.25rem;
    font-weight: var(--font-weight-semi-bold);
  }
`

const Description = styled.p`
  margin: 0 0 var(--sizing-xs);
  line-height: 1.5;
`

const Fallback = styled.div`
  width: 100%;
  height: 400px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--color-gray-2);
  border-radius: 8px;
`

export default MapsBlock
