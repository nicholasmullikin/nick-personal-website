import React, { useEffect, useRef, useState } from "react"

import { Environment, OrbitControls, Stats } from "@react-three/drei"
import { Canvas, useFrame } from "@react-three/fiber"
import * as THREE from "three"
import type { Mesh } from "three"
import Map from "ol/Map"
import TileLayer from "ol/layer/Tile"
import View from "ol/View"
import XYZ from "ol/source/XYZ"
import "ol/ol.css"

const OL_WIDTH = 1000
const OL_HEIGHT = 500

const hiddenMapStyle: React.CSSProperties = {
  position: "fixed",
  top: 0,
  left: 0,
  width: OL_WIDTH,
  height: OL_HEIGHT,
  overflow: "hidden",
  clipPath: "inset(100%)",
  pointerEvents: "none",
  zIndex: -1,
}

function Earth({ olCanvas }: { olCanvas: HTMLCanvasElement | null }) {
  const meshRef = useRef<Mesh | null>(null)
  const textureRef = useRef<THREE.CanvasTexture | null>(null)

  useEffect(() => {
    if (!olCanvas) return
    const tex = new THREE.CanvasTexture(olCanvas)
    textureRef.current = tex
    if (meshRef.current) {
      const mat = meshRef.current.material as THREE.MeshBasicMaterial
      mat.map = tex
      mat.needsUpdate = true
    }
    return () => {
      tex.dispose()
      textureRef.current = null
    }
  }, [olCanvas])

  useFrame(() => {
    if (textureRef.current) {
      textureRef.current.needsUpdate = true
    }
  })

  return (
    <>
      <Environment files="/img/venice_sunset_1k.hdr" />
      <directionalLight
        intensity={Math.PI}
        position={[4, 0, 2]}
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-left={-2}
        shadow-camera-right={2}
        shadow-camera-top={-2}
        shadow-camera-bottom={2}
        shadow-camera-near={0.1}
        shadow-camera-far={7}
      />
      <mesh ref={meshRef} castShadow receiveShadow>
        <sphereGeometry args={[90, 64, 64]} />
        <meshBasicMaterial />
      </mesh>
      <OrbitControls />
      <Stats />
    </>
  )
}

export function Map1() {
  const mapDivRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<Map | null>(null)
  const [olCanvas, setOlCanvas] = useState<HTMLCanvasElement | null>(null)

  useEffect(() => {
    if (!mapDivRef.current) return

    const olMap = new Map({
      target: mapDivRef.current,
      layers: [
        new TileLayer({
          source: new XYZ({
            url: "https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/tile/{z}/{y}/{x}",
            crossOrigin: "anonymous",
          }),
        }),
      ],
      view: new View({
        projection: "EPSG:4326",
        extent: [-180, -90, 180, 90],
        center: [0, 0],
        zoom: 2,
      }),
      controls: [],
    })

    mapRef.current = olMap

    olMap.on("rendercomplete", () => {
      const canvas = olMap
        .getViewport()
        .querySelector<HTMLCanvasElement>(".ol-layer canvas")
      if (canvas && canvas.width > 0 && canvas.height > 0) {
        setOlCanvas(prev => (prev === canvas ? prev : canvas))
      }
    })

    return () => {
      olMap.setTarget(undefined)
      mapRef.current = null
    }
  }, [])

  if (typeof window === "undefined") {
    return null
  }

  return (
    <>
      <div ref={mapDivRef} aria-hidden style={hiddenMapStyle} />
      <div style={{ height: "400px" }}>
        <Canvas
          camera={{ position: [0, 0, 100] }}
          gl={{ antialias: true }}
          onCreated={({ gl }) => {
            gl.shadowMap.enabled = true
            gl.shadowMap.type = THREE.PCFShadowMap
          }}
        >
          <Earth olCanvas={olCanvas} />
        </Canvas>
      </div>
    </>
  )
}
