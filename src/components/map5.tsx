import React from "react"

const TOKEN = process.env.GATSBY_MAPBOX_TOKEN ?? ""

export function Map5({
  fullWindow = false,
  search = "",
}: {
  fullWindow?: boolean
  search?: string
}) {
  const shared = new URLSearchParams(search)
  const params = new URLSearchParams()
  if (TOKEN) params.set("mapbox_token", TOKEN)
  const pack =
    shared.get("terrain_pack") || process.env.GATSBY_EARTH_TERRAIN_PACK
  if (pack) params.set("terrain_pack", pack)
  if (shared.get("terrain") === "mapterhorn")
    params.set("terrain", "mapterhorn")
  const textureCache = shared.get("texture_cache")
  if (textureCache && ["bc7", "etc2", "auto"].includes(textureCache))
    params.set("texture_cache", textureCache)
  const cloud = shared.get("cloud")
  if (cloud && /^(off|[0-9]|10)$/.test(cloud)) params.set("cloud", cloud)
  const glint = shared.get("glint")
  if (glint === "slopes" || glint === "ggx") params.set("glint", glint)
  const reflection = shared.get("reflection")
  if (reflection && ["auto", "baseline", "shared", "waves", "clouds", "planar", "coastal", "mask"].includes(reflection)) params.set("reflection", reflection)
  else if(fullWindow) params.set("reflection", "auto")
  const wind = shared.get("wind")
  if (wind && ["calm", "breezy", "rough"].includes(wind)) params.set("wind", wind)
  const imagery = shared.get("imagery")
  if (imagery && ["worldcover", "swissimage", "sentinel2", "sentinel2-spring", "berlin", "naip"].includes(imagery))
    params.set("imagery", imagery)
  if (shared.get("layer") === "relief") params.set("layer", "relief")
  const sun = shared.get("sun")
  if (
    sun &&
    Number.isFinite(Number(sun)) &&
    Number(sun) >= 0 &&
    Number(sun) <= 24
  )
    params.set("sun", sun)
  if (shared.get("water") === "0") params.set("water", "0")
  for (const layer of [
    "lamps",
    "lidar",
    "survey",
    "roofs",
    "canopy",
    "shadows",
  ]) {
    if (shared.get(layer) === "1") params.set(layer, "1")
  }
  const view = shared.get("view")
  if (view) params.set("view", view)
  if (process.env.GATSBY_GOOGLE_MAPS_API_KEY)
    params.set("google_maps_key", process.env.GATSBY_GOOGLE_MAPS_API_KEY)
  const src = "/harp/rendering_globe-atmosphere.html?" + params

  return (
    <iframe
      allowFullScreen
      title="harp.gl globe with atmosphere"
      src={src}
      loading={fullWindow ? "eager" : "lazy"}
      style={{
        width: "100%",
        display: "block",
        height: fullWindow ? "100%" : "500px",
        border: 0,
        borderRadius: fullWindow ? 0 : 8,
        background: "#000",
      }}
    />
  )
}
