import React, { Suspense, useMemo } from "react"

import { OrbitControls, Splat } from "@react-three/drei"
import { Canvas, useLoader, useThree } from "@react-three/fiber"
import styled from "styled-components"
import * as THREE from "three"
import { PLYLoader } from "three/examples/jsm/loaders/PLYLoader.js"

const POINT_CLOUD_URL = "/blog/gaussian/points.ply"
const SPLAT_URL = "/blog/gaussian/scene.splat"

const PointCloud = () => {
  const geometry = useLoader(PLYLoader, POINT_CLOUD_URL) as THREE.BufferGeometry
  const camera = useThree(state => state.camera)

  const { centered, target, distance } = useMemo(() => {
    geometry.computeBoundingBox()
    geometry.computeBoundingSphere()
    const bb = geometry.boundingBox!
    const center = new THREE.Vector3()
    bb.getCenter(center)
    const cloned = geometry.clone()
    cloned.translate(-center.x, -center.y, -center.z)
    const radius = geometry.boundingSphere?.radius ?? 1
    return {
      centered: cloned,
      target: new THREE.Vector3(0, 0, 0),
      distance: radius * 2.2,
    }
  }, [geometry])

  React.useEffect(() => {
    camera.position.set(distance, distance * 0.5, distance)
    camera.lookAt(target)
    camera.updateProjectionMatrix()
  }, [camera, distance, target])

  return (
    <points geometry={centered} frustumCulled={false}>
      <pointsMaterial size={0.015} sizeAttenuation vertexColors />
    </points>
  )
}

const GaussianSplatBlock = () => {
  if (typeof window === "undefined") return null

  return (
    <Stack>
      <Slot data-testid="gs-point-cloud">
        <h3>COLMAP sparse point cloud</h3>
        <Description>
          The ~67k 3D points triangulated from feature matches across the
          frames, colored from their image observations. Drag to orbit.
        </Description>
        <Canvas
          camera={{ position: [3, 1.5, 3], fov: 45, near: 0.01, far: 1000 }}
          style={{ height: 400, background: "#0a0a0a", borderRadius: 8 }}
          gl={{ antialias: true }}
        >
          <Suspense fallback={null}>
            <PointCloud />
          </Suspense>
          <OrbitControls makeDefault enableDamping />
        </Canvas>
      </Slot>
      <Slot data-testid="gs-splat">
        <h3>Trained 3D Gaussian Splat</h3>
        <Description>
          The full splat is 736 MB. This is a decimated 250k-splat slice (~8 MB)
          kept by sorting on <code>opacity × volume</code> so the high-impact
          blobs survive. Drag to orbit; expect a couple seconds of load.
        </Description>
        <Canvas
          camera={{ position: [3, 1.5, 3], fov: 45, near: 0.01, far: 1000 }}
          style={{ height: 480, background: "#0a0a0a", borderRadius: 8 }}
          gl={{ antialias: false }}
        >
          <Suspense fallback={null}>
            <Splat src={SPLAT_URL} rotation={[Math.PI, 0, 0]} />
          </Suspense>
          <OrbitControls makeDefault enableDamping />
        </Canvas>
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

export default GaussianSplatBlock
