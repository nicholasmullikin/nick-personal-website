import React, { Suspense, useEffect, useMemo, useRef, useState } from "react"

import { OrbitControls, Splat } from "@react-three/drei"
import { Canvas, useLoader, useThree } from "@react-three/fiber"
import styled from "styled-components"
import * as THREE from "three"
import { PLYLoader } from "three/examples/jsm/loaders/PLYLoader.js"

const POINT_CLOUD_URL = "/blog/gaussian/points.ply"
const SPLAT_URL = "/blog/gaussian/scene.splat"

// drei's <Splat> hard-requires response.headers.get("Content-Length") on the
// initial fetch to compute numVertices, and Vercel (and most other CDNs)
// strip Content-Length when they apply brotli/gzip to the response. To stay
// CDN-agnostic we pre-fetch the splat into memory, wrap it in a Blob URL
// (which always exposes a correct Content-Length), and hand that to drei.
function useBlobUrl(url: string) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null)
  const [error, setError] = useState<Error | null>(null)
  const aborted = useRef(false)

  useEffect(() => {
    aborted.current = false
    let createdUrl: string | null = null
    fetch(url)
      .then(r => {
        if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`)
        return r.arrayBuffer()
      })
      .then(buf => {
        if (aborted.current) return
        const blob = new Blob([buf], { type: "application/octet-stream" })
        createdUrl = URL.createObjectURL(blob)
        setBlobUrl(createdUrl)
      })
      .catch(error_ => {
        if (!aborted.current) setError(error_ as Error)
      })
    return () => {
      aborted.current = true
      if (createdUrl) URL.revokeObjectURL(createdUrl)
    }
  }, [url])

  return { blobUrl, error }
}

// One viewer crashing (e.g. drei's Splat throwing because a CDN stripped
// Content-Length during brotli encoding) shouldn't take down the other.
class ViewerBoundary extends React.Component<
  { children: React.ReactNode; label: string },
  { error: Error | null }
> {
  state = { error: null as Error | null }
  static getDerivedStateFromError(error: Error) {
    return { error }
  }
  componentDidCatch(error: Error) {
    console.error("GaussianSplatBlock viewer failed:", error)
  }
  render() {
    if (this.state.error) {
      return (
        <ErrorSlot>
          {this.props.label} failed to load:{" "}
          <code>{String(this.state.error.message || this.state.error)}</code>
        </ErrorSlot>
      )
    }
    return this.props.children
  }
}

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

const SplatViewer = () => {
  const { blobUrl, error } = useBlobUrl(SPLAT_URL)

  if (error) throw error
  if (!blobUrl) {
    return <LoadingSlot>Buffering scene.splat (~8 MB)…</LoadingSlot>
  }

  return (
    <Canvas
      camera={{ position: [3, 1.5, 3], fov: 45, near: 0.01, far: 1000 }}
      style={{ height: 480, background: "#0a0a0a", borderRadius: 8 }}
      gl={{ antialias: false }}
    >
      <Suspense fallback={null}>
        <Splat src={blobUrl} rotation={[Math.PI, 0, 0]} />
      </Suspense>
      <OrbitControls makeDefault enableDamping />
    </Canvas>
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
        <ViewerBoundary label="Point cloud">
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
        </ViewerBoundary>
      </Slot>
      <Slot data-testid="gs-splat">
        <h3>Trained 3D Gaussian Splat</h3>
        <Description>
          The full splat is 736 MB. This is a decimated 250k-splat slice (~8 MB)
          kept by sorting on <code>opacity × volume</code> so the high-impact
          blobs survive. Drag to orbit; expect a couple seconds of load.
        </Description>
        <ViewerBoundary label="Splat">
          <SplatViewer />
        </ViewerBoundary>
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

const ErrorSlot = styled.div`
  padding: var(--sizing-md);
  border: 1px solid var(--color-gray-3);
  border-radius: 8px;
  background: var(--color-gray-2);
  font-size: 0.9rem;

  code {
    word-break: break-all;
  }
`

const LoadingSlot = styled.div`
  height: 480px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #0a0a0a;
  color: var(--color-gray-5);
  border-radius: 8px;
`

export default GaussianSplatBlock
