---
title: "Maps Demo"
category: "Maps"
date: "2026-05-19 18:00:00 +00:00"
desc: "A tour of four different map techniques in one post."
thumbnail: "./images/getting-started/thumbnail.jpg"
alt: "maps demo"
---

This post embeds **four different map components** rendered with four different technologies. They each demonstrate a different rendering pipeline.

## 1. OpenLayers → Three.js sphere (`Map1`)

An OpenLayers 2D raster map is rendered into an off-screen `<canvas>`, then used as a live texture on a Three.js sphere. Drag to orbit.

## 2. Plain OpenLayers (`Map2`)

A vanilla [OpenLayers](https://openlayers.org/) map. Click anywhere to read the lat/lng of the point you clicked.

## 3. Three.js earth with displacement map (`Map3`)

A Three.js earth using `@react-three/fiber`. A bathymetry map drives `displacementScale` and a color map textures the surface.

## 4. MapLibre GL — 3D vector tiles (`Map4`)

A pitched [MapLibre GL](https://maplibre.org/) map of New York, with the OSM `building` vector tile layer extruded to actual building heights.
