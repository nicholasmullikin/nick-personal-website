const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  { load } = require("./lib/earth-source.cjs")
const { createLifetime } = load("lifetime.js")
test("disposal cancels delayed callbacks and unregisters listeners exactly once", async () => {
  const lifetime = createLifetime(),
    target = new EventTarget()
  let callbacks = 0,
    cleanup = 0
  lifetime.listen(target, "tick", () => callbacks++)
  lifetime.timeout(() => callbacks++, 20)
  lifetime.interval(() => callbacks++, 20)
  lifetime.own(() => cleanup++)
  target.dispatchEvent(new Event("tick"))
  assert.equal(callbacks, 1)
  lifetime.dispose()
  lifetime.dispose()
  target.dispatchEvent(new Event("tick"))
  await new Promise(resolve => setTimeout(resolve, 35))
  assert.equal(callbacks, 1)
  assert.equal(cleanup, 1)
  lifetime.own(() => cleanup++)
  assert.equal(cleanup, 2)
  assert.equal(lifetime.disposed, true)
})
