import React, { Suspense, useEffect, useMemo, useState } from "react"

import { OrbitControls, Splat } from "@react-three/drei"
import { Canvas, useLoader, useThree } from "@react-three/fiber"
import styled from "styled-components"
import * as THREE from "three"
import { PLYLoader } from "three/examples/jsm/loaders/PLYLoader.js"

const POINT_CLOUD_URL = "/blog/gaussian/points.ply"
const SPLAT_URL = "/blog/gaussian/scene.splat"

// antimatter15 .splat row layout: position (3×float32) | scale (3×float32)
// | rgba (4×u8) | rot quaternion (4×u8) = 32 bytes total.
const SPLAT_ROW = 32

type Axis = "x" | "y" | "z"
type Range_ = [number, number]
type Bounds = { x: Range_; y: Range_; z: Range_ }

// Use the 1st/99th percentile per axis instead of absolute min/max so the
// slider range is dominated by the populated region. Outlier splats far
// from the cloud (which usually look like stray speckles anyway) get hidden
// by the initial crop, and resetting goes back to the same trimmed view.
function computeExtent(buffer: ArrayBuffer): Bounds {
  const n = Math.floor(buffer.byteLength / SPLAT_ROW)
  const view = new DataView(buffer)
  const xs = new Float32Array(n)
  const ys = new Float32Array(n)
  const zs = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const off = i * SPLAT_ROW
    xs[i] = view.getFloat32(off, true)
    ys[i] = view.getFloat32(off + 4, true)
    zs[i] = view.getFloat32(off + 8, true)
  }
  xs.sort()
  ys.sort()
  zs.sort()
  const lo = Math.max(0, Math.floor(n * 0.01))
  const hi = Math.min(n - 1, Math.floor(n * 0.99))
  return {
    x: [xs[lo], xs[hi]],
    y: [ys[lo], ys[hi]],
    z: [zs[lo], zs[hi]],
  }
}

