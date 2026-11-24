import React, { Suspense, useEffect, useRef, useState } from "react"

import styled from "styled-components"
import { Map5 } from "~/src/components/map5"
import { MapGraphics } from "~/src/components/mapGraphics"

const Map1 = React.lazy(() => import("./map").then(m => ({ default: m.Map1 })))
const Map3 = React.lazy(() => import("./map3").then(m => ({ default: m.Map3 })))
const Map4 = React.lazy(() => import("./map4").then(m => ({ default: m.Map4 })))

const MapFallback = () => <Fallback>Loading map…</Fallback>

// Keep the camera and controls mounted on return. Only nearby examples start
// loading, and the two continuously rotating examples draw only while visible.
function DemoViewport({
  height = 400,
  children,
}: {
  height?: number
  children: (visible: boolean) => React.ReactNode
}) {
  const root = useRef<HTMLDivElement>(null)
  const [mounted, setMounted] = useState(false)
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    const element = root.current
    if (!element) return
    let intersects = true
    const update = () => setVisible(intersects && !document.hidden)
    update()
    document.addEventListener("visibilitychange", update)
    if (!("IntersectionObserver" in window)) {
      setMounted(true)
      return () => document.removeEventListener("visibilitychange", update)
    }
    const nearby = new IntersectionObserver(
      entries => {
        if (entries.some(entry => entry.isIntersecting)) {
          setMounted(true)
          nearby.disconnect()
        }
      },
      { rootMargin: "160px" },
    )
    const active = new IntersectionObserver(([entry]) => {
      intersects = entry.isIntersecting
      update()
    })
    nearby.observe(element)
    active.observe(element)
    return () => {
      nearby.disconnect()
      active.disconnect()
      document.removeEventListener("visibilitychange", update)
    }
  }, [])
  return (
    <div ref={root} data-map-viewport="" style={{ minHeight: height }}>
      {mounted && (
        <Suspense fallback={<MapFallback />}>{children(visible)}</Suspense>
      )}
    </div>
  )
}

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
        <DemoViewport>
          {visible => (
            <MapGraphics requiresWebGL2>
              <Map1 active={visible} />
            </MapGraphics>
          )}
        </DemoViewport>
      </Slot>
      <Slot>
        <h3>2. Three.js earth with displacement</h3>
        <Description>
          A Three.js earth using <code>@react-three/fiber</code>. A bathymetry
          map drives <code>displacementScale</code> and a color map textures the
          surface.
        </Description>
        <DemoViewport>
          {visible => (
            <MapGraphics requiresWebGL2>
              <Map3 active={visible} />
            </MapGraphics>
          )}
        </DemoViewport>
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
        <DemoViewport>
          {() => (
            <MapGraphics center={[-74.01, 40.707]} zoom={15}>
              {contextType => <Map4 contextType={contextType} />}
            </MapGraphics>
          )}
        </DemoViewport>
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
        <DemoViewport height={500}>
          {() => (
            <MapGraphics height={500}>
              <Map5 />
            </MapGraphics>
          )}
        </DemoViewport>
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
