#!/usr/bin/env node
// One-off Playwright smoke check for the gaussian-splats blog post.
//
//   1. Make sure `pnpm develop` is running on http://localhost:8000
//   2. node scripts/check-gaussian-post.mjs
//
// Walks one Chromium page through the four pipeline steps:
//   step 1: clip.webp <img> resolves and has non-zero pixels
//   step 2: at least 8 frame thumbnails return 200
//   step 3: points.ply returns 200 + point-cloud <canvas> mounts and renders
//   step 4: scene.splat returns 200 + splat <canvas> mounts and renders
//
// Prints a green/red summary per step. Exits non-zero if anything fails or
// if the browser console emits an error.

import { chromium } from "playwright"

const URL_ =
  process.env.GAUSSIAN_POST_URL || "http://localhost:8000/blog/gaussian-splats/"

const RED = s => `\x1b[31m${s}\x1b[0m`
const GREEN = s => `\x1b[32m${s}\x1b[0m`

const results = []
function step(name, ok, detail = "") {
  results.push({ name, ok, detail })
  const icon = ok ? GREEN("PASS") : RED("FAIL")
  console.log(`${icon} ${name}${detail ? "  — " + detail : ""}`)
}

const probe = await fetch(URL_, { method: "HEAD" }).catch(() => null)
if (!probe?.ok) {
  console.error(
    `${URL_} is not reachable. Start the dev server first:\n  pnpm develop`,
  )
  process.exit(2)
}

