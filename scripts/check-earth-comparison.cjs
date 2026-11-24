const { chromium, firefox } = require("playwright")
const {
  previewURL,
  mapboxToken,
  installProbe,
  browserErrors,
  reportFailure,
} = require("./lib/earth-browser.cjs")
const assert = require("node:assert/strict")
;(async () => {
  for (const [name, engine] of [
    ["chromium", chromium],
    ["firefox", firefox],
  ]) {
    const b = await engine.launch()
    try {
      const page = await b.newPage({ viewport: { width: 900, height: 500 } })
      const errors = browserErrors(page)
      const resources = []
      page.on("request", r => resources.push(new URL(r.url()).pathname))
      await installProbe(page)
      // Exercise the configured API path with a test double, and the keyless path in Firefox.
      const keyed = name === "chromium"
      if (keyed)
        await page.route("https://maps.googleapis.com/maps/api/js?**", route =>
          route.fulfill({
            contentType: "text/javascript",
            body: "window.google={maps:{event:{clearInstanceListeners(){}},Map:class{setCenter(c){this.c=c}setZoom(z){this.z=z}getCenter(){return {toJSON:()=>this.c}}getZoom(){return this.z}}}};",
          }),
        )
      await page.goto(
        previewURL +
          "/harp/rendering_globe-atmosphere.html?mapbox_token=" +
          (await mapboxToken()) +
          (keyed ? "&google_maps_key=browser-test" : ""),
      )
      await page.waitForFunction(() => window.probe?.map)
      assert(
        !resources.some(
          p => p.includes("santa-barbara-google") || p === "/maps/api/js",
        ),
      )
      await page.getByRole("button", { name: "Layers", exact: true }).click()
      const layer = page.getByLabel("Layer", { exact: true })
      await layer.selectOption("reference")
      await page.waitForFunction(
        () =>
          window.probe.map.visibleTileSet.dataSourceTileList.some(
            e =>
              e.dataSource.name === "terrain" &&
              Array.from(e.renderedTiles.values()).some(t =>
                t.objects.some(
                  o =>
                    o.material?.defines?.EARTH_REFERENCE &&
                    o.material.uniforms.referenceMap.value.image.width === 1621,
                ),
              ),
          ) && Math.abs(window.probe.map.target.latitude - 34.40539) < 0.002,
      )
      const bounds = await page.evaluate(() => {
        const m = window.probe.map
        const p = m.getScreenPosition({
          latitude: 34.40539,
          longitude: -119.77037,
        })
        return {
          west: p.x,
          expected:
            (innerWidth -
              1621 * Math.min(innerWidth / 1621, innerHeight / 883)) /
            2,
          lat: m.target.latitude,
          lon: m.target.longitude,
        }
      })
      assert(Math.abs(bounds.west - bounds.expected) < 8)

      await layer.selectOption("c")
      assert(await page.locator(".earth-compare-surface").isHidden())
      const a = page.getByRole("link", { name: /Open live Google/ })
      await a.focus()
      const url = new URL(await a.getAttribute("href"))
      assert.equal(url.searchParams.get("basemap"), "terrain")
      assert(
        Math.abs(
          Number(url.searchParams.get("center").split(",")[1]) + 119.724,
        ) < 0.002,
      )
      // The reference is a texture on the mesh. Switching back to it at
      // an oblique angle must leave the camera and pointer controls available.
      await page.evaluate(() =>
        window.probe.map.lookAt({ tilt: 50, heading: 15 }),
      )
      await layer.selectOption("reference")
      assert(await page.locator(".earth-compare-surface").isHidden())
      assert(
        Math.abs((await page.evaluate(() => window.probe.map.tilt)) - 50) < 1,
      )
      await layer.selectOption("c")
      if (keyed) {
        await layer.selectOption("live")
        await page.waitForFunction(
          () =>
            window.google?.maps &&
            !document.querySelector(".earth-compare-message").textContent,
        )
        await layer.selectOption("a")
      }
      await page.setViewportSize({ width: 375, height: 640 })
      await layer.selectOption("reference")
      await page.getByRole("button", { name: "Done", exact: true }).click()
      assert(
        await page
          .getByRole("button", { name: "Layers", exact: true })
          .isVisible(),
      )
      assert.deepEqual(errors, [])
      console.log(name, "passed")
    } finally {
      await b.close()
    }
  }
})().catch(reportFailure)
