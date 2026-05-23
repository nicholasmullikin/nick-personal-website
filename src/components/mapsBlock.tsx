import React, { Suspense } from "react"

import styled from "styled-components"
import { setConsoleFunction } from "three"

import { Map1 } from "~/src/components/map"
import { Map3 } from "~/src/components/map3"
import { Map4 } from "~/src/components/map4"
import { Map5 } from "~/src/components/map5"

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
          <Map1 />
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
          <Map3 />
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
          <Map4 />
        </Suspense>
      </Slot>
      <Slot>
        <h3>4. harp.gl globe with terrain &amp; atmosphere</h3>
        <Description>
          The <code>rendering_globe-atmosphere</code> example from{" "}
          <a
            href="https://github.com/xyzmaps/harp.gl"
            target="_blank"
            rel="noreferrer"
          >
            xyz-threejs
          </a>
          , embedded in an iframe. A spherical-projection{" "}
          <a
            href="https://github.com/xyzmaps/harp.gl"
            target="_blank"
            rel="noreferrer"
          >
            harp.gl
          </a>{" "}
          <code>MapView</code> drapes Mapbox satellite tiles over a Mapbox
          terrain-RGB DEM, with a custom shader for hillshading, contour lines
          and atmospheric fog.
        </Description>
        <Suspense fallback={<MapFallback />}>
          <Map5 />
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
