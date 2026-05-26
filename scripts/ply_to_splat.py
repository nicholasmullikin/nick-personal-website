#!/usr/bin/env python3
"""Convert an Inria-style trained 3DGS .ply to the antimatter15 .splat format
that ``@react-three/drei``'s ``<Splat>`` consumes.

Each .splat row is 32 bytes:

   3 floats  position    (12 B)
   3 floats  scale       (12 B)  -- already exp()ed
   4 bytes   color RGBA  ( 4 B)  -- u8, alpha = sigmoid(opacity) * 255
   4 bytes   rotation    ( 4 B)  -- u8, quaternion ((q*128)+128)

Supports two reduction modes:

* ``--max-splats N`` keeps the N most "important" splats (sorted by
  ``-opacity * volume`` so the visible high-alpha blobs survive).
* ``--center-only`` first restricts to splats inside a ball around the
  spatial median (radius = the ``--center-quantile`` distance percentile),
  *then* applies ``--max-splats``. This strips floaters and ground/edge
  garbage for the thumbnail render.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import numpy as np

SH_C0 = 0.28209479177387814


def parse_header(path: Path) -> tuple[int, list[tuple[str, str]], int]:
    """Returns (vertex_count, [(prop_type, prop_name), ...], header_byte_len)."""
    with path.open("rb") as f:
        chunk = f.read(65536)
    end = chunk.find(b"end_header\n")
    if end < 0:
        raise ValueError(f"{path}: missing end_header within first 64 KiB")
    header = chunk[:end].decode("ascii", errors="replace")
    vertex_count = 0
    props: list[tuple[str, str]] = []
    for line in header.splitlines():
        if line.startswith("element vertex "):
            vertex_count = int(line.split()[-1])
        elif line.startswith("property "):
            parts = line.split()
            props.append((parts[1], parts[2]))
    if vertex_count == 0:
        raise ValueError(f"{path}: header has no vertex element")
    return vertex_count, props, end + len(b"end_header\n")


def load_splats(path: Path) -> dict[str, np.ndarray]:
    vertex_count, props, header_len = parse_header(path)

    np_type_map = {"float": "<f4", "double": "<f8", "uchar": "u1", "uint": "<u4"}
    dtype = np.dtype([(name, np_type_map[t]) for t, name in props])
    if dtype.itemsize == 0:
        raise ValueError(f"{path}: zero-size record")

    with path.open("rb") as f:
        f.seek(header_len)
        arr = np.fromfile(f, dtype=dtype, count=vertex_count)

    if arr.shape[0] != vertex_count:
        raise ValueError(
            f"{path}: expected {vertex_count} verts, got {arr.shape[0]}"
        )

    pos = np.stack([arr["x"], arr["y"], arr["z"]], axis=1).astype(np.float32)
    scale = np.stack(
        [arr["scale_0"], arr["scale_1"], arr["scale_2"]], axis=1
    ).astype(np.float32)
    rot = np.stack(
        [arr["rot_0"], arr["rot_1"], arr["rot_2"], arr["rot_3"]], axis=1
    ).astype(np.float32)
    f_dc = np.stack([arr["f_dc_0"], arr["f_dc_1"], arr["f_dc_2"]], axis=1).astype(
        np.float32
    )
    opacity = arr["opacity"].astype(np.float32)

    return {
        "pos": pos,
        "scale": scale,
        "rot": rot,
        "f_dc": f_dc,
        "opacity": opacity,
    }


def to_splat_bytes(data: dict[str, np.ndarray]) -> bytes:
    pos = data["pos"]
    scale = np.exp(data["scale"]).astype(np.float32)

    rgb = np.clip((0.5 + SH_C0 * data["f_dc"]) * 255.0, 0.0, 255.0).astype(np.uint8)
    alpha = np.clip(
        (1.0 / (1.0 + np.exp(-data["opacity"]))) * 255.0, 0.0, 255.0
    ).astype(np.uint8)
    color = np.concatenate([rgb, alpha[:, None]], axis=1)

    rot = data["rot"]
    rot = rot / np.maximum(np.linalg.norm(rot, axis=1, keepdims=True), 1e-12)
    rot_u8 = np.clip(rot * 128.0 + 128.0, 0.0, 255.0).astype(np.uint8)

    n = pos.shape[0]
    buf = np.zeros(n, dtype=np.dtype([
        ("pos", "<f4", 3),
        ("scale", "<f4", 3),
        ("color", "u1", 4),
        ("rot", "u1", 4),
    ]))
    buf["pos"] = pos
    buf["scale"] = scale
    buf["color"] = color
    buf["rot"] = rot_u8
    return buf.tobytes()


def importance(data: dict[str, np.ndarray]) -> np.ndarray:
    """Larger = more important = render first / keep when decimating."""
    vol = np.prod(np.exp(data["scale"]), axis=1)
    opa = 1.0 / (1.0 + np.exp(-data["opacity"]))
    return opa * vol


def mask_center(
    pos: np.ndarray, quantile: float
) -> tuple[np.ndarray, np.ndarray]:
    """Return (boolean mask of inliers, median point)."""
    median = np.median(pos, axis=0)
    d = np.linalg.norm(pos - median, axis=1)
    r = np.quantile(d, quantile)
    return d <= r, median


def select_indices(data: dict[str, np.ndarray], args) -> np.ndarray:
    n = data["pos"].shape[0]
    keep = np.ones(n, dtype=bool)

    if args.center_only:
        center_mask, median = mask_center(data["pos"], args.center_quantile)
        keep &= center_mask
        print(
            f"center filter: kept {keep.sum():,}/{n:,} "
            f"(quantile={args.center_quantile}, median={median.tolist()})",
            file=sys.stderr,
        )

    if args.max_splats and keep.sum() > args.max_splats:
        imp = importance(data)
        imp_keep = imp.copy()
        imp_keep[~keep] = -np.inf
        idx = np.argpartition(-imp_keep, args.max_splats)[: args.max_splats]
        new_keep = np.zeros(n, dtype=bool)
        new_keep[idx] = True
        keep = new_keep
        print(
            f"importance cap: kept top {args.max_splats:,} by opacity*volume",
            file=sys.stderr,
        )

    return np.nonzero(keep)[0]


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("input", type=Path, help="trained .ply (Inria 3DGS format)")
    ap.add_argument("output", type=Path, help="output .splat path")
    ap.add_argument(
        "--max-splats", type=int, default=0, help="cap output to this many splats"
    )
    ap.add_argument(
        "--center-only",
        action="store_true",
        help="keep only splats within --center-quantile of the spatial median",
    )
    ap.add_argument(
        "--center-quantile",
        type=float,
        default=0.25,
        help="quantile of distance-from-median to keep (default 0.25)",
    )
    ap.add_argument(
        "--recenter",
        action="store_true",
        help="subtract the spatial median from all positions so the splat sits at the origin",
    )
    args = ap.parse_args()

    data = load_splats(args.input)
    if args.recenter:
        median = np.median(data["pos"], axis=0)
        data["pos"] = (data["pos"] - median).astype(np.float32)
        print(
            f"recenter: subtracted median {median.tolist()} from positions",
            file=sys.stderr,
        )

    idx = select_indices(data, args)
    kept = {k: v[idx] for k, v in data.items()}

    if args.center_only and args.recenter:
        # After filtering to the inliers, re-center on the inlier centroid so
        # the visible blob sits exactly at the origin (otherwise the kept set
        # is off-center within the recentered cloud).
        local_median = np.median(kept["pos"], axis=0)
        kept["pos"] = (kept["pos"] - local_median).astype(np.float32)
        print(
            f"inlier-recenter: subtracted {local_median.tolist()} "
            f"from kept positions",
            file=sys.stderr,
        )

    blob = to_splat_bytes(kept)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_bytes(blob)
    print(
        f"wrote {len(idx):,} splats to {args.output} "
        f"({len(blob) / 1024 / 1024:.1f} MiB)",
        file=sys.stderr,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
