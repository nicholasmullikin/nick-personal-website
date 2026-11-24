const { test } = require("node:test"), assert = require("node:assert/strict")
const { load, sourceRequire } = require("./lib/earth-source.cjs")
test("stationary cloud reuse expires and invalidates for view, light and data changes", () => {
  const THREE=sourceRequire("three"), { createCloudReuse }=load("cloud-reuse.js"), reuse=createCloudReuse(120)
  const state={camera:new THREE.Vector3(1,2,3),rotation:new THREE.Matrix3(),projection:new THREE.Matrix4(),sun:new THREE.Vector3(0,1,0),time:12,preset:10,coverage:new THREE.Texture(),noise:new THREE.Texture(),width:512,height:256,steps:40}
  assert.equal(reuse.canReuse(state,100),false);reuse.record(state,100)
  assert.equal(reuse.canReuse({...state,time:12.05},150),true)
  assert.equal(reuse.canReuse({...state,time:12.12},220),false)
  assert.equal(reuse.canReuse({...state,time:13},150),false)
  for(const changed of [
    {camera:state.camera.clone().addScalar(.001)}, {rotation:state.rotation.clone().rotate(.01)},
    {projection:state.projection.clone().makeScale(2,1,1)}, {sun:state.sun.clone().negate()},
    {coverage:new THREE.Texture()}, {noise:new THREE.Texture()}, {preset:1}, {width:513}, {height:257}, {steps:24},
  ]) assert.equal(reuse.canReuse({...state,...changed},150),false)
  state.noise.needsUpdate=true
  assert.equal(reuse.canReuse(state,150),false)
  reuse.invalidate();assert.equal(reuse.canReuse(state,150),false)
})
