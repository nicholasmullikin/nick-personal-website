# Earth renderer maintenance

The Earth renderer is authored in the sibling `xyz-threejs` checkout. This site embeds the built example and owns browser capability checks, the 2D fallbacks, and asset validation. Do not edit the generated files in `static/harp`.

## Source and ownership

- `../xyz-threejs/@xyzmaps/harp-examples/src/earth/main.ts` creates the map, terrain source, controls, lifecycle listeners, and the compatibility facade `map.earth`.
- The runtime coordinates imagery, elevation sampling, buildings, atmosphere, environment, and UI modules. Materials are created through `DataSource.createTileMaterial`; harp tiles own geometry and material disposal. Shared imagery textures belong to the imagery resource manager. Effect textures belong to the effects subsystem.
- Terrain and buildings both use `TileDataSource`, `DataProvider`, harp's worker services, and the native visible-tile/cache lifecycle. Building footprint decoding produces `DecodedTile` buffers and a shader technique; the separate building worker and its independent tile cache have been retired.
- `prepareRenderTiles` runs after tile selection and geometry creation, before drawing. Terrain continuity updates only when the mesh signature changes; imagery uniforms update before the first visible draw. `beforeCameraUpdate` applies camera clearance before camera matrices and visibility are computed.
- The browser's `earth-ready` event carries `{map, THREE}`. Regression tests attach a listener before navigation; production code does not publish a global map. `map.earth` remains the controls/diagnostics facade.

The older `globe-atmosphere` source directory contains pre-existing local work and is preserved. The served example delegates to `earth/main.ts`; the older implementation is not bundled.

## Coordinate and rendering conventions

Harp world coordinates and geometry use meters. Atmosphere shaders use kilometers. Camera-relative shader coordinates reconstruct ECEF world position from the relative object transform and the true camera position. Terrain vertices use the tile's local tangent frame; building vertices use world-axis offsets from the decoded tile center. Mercator rows must not be interpolated linearly in latitude.

The frame order is camera protection, harp tile selection/creation, continuity and uniform preparation, the bounded cloud volume/reconstruction passes, opaque terrain/buildings, sky where depth is unobstructed, and transparent cloud compositing with logarithmic depth. The fallback globe uses a geographic anchor at Earth's center. Background and polar data sources are explicitly disabled because the fallback globe provides that coverage; other application sources are not hidden.

`prepareRenderTiles` runs once in the render path. Tile-change queries must not
call it: doing so duplicates the atmosphere/cloud work and advances simulation
clocks twice per frame.

The native geometry cache uses a 200 MiB soft budget shared by data sources. Visible tiles are pinned and may exceed that budget in dense cities. Tests check that unused geometry is evicted rather than requiring visible buildings to disappear. Imagery separately keeps a 96 MiB estimated RGBA/mipmap budget, a 160-entry ceiling, and at most eight requests. Visible and transition textures remain pinned, so this is a soft budget. `stats.cacheBytes` reports cached tile residency separately from the global image and effect targets. Ancestor requests stop at the nearest loaded tile so evicted lower-resolution ancestors are not continuously refetched in large views; buildings permit four network requests through an abort-aware provider.

## Clouds

`environment.js` owns the NASA coverage/night textures and wind clock. `cloud-model.js` defines the ten WMO genera, latitude-adjusted height profiles, regional weather selection, density, conservative horizon/latitude bounds, and quality budgets. `clouds.js` integrates density through spherical shell intervals using Beer extinction, two light probes, a dual-lobe phase, and approximate multiple scattering. These are visual approximations, not a forecast, microphysics model, or live cloud observations.

The ten presets are cirrus, cirrocumulus, cirrostratus, altocumulus, altostratus, nimbostratus, stratocumulus, stratus, cumulus, and cumulonimbus. Automatic mode mixes families using the historical NASA coverage field and procedural regional masks. Convective clouds have column envelopes and height-varying caps/anvils; ice clouds use stretched noise; decks have shallow profiles. Wind varies with altitude. Unresolvable local detail fades to regional coverage at orbital distances.

