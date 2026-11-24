const { test } = require("node:test")
const assert = require("node:assert/strict")
const { load } = require("./lib/earth-source.cjs")
const { scheduleCloudWind } = load("environment.js")

test("wind pacing responds to GPU cost, visibility and interaction, and disposes", () => {
  const original = {
    document: globalThis.document,
    performance: globalThis.performance,
    IntersectionObserver: globalThis.IntersectionObserver,
  }
  let now = 0,
    tick,
    observe,
    disconnected = false,
    updates = 0,
    gpu = 1,
    active = true
  const cleanup = []
  try {
    globalThis.performance = { now: () => now }
    globalThis.document = { hidden: false }
    globalThis.IntersectionObserver = class {
      constructor(callback) {
        observe = callback
      }
      observe() {}
      disconnect() {
        disconnected = true
      }
    }
    const map = {
      canvas: {},
      frameNumber: 0,
      cameraIsMoving: false,
      earth: { performance: { gpuFrameMs: () => gpu } },
      update() {
        updates++
        this.frameNumber++
      },
    }
    const lifetime = {
      own: fn => cleanup.push(fn),
      interval(fn) {
        tick = fn
        cleanup.push(() => {
          tick = null
        })
      },
    }
    scheduleCloudWind(map, lifetime, () => active)
    const run = count => {
      for (let i = 0; i < count; i++) {
        now += 50
        tick()
      }
    }
    run(10)
    assert.equal(updates, 10, "fast GPU keeps 20 Hz wind")
    now += 3000
    gpu = 40
    run(40)
    assert.ok(updates < 28, "slow GPU reduces autonomous frame requests")
    const slowed = updates
    map.cameraIsMoving = true
    run(4)
    assert.equal(updates, slowed + 4, "interaction is never throttled")
    observe([{ target: map.canvas, isIntersecting: false }])
    run(4)
    assert.equal(
      updates,
      slowed + 4,
      "offscreen canvas requests no wind frames",
    )
    observe([{ target: map.canvas, isIntersecting: true }])
    document.hidden = true
    run(4)
    assert.equal(updates, slowed + 4, "hidden document requests no wind frames")
    document.hidden = false
    active = false
    run(4)
    assert.equal(updates, slowed + 4, "disabled clouds request no wind frames")
    cleanup.reverse().forEach(fn => fn())
    assert.ok(disconnected)
    assert.equal(tick, null)
  } finally {
    Object.assign(globalThis, original)
  }
})
