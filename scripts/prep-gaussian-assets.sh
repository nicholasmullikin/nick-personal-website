#!/usr/bin/env bash
# Build every static asset the gaussian-splats blog post needs from a local
# checkout of ~/src/gaussian_test (which contains the raw mp4, the extracted
# frames, the COLMAP sparse model, and the trained 3DGS Model.ply).
#
# Outputs land under static/blog/gaussian/ and src/posts/blog/images/gaussian-splats/.
# Idempotent: re-running overwrites in place. Skip individual steps by setting
# SKIP_CLIP / SKIP_FRAMES / SKIP_POINTS / SKIP_SPLAT / SKIP_CENTER=1.

set -euo pipefail

GS=${GS:-$HOME/src/gaussian_test}
DST=static/blog/gaussian
IMAGES_DST=src/posts/blog/images/gaussian-splats
SCRIPTS="$(cd "$(dirname "$0")" && pwd)"

if [[ ! -d "$GS" ]]; then
  echo "prep-gaussian: \$GS=$GS does not exist; set GS=/path/to/gaussian_test" >&2
  exit 1
fi

mkdir -p "$DST/frames" "$IMAGES_DST"

if [[ -z "${SKIP_CLIP:-}" ]]; then
  echo "==> clip.webp (animated, ~6s, 720px, no audio)"
  ffmpeg -hide_banner -loglevel warning -y \
    -ss 2 -t 6 -i "$GS/PXL_20260525_164642769.mp4" \
    -vf "fps=8,scale=720:-2" \
    -loop 0 -compression_level 6 -q:v 60 \
    "$DST/clip.webp"
fi

if [[ -z "${SKIP_FRAMES:-}" ]]; then
  echo "==> frames/*.jpg (9 evenly-spaced thumbnails)"
  # 192 frames numbered 00000-00191; pick 9 evenly spaced
  for i in 00000 00024 00048 00072 00096 00120 00144 00168 00190; do
    src_png="$GS/PXL_20260525_164642769/frame-$i.png"
    if [[ ! -f "$src_png" ]]; then
      echo "  missing $src_png" >&2; exit 1
    fi
    ffmpeg -hide_banner -loglevel error -y \
      -i "$src_png" -vf "scale=480:-2" -q:v 4 \
      "$DST/frames/frame-$i.jpg"
  done
fi

if [[ -z "${SKIP_POINTS:-}" ]]; then
  echo "==> points.ply (COLMAP sparse cloud)"
  python3 "$SCRIPTS/colmap_points_to_ply.py" \
    "$GS/sparse/0/points3D.bin" "$DST/points.ply"
fi

if [[ -z "${SKIP_SPLAT:-}" ]]; then
  echo "==> scene.splat (decimated trained 3DGS)"
  python3 "$SCRIPTS/ply_to_splat.py" \
    "$GS/Model.ply" "$DST/scene.splat" \
    --recenter --max-splats 250000
fi

if [[ -z "${SKIP_CENTER:-}" ]]; then
  echo "==> scene-center.splat (center-only, used by the thumbnail renderer)"
  python3 "$SCRIPTS/ply_to_splat.py" \
    "$GS/Model.ply" "$DST/scene-center.splat" \
    --recenter --center-only --center-quantile 0.25 --max-splats 80000
fi

echo ""
echo "Done. Output sizes:"
du -h "$DST"/*.* "$DST/frames"/*.jpg 2>/dev/null | sort