function filterSplats(buffer: ArrayBuffer, bounds: Bounds): ArrayBuffer {
  const n = Math.floor(buffer.byteLength / SPLAT_ROW)
  const view = new DataView(buffer)
  const src = new Uint8Array(buffer)
  const scratch = new Uint8Array(n * SPLAT_ROW)
  let kept = 0
  for (let i = 0; i < n; i++) {
    const off = i * SPLAT_ROW
    const x = view.getFloat32(off, true)
    const y = view.getFloat32(off + 4, true)
    const z = view.getFloat32(off + 8, true)
    if (
      x >= bounds.x[0] &&
      x <= bounds.x[1] &&
      y >= bounds.y[0] &&
      y <= bounds.y[1] &&
      z >= bounds.z[0] &&
      z <= bounds.z[1]
    ) {
      scratch.set(src.subarray(off, off + SPLAT_ROW), kept * SPLAT_ROW)
      kept++
    }
  }
  // Return a fresh ArrayBuffer-backed copy of just the kept rows so Blob
  // can consume it under the strict TS DOM typings.
  const out = new ArrayBuffer(kept * SPLAT_ROW)
  new Uint8Array(out).set(scratch.subarray(0, kept * SPLAT_ROW))
  return out
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

const CropWireframe = ({ bounds }: { bounds: Bounds }) => {
  const geometry = useMemo(() => {
    const w = Math.max(bounds.x[1] - bounds.x[0], 1e-4)
    const h = Math.max(bounds.y[1] - bounds.y[0], 1e-4)
    const d = Math.max(bounds.z[1] - bounds.z[0], 1e-4)
    return new THREE.EdgesGeometry(new THREE.BoxGeometry(w, h, d))
  }, [bounds])

  useEffect(() => () => geometry.dispose(), [geometry])

  const position: [number, number, number] = [
    (bounds.x[0] + bounds.x[1]) / 2,
    (bounds.y[0] + bounds.y[1]) / 2,
    (bounds.z[0] + bounds.z[1]) / 2,
  ]

  return (
    <lineSegments position={position} geometry={geometry}>
      <lineBasicMaterial color="#ff7a8a" transparent opacity={0.7} />
    </lineSegments>
  )
}

const CropControls = ({
  extent,
  crop,
  splatCount,
  onChange,
  onReset,
}: {
  extent: Bounds
  crop: Bounds
  splatCount: number
  onChange: (next: Bounds) => void
  onReset: () => void
}) => {
  const update = (axis: Axis, side: 0 | 1, raw: number) => {
    const [emin, emax] = extent[axis]
    const span = emax - emin
    const minGap = span * 0.01
    const [curLo, curHi] = crop[axis]
    const next: Range_ =
      side === 0
        ? [Math.max(emin, Math.min(raw, curHi - minGap)), curHi]
        : [curLo, Math.min(emax, Math.max(raw, curLo + minGap))]
    onChange({ ...crop, [axis]: next })
  }

  return (
    <Controls>
      {(["x", "y", "z"] as const).map(axis => {
        const [emin, emax] = extent[axis]
        const span = emax - emin
        const step = span / 200
        return (
          <Row key={axis}>
            <AxisLabel>{axis.toUpperCase()}</AxisLabel>
            <SliderPair>
              <input
                type="range"
                min={emin}
                max={emax}
                step={step}
                value={crop[axis][0]}
                onChange={e => update(axis, 0, +e.target.value)}
                aria-label={`${axis} min`}
              />
              <input
                type="range"
                min={emin}
                max={emax}
                step={step}
                value={crop[axis][1]}
                onChange={e => update(axis, 1, +e.target.value)}
                aria-label={`${axis} max`}
              />
            </SliderPair>
            <Readout>
              {crop[axis][0].toFixed(2)} … {crop[axis][1].toFixed(2)}
            </Readout>
          </Row>
        )
      })}
      <Row>
        <AxisLabel />
        <SplatCount>{splatCount.toLocaleString()} splats visible</SplatCount>
        <ResetButton type="button" onClick={onReset}>
          Reset
        </ResetButton>
      </Row>
    </Controls>
  )
}

const SplatViewer = () => {
  const [buffer, setBuffer] = useState<ArrayBuffer | null>(null)
  const [extent, setExtent] = useState<Bounds | null>(null)
  const [crop, setCrop] = useState<Bounds | null>(null)
  const [appliedCrop, setAppliedCrop] = useState<Bounds | null>(null)
  const [blobUrl, setBlobUrl] = useState<string | null>(null)
  const [splatCount, setSplatCount] = useState(0)
  const [loadError, setLoadError] = useState<Error | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch(SPLAT_URL)
      .then(r => {
        if (!r.ok) throw new Error(`${SPLAT_URL}: HTTP ${r.status}`)
        return r.arrayBuffer()
      })
      .then(buf => {
        if (cancelled) return
        const ext = computeExtent(buf)
        setBuffer(buf)
        setExtent(ext)
        setCrop(ext)
        setAppliedCrop(ext)
      })
      .catch(error_ => {
        if (!cancelled) setLoadError(error_ as Error)
      })
    return () => {
      cancelled = true
    }
  }, [])

  // Debounce the live crop into appliedCrop so we don't rebuild the splat
  // texture on every slider tick.
  useEffect(() => {
    if (!crop) return
    const t = setTimeout(() => setAppliedCrop(crop), 180)
    return () => clearTimeout(t)
  }, [crop])

  useEffect(() => {
    if (!buffer || !appliedCrop) return
    const data = filterSplats(buffer, appliedCrop)
    setSplatCount(Math.floor(data.byteLength / SPLAT_ROW))
    if (data.byteLength === 0) return
    const blob = new Blob([data], { type: "application/octet-stream" })
    const url = URL.createObjectURL(blob)
    setBlobUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [buffer, appliedCrop])

  if (loadError) throw loadError
  if (!buffer || !crop || !extent || !blobUrl) {
    return <LoadingSlot>Buffering scene.splat (~8 MB)…</LoadingSlot>
  }

  // Frame the camera on the populated extent. drei's <Splat> bypasses the
  // modelMatrix in its shader, so parent <group> transforms are ignored —
  // we work directly in data space and flip the camera up-vector instead of
  // rotating the splat.
  const cx = (extent.x[0] + extent.x[1]) / 2
  const cy = (extent.y[0] + extent.y[1]) / 2
  const cz = (extent.z[0] + extent.z[1]) / 2
  const radius =
    Math.max(
      extent.x[1] - extent.x[0],
      extent.y[1] - extent.y[0],
      extent.z[1] - extent.z[0],
    ) * 0.5
  const target: [number, number, number] = [cx, cy, cz]
  const distance = radius * 3
  const camPosition: [number, number, number] = [
    target[0] + distance * 0.9,
    target[1] + distance * 0.5,
    target[2] + distance * 0.9,
  ]
  const far = Math.max(1000, distance * 20)

  return (
    <>
      <Canvas
        camera={{
          position: camPosition,
          // COLMAP data has Y pointing down; flip the up vector so the cloud
          // renders right-side-up without having to transform the splat
          // itself (drei's <Splat> bypasses the modelMatrix).
          up: [0, -1, 0],
          fov: 45,
          near: 0.1,
          far,
        }}
        style={{ height: 480, background: "#0a0a0a", borderRadius: 8 }}
        gl={{ antialias: false }}
      >
        <Suspense fallback={null}>
          <Splat src={blobUrl} />
          <CropWireframe bounds={crop} />
        </Suspense>
        <OrbitControls makeDefault enableDamping target={target} />
      </Canvas>
      <CropControls
        extent={extent}
        crop={crop}
        splatCount={splatCount}
        onChange={setCrop}
        onReset={() => setCrop(extent)}
      />
    </>
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
          blobs survive. Drag to orbit; expect a couple seconds of load. Pull
          the X/Y/Z sliders below to crop into the cloud — the pink wireframe
          shows the active box, and visible splats are re-filtered on release.
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

const Controls = styled.div`
  display: flex;
  flex-direction: column;
  gap: var(--sizing-xs);
  margin-top: var(--sizing-sm);
  padding: var(--sizing-sm) var(--sizing-md);
  background: var(--color-gray-2);
  border-radius: 8px;
  font-size: 0.9rem;
`

const Row = styled.div`
  display: grid;
  grid-template-columns: 2ch 1fr auto;
  align-items: center;
  gap: var(--sizing-sm);
`

const AxisLabel = styled.span`
  font-family: var(--font-family-monospace, monospace);
  font-weight: var(--font-weight-semi-bold);
  color: #ff7a8a;
`

const SliderPair = styled.div`
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--sizing-xs);

  input[type="range"] {
    width: 100%;
    accent-color: #ff7a8a;
  }
`

const Readout = styled.span`
  font-family: var(--font-family-monospace, monospace);
  font-size: 0.85em;
  color: var(--color-gray-5);
  min-width: 12ch;
  text-align: right;
`

const SplatCount = styled.span`
  font-family: var(--font-family-monospace, monospace);
  font-size: 0.85em;
  color: var(--color-gray-5);
`

const ResetButton = styled.button`
  padding: 4px 12px;
  background: transparent;
  border: 1px solid var(--color-gray-4);
  border-radius: 4px;
  color: inherit;
  font: inherit;
  font-size: 0.85em;
  cursor: pointer;

  &:hover {
    background: var(--color-gray-3);
  }
`

export default GaussianSplatBlock
