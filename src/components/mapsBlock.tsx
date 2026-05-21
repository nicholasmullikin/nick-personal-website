import React, { Suspense } from "react"

import styled from "styled-components"
import { setConsoleFunction } from "three"

import { Map1 } from "~/src/components/map"
import Map2 from "~/src/components/map2"
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
        <h3>Map1 — OpenLayers texture on a Three.js sphere</h3>
        <Suspense fallback={<MapFallback />}>
          <Map1 />
        </Suspense>
      </Slot>
      <Slot>
        <h3>Map2 — OpenLayers 2D</h3>
        <Suspense fallback={<MapFallback />}>
          <Map2 />
        </Suspense>
      </Slot>
      <Slot>
        <h3>Map3 — Three.js earth with displacement</h3>
        <Suspense fallback={<MapFallback />}>
          <Map3 />
        </Suspense>
      </Slot>
      <Slot>
        <h3>Map4 — MapLibre GL 3D vector tiles</h3>
        <Suspense fallback={<MapFallback />}>
          <Map4 />
        </Suspense>
      </Slot>
      <Slot>
        <h3>Map5 — harp.gl globe with terrain &amp; atmosphere</h3>
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
  gap: var(--sizing-lg);
  margin-top: var(--sizing-lg);
`

const Slot = styled.div`
  h3 {
    margin-bottom: var(--sizing-sm);
    font-size: 1.25rem;
    font-weight: var(--font-weight-semi-bold);
  }
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
