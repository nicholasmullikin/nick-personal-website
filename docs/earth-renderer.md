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

The native geometry cache uses a 200 MiB soft budget shared by data sources. Visible tiles are pinned and may exceed that budget in dense cities. Tests check that unused geometry is evicted rather than requiring visible buildings to disappear. Imagery separately keeps its 160-entry cache and at most eight requests; buildings permit four network requests through an abort-aware provider.

## Clouds

`environment.js` owns the NASA coverage/night textures and wind clock. `cloud-model.js` defines the ten WMO genera, latitude-adjusted height profiles, regional weather selection, density, conservative horizon/latitude bounds, and quality budgets. `clouds.js` integrates density through spherical shell intervals using Beer extinction, two light probes, a dual-lobe phase, and approximate multiple scattering. These are visual approximations, not a forecast, microphysics model, or live cloud observations.

The ten presets are cirrus, cirrocumulus, cirrostratus, altocumulus, altostratus, nimbostratus, stratocumulus, stratus, cumulus, and cumulonimbus. Automatic mode mixes families using the historical NASA coverage field and procedural regional masks. Convective clouds have column envelopes and height-varying caps/anvils; ice clouds use stretched noise; decks have shallow profiles. Wind varies with altitude. Unresolvable local detail fades to regional coverage at orbital distances.

`cloud-reconstruction.js` owns one raw cloud target and two history targets, including depth textures that store normalized scattering altitude (0–18.1 km), rather than logarithmic viewing distance. This preserves sub-metre height precision even with 16-bit depth storage when the camera is in orbit. It reprojects the first-scattering point, rejects depth disocclusions, clamps history to a spatial neighbourhood, and filters **premultiplied** radiance/opacity. Cloud preset, quality, sun, and target-size changes invalidate history. Lost WebGL contexts do not advance cloud history; restoration recreates the attachments before accumulation resumes. The main composite reconstructs the resolved scattering altitude on the full-resolution viewing ray before comparing logarithmic depth against terrain/buildings. Copying a neighbouring ray’s depth directly causes clouds to disappear over the curved globe in orbital views. Scene colours are never accumulated into cloud history. Resizing replaces the color/depth attachments together, because repeated in-place depth-target resizing left empty buffers on Firefox WebGL 1. All render-target, viewport, scissor, clear-colour, and auto-clear state is restored before MapView draws its main scene.

| Quality            | Maximum volume samples per ray | Maximum cloud-pass pixels | Maximum scale relative to drawing buffer |
| ------------------ | -----------------------------: | ------------------------: | ---------------------------------------: |
| Fast               |                             24 |                   130,000 |                                      0.4 |
| Balanced (default) |                             40 |                   260,000 |                                      0.5 |
| Detailed           |                             64 |                   560,000 |                                     0.65 |

The volume pass skips empty density, exits at transmittance 0.015, bounds tangent traces to 360 km, and avoids sampling noise after it becomes subpixel. Cloud-only animation requests at most 20 frames/second and pauses in hidden tabs; camera interaction can render more often. Platforms without depth textures use a direct, 24-sample cloud pass without temporal reconstruction. Firefox WebGL 1 is supported; no WebGL 2 volume texture is required.

`cloud-noise.js` generates a periodic 64³ Perlin-style value/Worley volume offline; `scripts/build-cloud-noise.cjs` encodes it using Node built-ins. The 528² RGBA atlas includes a wrapping gutter around every slice and **must be uploaded with `flipY = false`**, linear filtering, and no 2D mipmaps. Flipping a packed atlas reorders slice rows and introduces seams. The build regenerates and hashes the PNG and both generator inputs. No CPU noise generation runs during animation.

The compact toolbar has **Earth**, **Explore**, and **Environment**. Explore contains landscapes, the Sky viewpoint, and city navigation; choosing a destination closes the panel. Environment groups local solar time, day/night/animation, weather, and ground-layer switches. The solar-time readout follows the current target longitude, and cloud settings disable when clouds are switched off. Only one panel is open at a time; Escape restores focus to its trigger, clicking the map dismisses it, and panels scroll independently on small screens. Native harp zoom, compass, and tilt controls use matching styling without the debug zoom input. Fullscreen remains available at the upper right, with accessible labels for entry and exit. The site iframe must retain `allowFullScreen`.

UI structure and behavior live in `controls.js`; scoped styles live in `controls-style.js`. Regression helpers open the relevant panel through its visible toolbar button before interacting with its controls.

The implementation draws on [Guerrilla's Nubis weather/Perlin-Worley approach](https://www.guerrilla-games.com/read/nubis-authoring-real-time-volumetric-cloudscapes-with-the-decima-engine), [Unreal's scalable volume rendering and lighting approximations](https://dev.epicgames.com/documentation/en-us/unreal-engine/volumetric-cloud-component-in-unreal-engine), and the [WMO genus/height classification](https://cloudatlas.wmo.int/clouds-definitions.html). It does not implement Nubis³ voxel simulation or promise those engines' frame times.

## Source release

The renderer source for this deployment is committed in [nicholasmullikin/xyz-threejs, `a2efceb`](https://github.com/nicholasmullikin/xyz-threejs/commit/a2efceb93c4534eb240d565fd5488a9a604c4398), on the `earth-simulator` branch. All 379 recorded build inputs match that source tree. The artifact manifest retains the original local build revision; use its input hashes and this source commit to reproduce the release.

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

The private Tailscale preview is `https://fedora.tailb4d960.ts.net:8447/blog/maps/`. The user service `earth-preview.service` serves renderer assets from this checkout and proxies the site to port 8000. `earth-site.service` serves the validated production build in `/tmp/earth-cleanup-site-build`; the original development backend exited during validation. Both services currently run in the user session. Renderer imports are picked up immediately; page/component edits require rebuilding the site backend or starting a development server again.

The map's low-resolution fallback image is supplied by the site's existing `/img/worldColour.5400x2700.jpg`; the renderer's generated asset manifest covers the renderer bundles, source maps, effect imagery, theme, and credits. This site asset must remain available when embedding the source-built example elsewhere.
