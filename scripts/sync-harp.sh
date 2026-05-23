#!/usr/bin/env bash
# Sync the harp.gl globe-atmosphere demo from a local checkout of xyz-threejs
# into static/harp/, stripping the hardcoded Mapbox token and injecting a
# fetch interceptor that swaps a placeholder for a token passed at runtime
# via ?mapbox_token=... on the iframe URL.

set -euo pipefail

SRC=${HARP_SRC:-../xyz-threejs/dist/examples}
DST=static/harp

if [[ ! -d "$SRC" ]]; then
  echo "sync:harp: source dir not found: $SRC" >&2
  echo "  set HARP_SRC=/path/to/xyz-threejs/dist/examples to override" >&2
  exit 1
fi

mkdir -p "$DST/resources/fonts"

cp \
  "$SRC/rendering_globe-atmosphere.html" \
  "$SRC/common_bundle.js" \
  "$SRC/rendering_globe-atmosphere_bundle.js" \
  "$SRC/decoder.bundle.js" \
  "$DST/"

cp \
  "$SRC/resources/berlin_tilezen_base.json" \
  "$SRC/resources/berlin_tilezen_base_globe.json" \
  "$SRC/resources/Sky_nx.png" \
  "$SRC/resources/Sky_ny.png" \
  "$SRC/resources/Sky_nz.png" \
  "$SRC/resources/Sky_px.png" \
  "$SRC/resources/Sky_py.png" \
  "$SRC/resources/Sky_pz.png" \
  "$SRC/resources/maki_icons.json" \
  "$SRC/resources/maki_icons.png" \
  "$SRC/resources/poi_table_maki.json" \
  "$SRC/resources/road_shields_generic.json" \
  "$SRC/resources/road_shields_generic.png" \
  "$DST/resources/"

cp "$SRC/resources/fonts/Default_FontCatalog.json" "$DST/resources/fonts/"

# Replace any literal Mapbox public token (pk.<jwt>) with a placeholder.
# The real token is injected at runtime by the prelude script in the HTML.
sed -i -E \
  's|pk\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+|__GATSBY_MAPBOX_TOKEN__|g' \
  "$DST/rendering_globe-atmosphere_bundle.js"

# Inject the fetch interceptor before the bundle <script defer> tags so the
# placeholder is rewritten with the runtime token before tile requests fly.
node - "$DST/rendering_globe-atmosphere.html" <<'NODE'
const fs = require("fs")
const file = process.argv[2]
let html = fs.readFileSync(file, "utf8")
const marker = "__GATSBY_MAPBOX_TOKEN__"
if (html.includes(marker)) process.exit(0)
const prelude = `<script>
      (function () {
        var token = new URLSearchParams(location.search).get("mapbox_token") || "";
        var PLACEHOLDER = "__GATSBY_MAPBOX_TOKEN__";
        if (!token) {
          console.warn("[harp demo] No mapbox_token in URL; tile requests will 401.");
          return;
        }
        function rewrite(value) {
          return typeof value === "string" && value.indexOf(PLACEHOLDER) !== -1
            ? value.split(PLACEHOLDER).join(token)
            : value;
        }
        var origFetch = window.fetch.bind(window);
        window.fetch = function (input, init) {
          if (typeof input === "string") {
            input = rewrite(input);
          } else if (input && typeof input === "object" && input.url) {
            var newUrl = rewrite(input.url);
            if (newUrl !== input.url) input = new Request(newUrl, input);
          }
          return origFetch(input, init);
        };
        var imgProto = HTMLImageElement.prototype;
        var srcDesc = Object.getOwnPropertyDescriptor(imgProto, "src");
        if (srcDesc && srcDesc.set) {
          Object.defineProperty(imgProto, "src", {
            configurable: true,
            enumerable: srcDesc.enumerable,
            get: srcDesc.get,
            set: function (value) { srcDesc.set.call(this, rewrite(value)); },
          });
        }
        if (typeof XMLHttpRequest !== "undefined") {
          var origOpen = XMLHttpRequest.prototype.open;
          XMLHttpRequest.prototype.open = function (method, url) {
            arguments[1] = rewrite(url);
            return origOpen.apply(this, arguments);
          };
        }
      })();
    </script>
    `
const needle = '<script defer src="common_bundle.js"'
if (!html.includes(needle)) {
  console.error(`sync:harp: could not find ${needle} in ${file}`)
  process.exit(1)
}
html = html.replace(needle, prelude + needle)
fs.writeFileSync(file, html)
NODE
