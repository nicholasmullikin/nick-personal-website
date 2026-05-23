import React, { Suspense, useEffect, useRef, useState } from "react"

import { Environment, OrbitControls } from "@react-three/drei"
import { Canvas, useFrame, useLoader, useThree } from "@react-three/fiber"
import styled from "styled-components"
import {
  type Mesh,
  type MeshStandardMaterial,
  SRGBColorSpace,
  TextureLoader,
} from "three"

interface EarthProperties {
  displacementScale: number
  wireframe: boolean
}

function Earth({ displacementScale, wireframe }: EarthProperties) {
  const meshRef = useRef<Mesh>(null)
  const materialRef = useRef<MeshStandardMaterial>(null)
  const { gl } = useThree()

  const texture = useLoader(TextureLoader, "/img/worldColour.5400x2700.jpg")
  const displacementMap = useLoader(
    TextureLoader,
    "/img/gebco_bathy_2700x1350.jpg",
  )

  useEffect(() => {
    texture.colorSpace = SRGBColorSpace
    texture.anisotropy = gl.capabilities.getMaxAnisotropy()
    texture.needsUpdate = true
  }, [texture, gl])

  useFrame((_, delta) => {
    if (meshRef.current) {
      meshRef.current.rotation.y += delta / 20
    }
  })

  return (
    <mesh ref={meshRef} castShadow receiveShadow>
      <sphereGeometry args={[1, 128, 128]} />
      <meshStandardMaterial
        ref={materialRef}
        wireframe={wireframe}
        map={texture}
        displacementMap={displacementMap}
        displacementScale={displacementScale}
      />
    </mesh>
  )
}

export function Map3() {
  const [wireframe, setWireframe] = useState(false)
  const [displacementScale, setDisplacementScale] = useState(0.1)

  if (typeof window === "undefined") return null

  return (
    <MapFrame>
      <Canvas shadows="percentage" camera={{ position: [0, 0, 2.7], fov: 50 }}>
        <Suspense fallback={null}>
          <Environment files="/img/venice_sunset_1k.hdr" />
          <ambientLight intensity={0.6} />
          <directionalLight
            intensity={Math.PI}
            position={[2, 1, 3]}
            castShadow
            shadow-mapSize-width={2048}
            shadow-mapSize-height={2048}
          />
          <Earth displacementScale={displacementScale} wireframe={wireframe} />
          <OrbitControls />
        </Suspense>
      </Canvas>
      <ControlPanel onPointerDown={event => event.stopPropagation()}>
        <ControlTitle>Terrain controls</ControlTitle>
        <CheckboxLabel>
          <input
            checked={wireframe}
            onChange={event => setWireframe(event.target.checked)}
            type="checkbox"
          />
          Wireframe
        </CheckboxLabel>
        <RangeLabel>
          <span>Relief</span>
          <output>{displacementScale.toFixed(2)}</output>
        </RangeLabel>
        <input
          max="0.4"
          min="0"
          onChange={event => setDisplacementScale(Number(event.target.value))}
          step="0.01"
          type="range"
          value={displacementScale}
        />
      </ControlPanel>
    </MapFrame>
  )
}

const MapFrame = styled.div`
  position: relative;
  width: 100%;
  height: 400px;
`

const ControlPanel = styled.div`
  position: absolute;
  top: var(--sizing-xs);
  right: var(--sizing-xs);
  z-index: 1;
  width: 12rem;
  padding: var(--sizing-xs);
  color: white;
  font-size: 0.75rem;
  background: rgb(0 0 0 / 72%);
  border: 1px solid rgb(255 255 255 / 16%);
  border-radius: 8px;
  box-shadow: 0 8px 24px rgb(0 0 0 / 20%);

  &,
  label,
  output,
  span {
    color: white;
  }

  input[type="range"] {
    width: 100%;
  }
`

const ControlTitle = styled.div`
  margin-bottom: 0.35rem;
  color: white;
  font-weight: var(--font-weight-semi-bold);
`

const CheckboxLabel = styled.label`
  display: flex;
  gap: 0.35rem;
  align-items: center;
  margin-bottom: 0.35rem;
`

const RangeLabel = styled.label`
  display: flex;
  justify-content: space-between;
  margin-bottom: 0.2rem;
`
