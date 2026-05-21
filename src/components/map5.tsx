import React from "react"

const TOKEN = process.env.GATSBY_MAPBOX_TOKEN ?? ""

export function Map5() {
  const src = TOKEN
    ? `/harp/rendering_globe-atmosphere.html?mapbox_token=${encodeURIComponent(TOKEN)}`
    : "/harp/rendering_globe-atmosphere.html"

  return (
    <iframe
      title="harp.gl globe with atmosphere"
      src={src}
      loading="lazy"
      style={{
        width: "100%",
        height: "500px",
        border: 0,
        borderRadius: 8,
        background: "#000",
      }}
    />
  )
}