`cloud-reconstruction.js` owns one raw cloud target and two history targets, including depth textures that store normalized scattering altitude (0–18.1 km), rather than logarithmic viewing distance. This preserves sub-metre height precision even with 16-bit depth storage when the camera is in orbit. Camera altitude is computed in JavaScript at double precision, and cloud altitude and shell intersections use factored differences rather than subtracting nearly equal planet-scale squared distances. This prevents terrain-colored stippling through clouds at grazing angles. It reprojects the first-scattering point, rejects depth disocclusions, clamps history to a spatial neighbourhood, and filters **premultiplied** radiance/opacity. Cloud preset, quality, sun, and target-size changes invalidate history. Lost WebGL contexts do not advance cloud history; restoration recreates the attachments before accumulation resumes. The main composite reconstructs the resolved scattering altitude on the full-resolution viewing ray before comparing logarithmic depth against terrain/buildings. Copying a neighbouring ray’s depth directly causes clouds to disappear over the curved globe in orbital views. Scene colours are never accumulated into cloud history. Resizing replaces the color/depth attachments together, because repeated in-place depth-target resizing left empty buffers on Firefox WebGL 1. All render-target, viewport, scissor, clear-colour, and auto-clear state is restored before MapView draws its main scene.

| Quality            | Maximum volume samples per ray | Maximum cloud-pass pixels | Maximum scale relative to drawing buffer |
| ------------------ | -----------------------------: | ------------------------: | ---------------------------------------: |
| Fast               |                             24 |                   130,000 |                                      0.4 |
| Balanced (default) |                             40 |                   260,000 |                                      0.5 |
| Detailed           |                             64 |                   560,000 |                                     0.65 |

The volume pass skips empty density, exits at transmittance 0.015, bounds tangent traces to 360 km, and avoids sampling noise after it becomes subpixel. Cloud-only animation requests at most 20 frames/second and pauses in hidden tabs; camera interaction can render more often. Platforms without depth textures use a direct, 24-sample cloud pass without temporal reconstruction. Firefox WebGL 1 is supported; no WebGL 2 volume texture is required.

`cloud-noise.js` generates a periodic 64³ Perlin-style value/Worley volume offline; `scripts/build-cloud-noise.cjs` encodes it using Node built-ins. The 528² RGBA atlas includes a wrapping gutter around every slice and **must be uploaded with `flipY = false`**, linear filtering, and no 2D mipmaps. Flipping a packed atlas reorders slice rows and introduces seams. The build generates and hashes a lossless WebP for normal loading and retains the PNG as a decode or network fallback. Browser checks compare all uploaded WebGL pixels and exercise both fallback paths. No CPU noise generation runs during animation.

The compact toolbar has **Earth**, **Explore**, and **Environment**. Explore contains landscapes, the Sky viewpoint, and city navigation; choosing a destination closes the panel. Environment groups local solar time, day/night/animation, weather, and ground-layer switches. The solar-time readout follows the current target longitude, and cloud settings disable when clouds are switched off. Only one panel is open at a time; Escape restores focus to its trigger, clicking the map dismisses it, and panels scroll independently on small screens. Native harp zoom, compass, and tilt controls use matching styling without the debug zoom input. Fullscreen remains available at the upper right, with accessible labels for entry and exit. The site iframe must retain `allowFullScreen`.

UI structure and behavior live in `controls.js`; scoped styles live in `controls-style.js`. Regression helpers open the relevant panel through its visible toolbar button before interacting with its controls.