const errors = []
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage({
    viewport: { width: 1280, height: 900 },
  })
  page.on("pageerror", err => errors.push(`pageerror: ${err.message}`))
  page.on("console", msg => {
    if (msg.type() === "error") errors.push(`console.error: ${msg.text()}`)
  })

  const responses = new Map()
  page.on("response", resp => {
    const u = resp.url()
    if (u.includes("/blog/gaussian/")) responses.set(u, resp.status())
  })

  await page.goto(URL_, { waitUntil: "domcontentloaded", timeout: 60_000 })
  // gatsby develop's websocket keeps the page from ever being "idle"; wait
  // for the visible markdown to render instead.
  await page.locator("h2", { hasText: "Step 1" }).waitFor({ timeout: 30_000 })

  // The post is long; production has loading="lazy" on inline images. Scroll
  // top to bottom so every <img> enters the viewport and starts loading.
  await page.evaluate(async () => {
    const step = 600
    for (let y = 0; y < document.body.scrollHeight + step; y += step) {
      window.scrollTo(0, y)
      await new Promise(r => setTimeout(r, 100))
    }
    window.scrollTo(0, 0)
  })

  // Step 1 — clip.webp
  await page
    .locator("img[src*='clip.webp']")
    .first()
    .scrollIntoViewIfNeeded({ timeout: 5_000 })
  const clipImg = await page
    .locator("img[src*='clip.webp']")
    .first()
    .elementHandle()
  if (clipImg) {
    await clipImg
      .evaluate(
        img =>
          new Promise(resolve => {
            if (img.complete && img.naturalWidth) resolve()
            else {
              img.addEventListener("load", () => resolve(), { once: true })
              img.addEventListener("error", () => resolve(), { once: true })
              setTimeout(resolve, 8000)
            }
          }),
      )
      .catch(() => {})
  }
  const clipUrl = [...responses.keys()].find(u => u.endsWith("/clip.webp"))
  const clipDims = clipImg
    ? await clipImg.evaluate(img => ({
        natural: img.naturalWidth,
        rendered: img.getBoundingClientRect().width,
      }))
    : null
  step(
    "1. video clip.webp",
    !!clipImg &&
      !!clipDims &&
      clipDims.natural > 100 &&
      responses.get(clipUrl) === 200,
    clipDims
      ? `natural=${clipDims.natural}px, rendered=${Math.round(clipDims.rendered)}px`
      : "no <img> found",
  )

  // Step 2 — frame thumbnails
  const frameCount = await page
    .locator("img[src*='/blog/gaussian/frames/']")
    .count()
  // Give lazy-loaded thumbnails a chance to finish after the scroll above.
  await page
    .waitForFunction(
      () => {
        const imgs = [
          ...document.querySelectorAll("img[src*='/blog/gaussian/frames/']"),
        ]
        return imgs.length > 0 && imgs.every(i => i.complete && i.naturalWidth)
      },
      null,
      { timeout: 15_000 },
    )
    .catch(() => {})
  const okFrames = [...responses.keys()].filter(
    u => u.includes("/blog/gaussian/frames/") && responses.get(u) === 200,
  ).length
  step(
    "2. frame thumbnails",
    frameCount >= 8 && okFrames >= 8,
    `${frameCount} <img>, ${okFrames} returned 200`,
  )

  // Step 3 — point cloud (points.ply + first canvas renders)
  await page
    .locator("[data-testid='gs-point-cloud']")
    .scrollIntoViewIfNeeded({ timeout: 5_000 })
  const pcCanvas = page.locator("[data-testid='gs-point-cloud'] canvas").first()
  await pcCanvas.waitFor({ state: "visible", timeout: 10_000 })
  await page.waitForFunction(
    () =>
      [...performance.getEntriesByType("resource")].some(e =>
        e.name.endsWith("/points.ply"),
      ),
    null,
    { timeout: 20_000 },
  )
  const plyEntry = await page.evaluate(
    () =>
      [...performance.getEntriesByType("resource")]
        .filter(e => e.name.endsWith("/points.ply"))
        .map(e => ({ size: e.transferSize ?? e.encodedBodySize ?? 0 }))[0],
  )
  const pcOk = await pcCanvas.evaluate(c => {
    const gl = c.getContext("webgl2") || c.getContext("webgl")
    return c.width > 0 && c.height > 0 && !!gl
  })
  step(
    "3. COLMAP point cloud",
    !!plyEntry && pcOk,
    `points.ply ${plyEntry ? "loaded" : "missing"}, canvas ${
      pcOk ? "ok" : "blank"
    }`,
  )

  // Step 4 — splat (scene.splat + second canvas renders)
  await page
    .locator("[data-testid='gs-splat']")
    .scrollIntoViewIfNeeded({ timeout: 15_000 })
  const splatCanvas = page.locator("[data-testid='gs-splat'] canvas").first()
  await splatCanvas.waitFor({ state: "visible", timeout: 30_000 })
  await page.waitForFunction(
    () =>
      [...performance.getEntriesByType("resource")].some(e =>
        e.name.endsWith("/scene.splat"),
      ),
    null,
    { timeout: 30_000 },
  )
  await page.waitForTimeout(1500)
  const splatEntry = await page.evaluate(
    () =>
      [...performance.getEntriesByType("resource")]
        .filter(e => e.name.endsWith("/scene.splat"))
        .map(e => ({ size: e.transferSize ?? e.encodedBodySize ?? 0 }))[0],
  )
  const splatOk = await splatCanvas.evaluate(c => {
    const gl = c.getContext("webgl2") || c.getContext("webgl")
    return c.width > 0 && c.height > 0 && !!gl
  })
  step(
    "4. trained 3DGS",
    !!splatEntry && splatOk,
    `scene.splat ${splatEntry ? "loaded" : "missing"}, canvas ${
      splatOk ? "ok" : "blank"
    }`,
  )

  // Step 5 — no console errors
  step(
    "5. no console errors",
    errors.length === 0,
    errors.length ? `${errors.length} issue(s)` : "clean",
  )
  if (errors.length) errors.forEach(e => console.log("  · " + e))
} finally {
  await browser.close()
}

const failed = results.filter(r => !r.ok)
console.log("")
console.log(
  failed.length
    ? RED(`${failed.length} of ${results.length} step(s) failed`)
    : GREEN(`all ${results.length} steps passed`),
)
process.exit(failed.length ? 1 : 0)
