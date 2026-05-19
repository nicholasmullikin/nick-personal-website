import React, { useEffect, useRef } from "react"

import { Environment, OrbitControls, Stats } from "@react-three/drei"
import { Canvas, useFrame, useLoader, useThree } from "@react-three/fiber"
// @ts-expect-error temporary gui for now
import GUI from "lil-gui"
import { Mesh, type MeshStandardMaterial, TextureLoader } from "three"

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
    const gui = new GUI()
    if (materialRef.current) {
      gui.add(materialRef.current, "wireframe", 0, Math.PI * 2)
      gui.add(materialRef.current, "displacementScale", 0, 1, 0.1)
    }
    return () => {
      gui.destroy()
    }
  }, [])

  useEffect(() => {
    texture.anisotropy = gl.capabilities.getMaxAnisotropy()
  }, [texture, gl])

  useFrame((_, delta) => {
    if (
      typeof meshRef !== typeof Mesh &&
      meshRef.current?.rotation.y != undefined
    ) {
      meshRef.current.rotation.y += delta / 20
    }
  })

  return (
    <mesh ref={meshRef} castShadow={true} receiveShadow={true}>
      <sphereGeometry attach="geometry" args={[1, 128]} />
      <meshStandardMaterial
        ref={materialRef}
        wireframe={false}
        map={texture}
        displacementMap={displacementMap}
        displacementScale={0.5}
      />
    </mesh>
  )
}

export function Map() {
  const isBrowser = typeof window !== "undefined"

  return (
    isBrowser && (
      <div style={{ height: "400px" }}>
        <Canvas shadows camera={{ position: [0, 0, 1.75] }}>
          <Environment files="/img/venice_sunset_1k.hdr" />
          <directionalLight
            intensity={Math.PI}
            position={[4, 0, 2]}
            castShadow={true}
            shadow-mapSize-width={2048}
            shadow-mapSize-height={2048}
            shadow-camera-left={-2}
            shadow-camera-right={2}
            shadow-camera-top={-2}
            shadow-camera-bottom={2}
            shadow-camera-near={0.1}
            shadow-camera-far={7}
          />
          <Earth />
          <OrbitControls />
          <Stats />
        </Canvas>
      </div>
    )
  )
}
