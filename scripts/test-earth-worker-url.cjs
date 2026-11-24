const { test } = require("node:test")
const assert = require("node:assert/strict")
const { load } = require("./lib/earth-source.cjs")
const { earthWorkerUrl } = load("worker-url.js")
test("workers use a validated build-pinned URL and support old HTML", () => {
  const previous = global.document
  try {
    delete global.document
    assert.equal(earthWorkerUrl("earth-decoder"), "earth-decoder.bundle.js")
    global.document = { querySelector: selector => {
      assert.equal(selector, 'meta[name="earth-worker-earth-decoder"]')
      return { content: "earth-decoder.123456abcdef.js" }
    } }
    assert.equal(earthWorkerUrl("earth-decoder"), "earth-decoder.123456abcdef.js")
    global.document.querySelector = () => ({ content: "https://example.com/worker.js" })
    assert.equal(earthWorkerUrl("earth-decoder"), "earth-decoder.bundle.js")
    assert.throws(() => earthWorkerUrl('../unsafe'), /Invalid/)
  } finally {
    if (previous === undefined) delete global.document
    else global.document = previous
  }
})
