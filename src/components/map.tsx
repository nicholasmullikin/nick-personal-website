import React, { Suspense, useEffect, useRef, useState } from "react"

import { Environment, OrbitControls } from "@react-three/drei"
import { Canvas, useFrame } from "@react-three/fiber"
import Map from "ol/Map"
import View from "ol/View"
import TileLayer from "ol/layer/Tile"
import XYZ from "ol/source/XYZ"
import * as THREE from "three"
import type { Mesh } from "three"

import "ol/ol.css"

const OL_WIDTH = 1024
const OL_HEIGHT = 512

const hiddenMapStyle: React.CSSProperties = {
  position: "fixed",
  top: 0,
  left: 0,
  width: OL_WIDTH,
  height: OL_HEIGHT,
  visibility: "hidden",
  pointerEvents: "none",
  zIndex: -1,
}

function Earth({ olCanvas }: { olCanvas: HTMLCanvasElement | null }) {
  const meshRef = useRef<Mesh | null>(null)
  const textureRef = useRef<THREE.CanvasTexture | null>(null)

  useEffect(() => {
    if (!olCanvas) return
    const tex = new THREE.CanvasTexture(olCanvas)
    tex.colorSpace = THREE.SRGBColorSpace
    textureRef.current = tex
    if (meshRef.current) {
      const mat = meshRef.current.material as THREE.MeshStandardMaterial
      mat.map = tex
      mat.needsUpdate = true
    }
    return () => {
      tex.dispose()
      textureRef.current = null
    }
  }, [olCanvas])

  useFrame((_, delta) => {
    if (textureRef.current) textureRef.current.needsUpdate = true
    if (meshRef.current) meshRef.current.rotation.y += delta / 30
  })

  return (
    <mesh ref={meshRef} castShadow receiveShadow>
      <sphereGeometry args={[1, 64, 64]} />
      <meshStandardMaterial roughness={0.7} metalness={0.1} />
    </mesh>
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
        zoom: 1,
      }),
      controls: [],
    })

    mapRef.current = olMap

    const grabCanvas = () => {
      const canvas = olMap
        .getViewport()
        .querySelector<HTMLCanvasElement>(".ol-layer canvas")
      if (canvas && canvas.width > 0 && canvas.height > 0) {
        setOlCanvas(previous => (previous === canvas ? previous : canvas))
      }
    }
    olMap.on("rendercomplete", grabCanvas)
    olMap.once("postrender", grabCanvas)

    return () => {
      olMap.setTarget(undefined)
      mapRef.current = null
    }
  }, [])

  if (typeof window === "undefined") return null

  return (
    <div style={{ width: "100%", height: "400px" }}>
      <div
        ref={mapDivRef}
        aria-hidden
        style={hiddenMapStyle}
        data-testid="ol-source-map"
      />
      <Canvas
        shadows="percentage"
        camera={{ position: [0, 0, 3], fov: 50 }}
        gl={{ antialias: true }}
      >
        <Suspense fallback={null}>
          <Environment files="/img/venice_sunset_1k.hdr" />
          <ambientLight intensity={0.4} />
          <directionalLight
            intensity={1.5}
            position={[4, 2, 2]}
            castShadow
            shadow-mapSize-width={1024}
            shadow-mapSize-height={1024}
          />
          <Earth olCanvas={olCanvas} />
          <OrbitControls />
        </Suspense>
      </Canvas>
    </div>
  )
}
