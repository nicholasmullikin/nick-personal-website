const test = require("node:test")
const assert = require("node:assert/strict")
const { load } = require("./lib/earth-source.cjs")
const { decodeCloudGrid, width, height } = load("forecast-grid.js")
const { makeTexture } = load("forecast-worker.js")

// A constant cover field, with the two initial values and minimum difference
// stored explicitly as required by GRIB2 template 5.3.
function constantField(order) {
  function section(id, n) {
    const b = Buffer.alloc(n)
    b.writeUInt32BE(n)
    b[4] = id
    return b
  }
  const grid = section(3, 72)
  grid.writeUInt32BE(width, 30)
  grid.writeUInt32BE(height, 34)
  grid.writeUInt32BE(90000000, 46)
  grid.writeUInt32BE(1000000, 63)
  grid.writeUInt32BE(1000000, 67)
  const product = section(4, 34)
  product[9] = 6
  product[10] = 3
  const packing = section(5, 49)
  packing.writeUInt32BE(width * height, 5)
  packing.writeUInt16BE(3, 9)
  packing[21] = 1
  packing.writeUInt32BE(1, 31)
  packing.writeUInt32BE(width * height, 42)
  packing[47] = order
  packing[48] = 1
  const bitmap = section(6, 6)
  bitmap[5] = 255
  const payload = section(7, 5 + order + 1)
  payload.fill(40, 5, 5 + order)
  const message = Buffer.concat([
    Buffer.alloc(16), grid, product, packing, bitmap, payload, Buffer.from("7777"),
  ])
  message.write("GRIB")
  message[7] = 2
  message.writeUInt32BE(message.length, 12)
  return message.buffer.slice(message.byteOffset, message.byteOffset + message.byteLength)
}

test("GFS cloud fractions reconstruct both supported spatial difference orders", () => {
  for (const order of [1, 2]) {
    const frame = constantField(order)
    const grid = decodeCloudGrid(frame)
    assert.equal(grid.length, width * height)
    assert.ok(grid.every(n => n === 102))
    assert.throws(() => decodeCloudGrid(frame.slice(0, -4)))
    const corrupt = frame.slice(0)
    new DataView(corrupt).setUint32(16 + 72 + 34 + 42, width * height + 1)
    assert.throws(() => decodeCloudGrid(corrupt), /group lengths/)
  }
})

test("forecast texture puts southern rows first and crosses Greenwich continuously", () => {
  const f = new Uint8Array(width * height)
  for (let y = 0; y < height; y++) f.fill(y, y * width, (y + 1) * width)
  const g = Uint8Array.from(f, (_, i) => Math.min(i % width, width - i % width))
  const t = makeTexture([f, g, new Uint8Array(f.length).fill(17)])
  const pixel = (x, y, channel) => t.rgba[(y*t.width+x)*4+channel]
  assert.equal(pixel(t.width/2,0,0),180)
  assert.equal(pixel(t.width/2,t.height-1,0),0)
  assert.ok(pixel(t.width/2,0,1) <= 1)
  assert.ok(pixel(0,0,1) >= 179)
  assert.equal(pixel(0,0,1),pixel(t.width-1,0,1))
  assert.equal(pixel(10,10,2),17)
  assert.equal(pixel(10,10,3),255)
})
