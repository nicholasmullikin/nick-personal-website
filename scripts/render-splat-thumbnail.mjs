#!/usr/bin/env node
// One-off thumbnail renderer for the gaussian-splats blog post.
//
//   1. Make sure `pnpm develop` is running on http://localhost:8000
//   2. node scripts/render-splat-thumbnail.mjs
//
// It opens /thumbgen/ headlessly, waits for the center-cropped splat to
// finish loading, and screenshots the canvas to
// src/posts/blog/images/gaussian-splats/thumbnail.png. Run when you re-
// shoot the dataset; the thumbnail itself is committed to the repo.

import { mkdirSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import { chromium } from "playwright"

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const OUT = resolve(
  REPO_ROOT,
  "src/posts/blog/images/gaussian-splats/thumbnail.png",
)
const URL_ = process.env.THUMBGEN_URL || "http://localhost:8000/thumbgen/"
const WIDTH = Number(process.env.THUMBGEN_WIDTH || 1200)
const HEIGHT = Number(process.env.THUMBGEN_HEIGHT || 630)

const probe = await fetch(URL_, { method: "HEAD" }).catch(() => null)
if (!probe?.ok) {
  console.error(
    `thumbgen: ${URL_} is not reachable. Start the dev server first:\n  pnpm develop`,
  )
  process.exit(2)
}

mkdirSync(dirname(OUT), { recursive: true })

const browser = await chromium.launch({ headless: true })
try {
  const ctx = await browser.newContext({
    viewport: { width: WIDTH, height: HEIGHT },
    deviceScaleFactor: 2,
  })
  const page = await ctx.newPage()
  page.on("pageerror", err => console.error("pageerror:", err.message))
  page.on("console", msg => {
    if (msg.type() === "error") console.error("console.error:", msg.text())
  })

  const splatResponse = page.waitForResponse(
    r => r.url().includes("scene-center.splat") && r.status() === 200,
    { timeout: 30_000 },
  )
  await page.goto(URL_, { waitUntil: "domcontentloaded" })
  await splatResponse

  await page.waitForFunction(
    () => {
      const c = document.querySelector("canvas")
      if (!c) return false
      const gl = c.getContext("webgl2") || c.getContext("webgl")
      return c.width > 0 && c.height > 0 && !!gl
    },
    null,
    { timeout: 15_000 },
  )
  // Worker sort + several frames of OrbitControls damping.
  await page.waitForTimeout(2500)

  await page.locator("canvas").first().screenshot({
    path: OUT,
    omitBackground: true,
  })
  console.log("wrote", OUT)
} finally {
  await browser.close()
}
