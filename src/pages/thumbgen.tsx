import React, { Suspense } from "react"

import { OrbitControls, Splat } from "@react-three/drei"
import { Canvas } from "@react-three/fiber"

// Off-route renderer used only by scripts/render-splat-thumbnail.mjs to
// screenshot the center-cropped splat. Not linked from the site; the page is
// excluded from the sitemap and marked noindex.

const CENTER_SPLAT_URL = "/blog/gaussian/scene-center.splat"

const ThumbGen = () => {
  if (typeof window === "undefined") return null

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "transparent",
        margin: 0,
        padding: 0,
      }}
      data-testid="thumbgen-root"
    >
      <Canvas
        camera={{ position: [2.6, 1.6, 2.6], fov: 35, near: 0.01, far: 100 }}
        style={{ width: "100%", height: "100%" }}
        gl={{ antialias: false, alpha: true, preserveDrawingBuffer: true }}
      >
        <Suspense fallback={null}>
          <Splat src={CENTER_SPLAT_URL} rotation={[Math.PI, 0, 0]} />
        </Suspense>
        <OrbitControls makeDefault enableDamping={false} target={[0, 0, 0]} />
      </Canvas>
    </div>
  )
}

export default ThumbGen

export const Head = () => (
  <>
    <title>thumbgen</title>
    <meta name="robots" content="noindex,nofollow" />
    <style>{`html, body { margin: 0; padding: 0; background: transparent; }`}</style>
  </>
)
