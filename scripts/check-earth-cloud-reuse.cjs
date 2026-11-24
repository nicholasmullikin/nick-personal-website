// Reused cloud targets must keep the same composite set and invalidate on motion.
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path")
const { chromium, firefox } = require("playwright")
const { previewURL, mapboxToken, installProbe, browserErrors, reportFailure } = require("./lib/earth-browser.cjs")
async function main() {
  const token=await mapboxToken()
  for(const [name,engine,launch] of [
    ["chromium",chromium,{args:["--use-angle=swiftshader","--enable-unsafe-swiftshader"]}],
    ["firefox-webgl1",firefox,{firefoxUserPrefs:{"webgl.enable-webgl2":false}}],
  ]) {
    const browser=await engine.launch(launch)
    try {
      const context=await browser.newContext({viewport:{width:320,height:240}}),assets=process.env.EARTH_ASSET_DIR
      if(assets) {
        const shared=fs.readdirSync(assets).find(name=>/^earth-shared\..*\.js$/.test(name));assert.ok(shared)
        await context.route("**/harp/*.js*",route=>{
          let name=new URL(route.request().url()).pathname.split("/").pop();if(name.startsWith("earth-shared."))name=shared
          const file=path.join(assets,name);return fs.existsSync(file)?route.fulfill({path:file,contentType:"application/javascript"}):route.continue()
        })
      }
      const page=await context.newPage(),errors=browserErrors(page);await installProbe(page)
      await page.goto(`${previewURL}/harp/rendering_globe-atmosphere.html?mapbox_token=${token}`)
      await page.waitForFunction(()=>window.probe?.map.earth.environment.status.noiseReady,null,{timeout:60000})
      const result=await page.evaluate(()=>{
        const m=window.probe.map,e=m.earth.environment
        e.setCloudQuality("low");e.setClouds(true);e.setCloudPreset(10)
        const meshes=()=>m.scene.children.filter(o=>o.renderOrder>=11000&&o.renderOrder<=11004)
        function view(local) {m.lookAt(local?{target:{latitude:49.95,longitude:-123.04,altitude:1650},distance:1800,tilt:76,heading:330}:{target:{latitude:20,longitude:-30},distance:11000000,tilt:0,heading:0});m.renderSync()}
        view(false);const orbital=meshes().map(o=>o.visible)
        const before=e.cloudStats.reused
        for(let i=0;i<5;i++)m.renderSync()
        const after=e.cloudStats.reused,afterReuse=meshes().map(o=>o.visible)
        view(true);const local=meshes().map(o=>o.visible),draws=e.cloudStats.draws
        m.lookAt({target:{latitude:49.95,longitude:-123.04,altitude:1650},distance:1800,tilt:76,heading:335});m.renderSync()
        const moved=e.cloudStats.draws>draws
        e.setClouds(false);m.renderSync();const off=meshes().every(o=>!o.visible)
        e.setClouds(true);m.renderSync();const restored=meshes().map(o=>o.visible)
        return {lowResolution:e.cloudStats.lowResolution,orbital,afterReuse,local,restored,reused:after-before,moved,off}
      })
      if(result.lowResolution) {
        assert.deepEqual(result.orbital,[true,false,false,false,false],`${name}: orbital composite`)
        assert.deepEqual(result.afterReuse,result.orbital,`${name}: reuse changed composite visibility`)
        assert.deepEqual(result.local,[false,true,true,true,true],`${name}: local composites`)
        assert.deepEqual(result.restored,result.local,`${name}: cloud toggle restored the wrong composites`)
        assert.ok(result.reused>0,`${name}: stationary frame was not reused`)
        assert.equal(result.moved,true,`${name}: camera motion did not invalidate clouds`)
      }
      assert.equal(result.off,true,`${name}: disabled clouds are visible`);assert.deepEqual(errors,[])
      console.log(name,JSON.stringify(result))
    } finally {await browser.close()}
  }
}
main().catch(reportFailure)
