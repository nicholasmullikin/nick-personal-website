const { test } = require("node:test"), assert = require("node:assert/strict"), path = require("node:path"), { pathToFileURL } = require("node:url")
const { source, sourceRequire, load } = require("./lib/earth-source.cjs")
async function raster() { return import(pathToFileURL(path.join(source, "road-raster.mjs")).href) }
async function fixture() {
  const { default: Pbf } = await import(sourceRequire.resolve("pbf")), p = new Pbf()
  p.writeMessage(3, (_, layer) => {
    layer.writeStringField(1, "transportation"); layer.writeVarintField(15, 2); layer.writeVarintField(5, 4096)
    for (const [id, row, tags] of [[1, 512, [0, 0]], [2, 1024, [0, 1]], [3, 2048, [0, 0, 1, 2]], [4, 3072, [0, 0, 2, 3]]])
      layer.writeMessage(2, (_, feature) => {
        feature.writeVarintField(1, id); feature.writeVarintField(3, 2); feature.writePackedVarint(2, tags)
        const zz = n => (n << 1) ^ (n >> 31)
        feature.writePackedVarint(4, [9, zz(64), zz(row), 10, zz(3968), zz(0)])
      }, null)
    for (const key of ["class", "brunnel", "lit"]) layer.writeStringField(3, key)
    for (const value of ["primary", "path", "tunnel", "no"]) layer.writeMessage(4, (_, v) => v.writeStringField(1, value), null)
  }, null)
  return p.finish().buffer
}
test("road raster keeps major mapped roads and rejects tunnels, unlit and paths", async () => {
  const { rasterRoads, roadStrength } = await raster()
  assert.ok(roadStrength({ class: "primary", lit: "yes" }) > roadStrength({ class: "primary" }))
  assert.equal(roadStrength({ class: "primary", surface: "unpaved" }), 0)
  assert.equal(roadStrength({ class: "primary", brunnel: "bridge" }), 0)
  const { mask, features } = rasterRoads(await fixture())
  assert.equal(features, 1); assert.ok(mask.subarray(31*256,34*256).some(Boolean))
  assert.equal(mask.subarray(63*256,66*256).some(Boolean), false)
  assert.equal(mask.subarray(127*256,130*256).some(Boolean), false)
  assert.equal(mask.subarray(191*256,194*256).some(Boolean), false)
})
test("optional roads load only at night and dispose their bounded mask", async () => {
  const THREE = sourceRequire("three"), { createRoads } = load("roads.js")
  const previous = { Worker: global.Worker, fetch: global.fetch, document: global.document }
  let calls=0, terminated=0
  global.document = { hidden: false, baseURI: "https://example.test/harp/earth.html" }
  global.Worker = class {
    postMessage({ id }) { queueMicrotask(() => this.onmessage({ data: { id, mask: new Uint8Array(256*256).fill(3), features: 1 } })) }
    terminate() { terminated++ }
  }
  global.fetch = async url => { calls++; return url.endsWith("/planet") ? { ok:true, json:async()=>({tiles:["https://tiles.test/{z}/{x}/{y}"]}) } : { ok:true, arrayBuffer:async()=>new ArrayBuffer(1) } }
  try {
    const map={ target:{latitude:0,longitude:0},camera:{position:new THREE.Vector3(6378137+2000,0,0)},renderer:{capabilities:{maxTextures:16,isWebGL2:false}},update(){} }
    const sky={uniforms:{sunDirection:{value:new THREE.Vector3(1,0,0)}}}, env={uniforms:{lightsEnabled:{value:1}}}
    const roads=createRoads(THREE,map,sky,env)
    roads.update("a"); assert.equal(calls,0)
    roads.setEnabled(true); roads.update("a"); assert.equal(calls,0)
    const material={defines:{EARTH_DETAIL_SLOTS:4},userData:{},uniforms:{roadAtlas:{value:null},roadUv:{value:new THREE.Vector4()}}}
    roads.bind(material,{level:14,column:8192,row:8192})
    sky.uniforms.sunDirection.value.x=-1; roads.update("a")
    for(let i=0;i<40 && !roads.stats.active;i++) await new Promise(resolve=>setTimeout(resolve,0))
    assert.equal(roads.stats.active,true); assert.equal(roads.stats.requests,9); assert.equal(roads.stats.cache,9)
    assert.equal(calls,10, "one shared metadata request plus nine tiles")
    assert.equal(material.defines.EARTH_STYLIZED_ROADS,1, "visible materials bind when the atlas arrives"); assert.equal(material.defines.EARTH_DETAIL_SLOTS,3)
    roads.bind(material,{level:14,column:8192,row:8192},4)
    assert.equal(material.defines.EARTH_DETAIL_SLOTS,4, "spare sampler retains all imagery slots")
    roads.setEnabled(false); roads.bind(material,{level:14,column:8192,row:8192})
    assert.equal(material.defines.EARTH_STYLIZED_ROADS,undefined); assert.equal(material.defines.EARTH_DETAIL_SLOTS,4)
    assert.equal(roads.stats.cache,0); assert.equal(terminated,1); roads.dispose()
  } finally { for(const [k,v] of Object.entries(previous)) if(v===undefined)delete global[k]; else global[k]=v }
})
test("hiding or disabling roads aborts in-flight work without starting a worker", async () => {
  const THREE = sourceRequire("three"), { createRoads } = load("roads.js")
  const previous = { Worker: global.Worker, fetch: global.fetch, document: global.document }
  let aborted=0, workers=0
  const listeners={}
  global.document={hidden:false,baseURI:"https://example.test/harp/earth.html",addEventListener:(name,fn)=>{listeners[name]=fn},removeEventListener:name=>{delete listeners[name]}}
  global.Worker=class { constructor() { workers++ } terminate() {} }
  global.fetch=(url,{signal})=>url.endsWith("/planet")
    ? Promise.resolve({ok:true,json:async()=>({tiles:["https://tiles.test/{z}/{x}/{y}"]})})
    : new Promise((resolve,reject)=>signal.addEventListener("abort",()=>{aborted++;reject(new Error("cancelled"))},{once:true}))
  try {
    const map={target:{latitude:0,longitude:0},camera:{position:new THREE.Vector3(6380137,0,0)},renderer:{capabilities:{maxTextures:16}},update(){}}
    const roads=createRoads(THREE,map,{uniforms:{sunDirection:{value:new THREE.Vector3(-1,0,0)}}},{uniforms:{lightsEnabled:{value:1}}})
    roads.setEnabled(true);roads.update("a")
    for(let i=0;i<20 && roads.stats.requests<3;i++) await new Promise(resolve=>setTimeout(resolve,0))
    assert.equal(roads.stats.requests,3)
    global.document.hidden=true;listeners.visibilitychange()
    await new Promise(resolve=>setTimeout(resolve,0))
    assert.equal(aborted,3);assert.equal(workers,0);assert.equal(roads.stats.active,false);assert.equal(roads.stats.enabled,true)
    roads.setEnabled(false);assert.equal(listeners.visibilitychange,undefined)
    roads.dispose()
  } finally { for(const [k,v] of Object.entries(previous)) if(v===undefined)delete global[k]; else global[k]=v }
})
