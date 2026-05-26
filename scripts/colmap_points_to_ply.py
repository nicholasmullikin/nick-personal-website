#!/usr/bin/env python3
"""Convert COLMAP's binary points3D.bin to a compact ASCII PLY.

The COLMAP format packs per-point metadata (track, reprojection error) that
we don't need for a web viewer. We just want xyz + RGB, which compresses
~5x.
"""

from __future__ import annotations

import argparse
import struct
import sys
from pathlib import Path


def read_points3d_bin(path: Path) -> list[tuple[float, float, float, int, int, int]]:
    out: list[tuple[float, float, float, int, int, int]] = []
    with path.open("rb") as f:
        (num_points,) = struct.unpack("<Q", f.read(8))
        for _ in range(num_points):
            # point_id (uint64), xyz (3x float64), rgb (3x uint8), error (float64)
            f.read(8)
            x, y, z = struct.unpack("<3d", f.read(24))
            r, g, b = struct.unpack("<3B", f.read(3))
            f.read(8)
            (track_len,) = struct.unpack("<Q", f.read(8))
            f.read(track_len * 8)
            out.append((x, y, z, r, g, b))
    return out


def write_ply_ascii(
    pts: list[tuple[float, float, float, int, int, int]], path: Path
) -> None:
    with path.open("w") as f:
        f.write("ply\n")
        f.write("format ascii 1.0\n")
        f.write(f"element vertex {len(pts)}\n")
        for axis in ("x", "y", "z"):
            f.write(f"property float {axis}\n")
        for ch in ("red", "green", "blue"):
            f.write(f"property uchar {ch}\n")
        f.write("end_header\n")
        for x, y, z, r, g, b in pts:
            f.write(f"{x:.6f} {y:.6f} {z:.6f} {r} {g} {b}\n")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("input", type=Path, help="path to points3D.bin")
    ap.add_argument("output", type=Path, help="path to write ASCII .ply")
    ap.add_argument(
        "--max-points",
        type=int,
        default=0,
        help="if > 0, keep only the first N points (deterministic sample)",
    )
    args = ap.parse_args()

    pts = read_points3d_bin(args.input)
    if args.max_points and len(pts) > args.max_points:
        step = len(pts) // args.max_points
        pts = pts[::step][: args.max_points]

    args.output.parent.mkdir(parents=True, exist_ok=True)
    write_ply_ascii(pts, args.output)
    print(
        f"wrote {len(pts):,} points to {args.output} "
        f"({args.output.stat().st_size / 1024:.1f} KiB)",
        file=sys.stderr,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
