import React, { Suspense, useEffect, useRef } from "react"

import { Environment, OrbitControls } from "@react-three/drei"
import { Canvas, useFrame, useLoader, useThree } from "@react-three/fiber"
import GUI from "lil-gui"
import {
  type Mesh,
  type MeshStandardMaterial,
  SRGBColorSpace,
  TextureLoader,
} from "three"

function Earth() {
  const meshRef = useRef<Mesh>(null)
  const materialRef = useRef<MeshStandardMaterial>(null)
  const { gl } = useThree()

  const texture = useLoader(TextureLoader, "/img/worldColour.5400x2700.jpg")
  const displacementMap = useLoader(
    TextureLoader,
    "/img/gebco_bathy_2700x1350.jpg",
  )

  useEffect(() => {
    if (!materialRef.current) return
    const gui = new GUI({ container: undefined, title: "Map3" })
    gui.add(materialRef.current, "wireframe")
    gui.add(materialRef.current, "displacementScale", 0, 1, 0.01)
    return () => gui.destroy()
  }, [])

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
        wireframe={false}
        map={texture}
        displacementMap={displacementMap}
        displacementScale={0.1}
      />
    </mesh>
  )
}

export function Map3() {
  if (typeof window === "undefined") return null

  return (
    <div style={{ width: "100%", height: "400px" }}>
      <Canvas shadows="percentage" camera={{ position: [0, 0, 2.2], fov: 50 }}>
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
          <Earth />
          <OrbitControls />
        </Suspense>
      </Canvas>
    </div>
  )
}