The implementation draws on [Guerrilla's Nubis weather/Perlin-Worley approach](https://www.guerrilla-games.com/read/nubis-authoring-real-time-volumetric-cloudscapes-with-the-decima-engine), [Unreal's scalable volume rendering and lighting approximations](https://dev.epicgames.com/documentation/en-us/unreal-engine/volumetric-cloud-component-in-unreal-engine), and the [WMO genus/height classification](https://cloudatlas.wmo.int/clouds-definitions.html). It does not implement Nubis³ voxel simulation or promise those engines' frame times.

## Source release

The renderer source for this deployment is [nicholasmullikin/xyz-threejs, 9782956d](https://github.com/nicholasmullikin/xyz-threejs/commit/9782956d704e89c60942e6c506dd26d22f3f2b18). The checked-in manifest records the revision and checksums of all 815 build inputs.

## Build and import

```sh
# Install source dependencies using its checked-in lock, then build an isolated asset set.
cd ../xyz-threejs
yarn install --immutable
yarn build:earth
cd ../site
pnpm sync:harp
```

`HARP_SOURCE_ROOT` overrides the source checkout for site checks and build workflows. `HARP_SRC` overrides the directory to import (default `../xyz-threejs/dist/earth`). `pnpm build:maps` builds without importing. Importing verifies every asset checksum, the required files, safe paths, and absence of a literal Mapbox token before replacing the served directory. A failed import preserves the working asset set.

`earth-build.json` records the source revision, dependency-lock hash, source/build-input hashes, and generated asset hashes. The revision alone does not identify a dirty checkout; the input hash and per-file hashes identify the exact build. The build emits source maps. Token lookup is performed directly from the iframe's `mapbox_token` query parameter; no fetch interceptor or compiled-code replacement is needed.

## Validation

```sh
pnpm test:maps
pnpm typecheck:maps
pnpm lint:maps
pnpm format:check:maps
pnpm test:maps:browser
```

Offline tests cover seams, DEM interpolation, ancestor UVs, the optical-depth LUT, building courtyards/heights, disposal, cloud atlas periodicity/gutters, bounded cloud work, and safe imports. Browser checks require the preview and a public Mapbox token from `GATSBY_MAPBOX_TOKEN` or `.env.development`. Error reports redact token values. `EARTH_PREVIEW_URL` defaults to `http://127.0.0.1:8011`. `HARP_ASSET_ROOT` overrides the standalone continuity-test assets.

For a staged build, run `node scripts/serve-earth-preview.cjs /path/to/assets` and point `EARTH_PREVIEW_URL` to `http://127.0.0.1:8012`. It serves those renderer assets and proxies the rest of the site to the existing preview. Test scenarios run sequentially to avoid competing for network and GPU resources.

Cloud browser checks render all ten genera in Chrome and Firefox WebGL 1, sample atlas row boundaries on the GPU, exercise shell crossings and quality bounds, and check the no-depth-texture fallback. The browser matrix covers Chrome, Firefox with WebGL 2 disabled, Firefox with all WebGL disabled, and rejected MapLibre context allocation. Lifecycle checks cover contour/satellite switching, page-history retention, repeated disposal, pending requests, and zero remaining uploaded geometry after teardown.

Production verification should use a separate Gatsby build directory so the active development server's cache is not modified.

## Current hosted preview

The private full-window preview runs at [the Tailscale Earth page](https://fedora.tailb4d960.ts.net:8447/blog/earth/). The user service `earth-blog-preview-8014.service` runs the Gatsby backend on port 8014. `node scripts/import-earth.cjs /path/to/verified/build` updates both the site assets and its generated preview mirror. The development server serves the renderer’s JavaScript, WebAssembly, worker files and data directly under `/harp/`. Run `node scripts/check-earth-hosted-assets.cjs https://your-preview-host` after a rollout to verify every served manifest checksum, HTML script and worker references, JavaScript and WebAssembly MIME types, WebAssembly validation, and byte ranges for the WebAssembly decoder and both mapped-data archives. The check reads the currently served manifest and compares small archive ranges to this checkout; it downloads all listed renderer assets.

The map's low-resolution fallback image is supplied by the site's existing `/img/worldColour.5400x2700.jpg`; the renderer's generated asset manifest covers the renderer bundles, source maps, effect imagery, theme, and credits. This site asset must remain available when embedding the source-built example elsewhere.

## Blog background

`gatsby-browser.js` and `gatsby-ssr.js` share `EarthBackgroundRoot` through
Gatsby's `wrapPageElement`. This wrapper persists across article navigation. It
owns the decorative iframe, while each article's footer exposes the shared pause
preference. The fixed layer has no pointer events and sits behind navigation and
content. Light/dark scrims use 78%/70% opacity over the reading column and much
less at the margins. Non-post routes release the iframe.

The fixed **Explore Earth** button brings that same iframe above the article and
removes the reading scrim. Native harp MapControls handle drag and wheel/pinch
zoom. Arrow keys rotate, plus/minus zoom, Home resets, and Escape returns to the
article. The toolbar offers the same zoom/reset actions and a Back button. The
article is inert and scrolling is locked during exploration; focus returns to
the launcher on exit. Camera latitude, longitude, distance and heading persist
when returning to reading. Zoom is bounded to orbital distances of 2–30 million
meters, since this background does not load ground-level terrain or building tiles.

Automatic spin pauses while exploring. Active gestures render at up to 30 FPS
(15 FPS after the slow-device budget reduction), then return to the normal idle
budget. Hidden tabs still pause. Devices with a static default can explicitly
open Explore Earth; exiting releases their renderer and restores the poster.

The background runs the actual renderer. Its source entry point is
`../xyz-threejs/@xyzmaps/harp-examples/src/earth/background.ts`, bundled into
the content-hashed `earth-background.bundle.<hash>.js` in `static/harp` (with a legacy fixed-name alias). It shares MapView, `imagery.js`,
`atmosphere.js`, `environment.js`, `clouds.js` and `cloud-reconstruction.js` with the
interactive demo. The earlier standalone sphere shader has been removed. The
background uses the existing high-resolution orbital globe material rather than
starting terrain/building tile sources at a fixed orbital altitude. It requires
no Mapbox token or tile decoder worker.

The background uses a fixed 40-degree vertical field of view: resizing and then
reloading at the same viewport size must produce the same projection. The
posters share a 16:10 composition and scale by height rather than `cover`, so
short/wide windows cannot inflate the fallback globe. Eligible animated desktops
wait for the live view instead of crossfading from a fixed-pose poster to a
restored orbit. Static-device, failure and no-JavaScript fallbacks retain the
poster.

The camera circles Earth once every 20 minutes of active rendering. Pause/resume,
scrolling, theme changes, resizing and navigation between articles keep the same
renderer instance and orbit. The current longitude and cloud time are saved in
session storage on suspension, page exit and every ten seconds, so leaving the blog
or reloading can restore the last view. Paused time does not advance the clocks.

MapView uses synchronous rendering with an explicit six-frame-per-second timer;
its normal RAF loop and the environment's autonomous wind timer are disabled in
this mode. The drawing budget is 1,200,000 pixels, independent of DPR. The quality controller
uses three levels: 1.2M/900K/700K pixels, 6/4/3 idle FPS and 30/24/15 interaction
FPS. It excludes three seconds of startup/resume work, smooths CPU submission
and available GPU timings, reduces quality under sustained pressure, and requires
extended headroom before recovering. The matching cloud budgets are
130K/80K/50K pixels and 24/20/16 samples per ray. Deadlines run start-to-start and never
accumulate catch-up frames. Volumetric clouds use the real 24-step low
preset, with a separate 130,000-pixel target and temporal reconstruction when
depth textures are available. No texture readback runs during animation.

The 4096×2048 surface and 2048×1024 night image are optimized copies of the same
NASA imagery used in the demo. Clouds and the noise atlas are the shared demo
assets. The full renderer and these sharper assets cost more than the former
small approximation; they load after the article, only on eligible desktops.
The iframe is deferred by 1.2 seconds plus an idle callback. Phones/coarse pointers,
widths under 768 px, reduced-motion, Save-Data, reported 2G/3G, and devices reporting
four or fewer cores or 4 GiB or less memory retain a static poster without loading
the renderer unless the visitor explicitly opens Explore Earth. Unsupported WebGL
and context loss also keep the poster.

The parent pauses drawing while scrolling, in hidden tabs, during fullscreen and
when an article's canvas/iframe/video is visible or within 120 px of the viewport.
Explicit pause preserves the last rendered frame and context; leaving the blog
releases resources. The parent/iframe message bridge checks both origin and source.

The checked-in poster is captured from the actual renderer at its initial view.
To regenerate after editing source or imagery:

```sh
pnpm build:maps
pnpm sync:harp
pnpm build:earth-background
pnpm build
EARTH_BACKGROUND_URL=http://127.0.0.1:8013 pnpm test:earth-background
```

Browser regressions check Chrome and Firefox WebGL 1, real renderer/cloud usage,
frame/pixel budgets, absence of tile/worker requests, pause/scroll/visibility/media
suspension, orbit continuity on theme/resize/resume/navigation, retention of the
iframe across article changes, session restoration and constrained-device fallbacks.
Screenshots and measurements are written under `/tmp/earth-real-background-*`.
`check-earth-framing.cjs` also reproduces the 2478×762 DevTools viewport from the
user screencast, compares resize/reload camera projections, checks loading-state
visibility, and verifies static/no-JavaScript poster framing.
`check-earth-interaction.cjs` checks native drag, continuous wheel input, touch
drag/pinch, keyboard and toolbar controls, focus restoration, scroll locking,
camera continuity and manual opt-in/disposal on static-default devices.

The persistent wrapper follows
[Gatsby's wrapPageElement lifecycle](https://www.gatsbyjs.com/docs/reference/config-files/gatsby-browser/#wrapPageElement).
Resource disposal and conservative buffer budgets follow
[MDN's WebGL best practices](https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_best_practices).

## Performance instrumentation and orbital atmosphere

`earth/performance.js` samples CPU and optional asynchronous GPU timings every
sixth frame, with bounded history and at most 24 pending queries. It supports
WebGL 1 and 2 timer extensions, rejects disjoint results, and releases query
resources on disposal. Unsupported timers are reported explicitly; CPU timing
is never labeled GPU timing. The full demo exposes a snapshot in the H debug HUD
and `map.earth.performance`; the background's test event exposes
`background.performance`. No synchronous GPU readback occurs in production.

`scripts/build-atmosphere-lut.cjs` generates `earth/atmosphere-lut.json` before
bundling. `atmosphere-lut.js` retains the reference physical integration for
builds and tests; that integration is absent from the browser dependency graph.
Every byte of the baked 256×64 table is checked against the reference generator.

The orbital background specializes the shared terrain shader to remove tile
blends and contours. Its `atmosphere-cache.js` stores surface scattering and
transmission in two halves of an RGBA8 atlas. Each half is capped at 60K pixels
and half drawing-buffer resolution. Camera, sun, viewport, and context-restoration
changes invalidate the cache; stationary frames reuse it. The sky and the narrow
surface band with view/normal cosine below 0.2 still integrate at full resolution:
caching that band produced colored horizon fringes. Ground-level terrain retains
direct atmospheric integration. All targets and GL state belong to the effect
and are restored/disposed through the normal lifecycle.

`check-earth-performance.cjs` measures stationary and moving orbital views, with
and without clouds. It attaches the same profiler to an older reference build
when needed. A one-pixel synchronous readback is deliberately confined to this
offline benchmark to bound submitted work; the reported completed-frame time
includes CPU/driver/readback overhead and is not a pure GPU duration. GPU query
results are reported separately. Chromium runs use SwiftShader, so they measure
software rendering and must not be presented as physical-device battery results.

`check-earth-adaptive-quality.cjs` verifies that real software-renderer timings
reduce both drawing and cloud budgets, then checks complete resource disposal.

`check-earth-atmosphere-cache.cjs` compares four orbital views against a reference
preview, including the night-side horizon, close orbit and a polar view. Run the
reference on a separate asset set before replacing the preview:

```sh
EARTH_REFERENCE_URL=http://127.0.0.1:8011 EARTH_BACKGROUND_URL=http://127.0.0.1:8012 node scripts/check-earth-atmosphere-cache.cjs
EARTH_BACKGROUND_URL=http://127.0.0.1:8012 EARTH_PERF_LABEL=candidate node scripts/check-earth-performance.cjs
```

The November 17 optimization comparison used a 1440×900 Chromium/SwiftShader
viewport and the same 1,199,410-pixel drawing buffer for reference and candidate.
For a moving view with clouds disabled, median completed-frame time fell from
57.7 ms to 47.2 ms; average GPU-query time fell from 55.8 ms to 46.7 ms. Cloud-heavy
results were more variable and do not establish a universal end-to-end speedup.
The slowest adaptive cloud tier reduces the maximum volume-sample budget from
130K×24 to 50K×16 (about 74% fewer samples), in addition to reducing update rate.
These are software-rendering measurements and work limits, not measured battery
savings. The four-view visual comparison had mean maximum-channel differences
of 0.007–1.052 on an 8-bit scale after keeping the horizon on direct integration.

### Optional surveyed terrain

The full-window Earth page can use a regional USGS 3DEP terrain pack. These links open the same renderer with surveyed terrain enabled at [Campus Point](/blog/earth/?terrain_pack=/terrain-packs/usgs-3dep-v1/manifest.json&view=34.40632,-119.8447,10,260,72,320), [Torrey Pines](/blog/earth/?terrain_pack=/terrain-packs/usgs-3dep-v1/manifest.json&view=32.8917,-117.2536,3,280,77,72), [Grand Canyon](/blog/earth/?terrain_pack=/terrain-packs/usgs-3dep-v1/manifest.json&view=36.0617,-112.1075,2162,270,77,2), or [Yosemite](/blog/earth/?terrain_pack=/terrain-packs/usgs-3dep-v1/manifest.json&view=37.74,-119.589,1271,330,72,15). Removing `terrain_pack` shows worldwide terrain from the same camera. Article backgrounds use the worldwide data.

The sample contains 129 terrain tiles (2.15 MB total). The renderer requests the index first and fetches tiles as the camera approaches surveyed ground. Each sample uses the same public builder. To regenerate it from the recorded surveys, run this command from the renderer checkout with the site checked out alongside it:

```sh
uv run --python 3.12 scripts/build-usgs-terrain.py \
  --sources-json ../site/static/terrain-packs/usgs-3dep-v1/sources.json \
  --output /tmp/usgs-3dep-rebuilt
```

For new coverage, supply one or more `--bbox WEST SOUTH EAST NORTH` arguments in place of `--sources-json`. Coverage is limited by the available source surveys and by the tile budget. [USGS 3DEP products](https://www.usgs.gov/3d-elevation-program/about-3dep-products-services)

In the full-window demo, open **Environment → On the ground → Elevation source** to switch the active terrain beneath the current camera. The daylight, layers and navigation stay in place. The address bar captures the selected source and viewpoint. A link with a regional pack also includes that pack in the selector.

The optional worldwide source uses Mapterhorn’s regional elevation surveys wherever its PMTiles index confirms coverage. [Try Mapterhorn at Campus Point](/blog/earth/?terrain=mapterhorn&view=34.40632,-119.8447,10,260,72,320) or [on the Grand Canyon rim](/blog/earth/?terrain=mapterhorn&view=36.0617,-112.1075,2162,270,77,2). With a configured Mapbox token, areas outside the surveys keep the standard terrain. Without a token, this mode also reads Mapterhorn’s global elevation pyramid and uses the bundled Earth imagery. The full-window demo loads the optional source reader on demand. Each 512-pixel source image supplies four neighboring terrain patches. [Mapterhorn coverage](https://mapterhorn.com/coverage/) · [Data access](https://mapterhorn.com/data-access/) · [Source attribution](https://mapterhorn.com/attribution/)

When live elevation is unavailable, the renderer keeps sufficiently detailed cached terrain. Elsewhere it reads a site-hosted approximation from NOAA ETOPO 2022. The global dataset occupies 3 MB. Only regional pages under the view download, and the normal live path requests none. The source is the public 60 arc-second ice-surface GeoTIFF, reprojected to Web Mercator up to ±85.05°. It preserves inland basins below sea level and the tops of the ice sheets. Near a cliff or a narrow valley its kilometer-scale samples can differ from surveyed terrain by hundreds of meters. Run `uv run --script scripts/build-earth-relief.py ETOPO_2022_v1_60s_N90W180_surface.tif @xyzmaps/harp-examples/src/earth/resources/terrain-base-v1` in the renderer checkout to rebuild the pages. [NOAA ETOPO 2022 downloads and citation](https://www.ncei.noaa.gov/products/etopo-global-relief-model)

With **Sun shadows** enabled near the ground, a worker also checks whether ridges 2.3–37 km toward the sun block its light. It reads the regional ETOPO pages only when the sun is about 2–27° above the horizon. A 33×33 field shares the local shadow texture. The globe uses the same field on terrain and buildings, and tapers the effect toward the edge of the 32 km viewing region. It approximates broad mountain shadows while the nearby shadow map resolves individual buildings and local relief.

Run `EARTH_PREVIEW_URL=http://localhost:8014 node scripts/check-earth-open-terrain.cjs` against a built preview to exercise the shared site URL, a keyless global camera, and recovery from provider throttling. The corresponding checks for published USGS packs and the standard terrain endpoint are `scripts/check-earth-survey.cjs` and `scripts/check-earth-terrain-backoff.cjs`.

Interactive and background entry scripts, lazy chunks, and Earth workers use
content-addressed filenames. The generated HTML pins worker URLs to the same
build; legacy fixed-name aliases continue to support older HTML and direct
embeddings. Vercel gives only hashed JavaScript immutable caching, while HTML
and fixed aliases revalidate. During an import, the immediately previous
HTML-referenced scripts, workers and lazy chunks are retained for a deployment
transition; older unreferenced generations are removed on the next import.

### Close-range survey and lighting controls

The full-window demo can stream textured aerial meshes in Helsinki and Luxembourg, surveyed building geometry in the Netherlands and Switzerland, and building models from Japanese PLATEAU releases. Choose **Surveyed cities** or open a link with `survey=1`. Coverage, texture dates and model detail vary by provider. During refinement, a stencil lets up to three resident textured parents fill uncovered pixels while the finer models arrive. Both layers reuse the surveyed geometry already in memory. The Helsinki catalog points directly to the photographed surface subtree. The other 469 assets in its companion floor layer are fully transparent. When the view settles, it selectively restores higher-resolution textures from the original model. The original encoded images and GPU upgrades have separate memory limits.

With `lidar=1`, covered US locations can load classified public airborne survey returns near the camera. Ground returns refine the existing terrain shader in satellite and relief views. Buildings with an estimated height can use consistent above-ground returns inside their footprint. The catalog identifies survey coverage before requesting point data.

Night lighting combines NASA Black Marble radiance at distance, grouped facade windows at building scale, and optional mapped fixtures in the immediate neighborhood. **Mapped street lights** (`lamps=1`) range-reads the local records from a 29 MB worldwide PMTiles archive after dark. The November 2026 catalog contains 6,810,006 mapped positions. Counts vary with OpenStreetMap coverage. The preview does not download the whole archive. Near mapped urban water, the surface shader reads water polygons already present in the building vector tiles. Waves use a directional slope spectrum. Sun and Moon lighting vary with the viewing angle, lunar phase and altitude. The lunar surface uses a reduced NASA LRO albedo map in the atmosphere’s existing lookup texture.

The source checkout includes `scripts/build-street-lamps.py`, `scripts/build-lidar-index.py`, `scripts/build-survey-directory.py`, and `scripts/build-lunar-albedo.py` to reproduce the derived assets. Open the attribution at the bottom of the demo and choose **Sources** for the source organizations, per-layer licenses and attribution.

Run `EARTH_PREVIEW_URL=http://localhost:8014 node scripts/check-earth-photomesh.cjs` to exercise a 150 m approach in Helsinki and Luxembourg on Chromium and Firefox WebGL 1. The check reads the rendered survey stencil, samples the center of the screen while children arrive, and verifies that disabling the source removes every covered pixel.

### Replaying orbit-to-ground flights

`scripts/check-earth-navigation.cjs` replays four fixed 40-second camera paths. They cover the Garibaldi ridge, Campus Point, Manhattan and the international date line. Each path includes a direction change and a return to a previous view. The output directory contains the per-frame intervals, completed transfer bytes by source, renderer identity, errors, a final screenshot and an optional recording.

```sh
EARTH_PREVIEW_URL=http://localhost:8014 \
EARTH_FLIGHT_ROUTE=mountain EARTH_FLIGHT_GPU=integrated EARTH_FLIGHT_DPR=2 \
EARTH_FLIGHT_NETWORK=constrained EARTH_RECORD_VIDEO=0 \
node scripts/check-earth-navigation.cjs /tmp/earth-ridge-flight
```

Use `mountain`, `coast`, `city` or `dateline` for the route. The overnight discrete-GPU runs used DPR 1 and the integrated-GPU runs used DPR 2. The constrained profile applies 4 Mbps download bandwidth and 150 ms latency. Without a persistent browser profile, each invocation starts with a cold browser cache. Keep the camera, viewport, GPU and network profile fixed for comparisons. Inspect the [matched-camera recordings](/plots/earth-flight-comparison.mp4) alongside the [per-run measurements and build identifiers](/plots/earth-flight-measurements.json).

The 19 November 2026 run collected 164 cold flights across six builds on the RTX 5070 Ti and the Ryzen integrated Radeon. In the equal-weight route and hardware comparison, the normal-network p95 frame interval went from 121.9 to 24.7 ms and transfer from 115.0 to 35.0 MB per 40-second flight. On the 4 Mbps profile, p95 went from 37.0 to 22.4 ms while transfer increased from 8.7 to 16.6 MB. Completed terrain payloads accounted for 1.8 and 9.1 MB respectively on the constrained profile. The results file retains the overlapping integrated-GPU diagnostic and identifies the isolated repeat used in the summary.

The visual regression checks include [survey coverage during a close approach](/plots/earth-photomesh-refinement.jpg), [regional cloud structure](/plots/earth-regional-clouds.jpg), [terrain lighting during mesh replacement](/plots/earth-terrain-transition.mp4), and [elevation agreement along four surveyed transects](/plots/earth-elevation-profiles.png). The latter compares data products with USGS 3DEP samples. Some products share source surveys.
