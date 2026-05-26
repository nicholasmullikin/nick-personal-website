---
title: "Phone video to 3D Gaussian Splat, locally, on Fedora"
category: "Projects"
date: "2026-05-26 03:00:00 +00:00"
desc: "Turning a 30-second phone video into a fly-around 3D Gaussian Splat with ffmpeg, COLMAP, and LichtFeld Studio — plus every Fedora 44 / gcc 16 build break I had to fix to get there."
thumbnail: "./images/gaussian-splats/thumbnail.png"
alt: "rendered 3D Gaussian Splat of a small wrench on a tabletop"
---

[3D Gaussian Splats](https://packet39.com/blog/a-primer-on-gaussian-splats/) are a point cloud where every point is a small anisotropic fuzzball with a color, an orientation, a scale, and an opacity. Train them right and they look photorealistic from any viewpoint, beat meshes on hair / fur / vegetation / reflections, and ship in a single PLY file. The downside is the training step is computationally expensive and the toolchain — COLMAP, LichtFeld Studio, the various PLY-to-runtime converters — is a fresh source of Fedora-on-gcc-16 papercuts every time.

This post walks through the four stages I ran end-to-end against [the dataset](https://github.com/nicholasmullikin/nanlite) committed at `~/src/gaussian_test/`: video → frames → COLMAP sparse model → trained 3DGS. Every stage renders inline below from the actual outputs.

## Step 1 — Video

A handheld 30-second phone video, walking around the subject in three concentric rings (low / waist / high). The shooting recipe is the same as photogrammetry: 80% overlap between adjacent views, flat lighting, no shadows or specular highlights, no obstructions. The faster you walk the more motion blur you get; slower is better.

![phone video clip orbiting the subject](/blog/gaussian/clip.webp)

The raw file is `PXL_20260525_164642769.mp4`, 214 MB at 4K30. None of that ships to the trainer.

## Step 2 — Frames

The trainer needs sharp stills, not video, so the next step is to pull frames out. Uniform sampling with `ffmpeg` is the cheap way:

```bash
ffmpeg -i PXL_20260525_164642769.mp4 \
       -vf "fps=4,scale=-2:1080" \
       -q:v 2 \
       PXL_20260525_164642769/frame-%05d.png
```

But uniform sampling will hand the trainer motion-blurred frames the moment your hand wobbled. The better option is [sharp-frame-extractor](https://github.com/cansik/sharp-frame-extractor) — runnable with no install via `npx`:

```bash
npx sharp-frames PXL_20260525_164642769.mp4 PXL_20260525_164642769/ \
    --count 200 --quality 90
```

It walks the video, scores each frame by Laplacian variance (a sharpness proxy), and keeps the locally-sharpest frames around evenly-spaced anchor times. The dataset here is the 192 PNGs it produced. Nine evenly-spaced thumbnails:

<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:0.5rem;">
  <img src="/blog/gaussian/frames/frame-00000.jpg" alt="frame 0" loading="lazy" />
  <img src="/blog/gaussian/frames/frame-00024.jpg" alt="frame 24" loading="lazy" />
  <img src="/blog/gaussian/frames/frame-00048.jpg" alt="frame 48" loading="lazy" />
  <img src="/blog/gaussian/frames/frame-00072.jpg" alt="frame 72" loading="lazy" />
  <img src="/blog/gaussian/frames/frame-00096.jpg" alt="frame 96" loading="lazy" />
  <img src="/blog/gaussian/frames/frame-00120.jpg" alt="frame 120" loading="lazy" />
  <img src="/blog/gaussian/frames/frame-00144.jpg" alt="frame 144" loading="lazy" />
  <img src="/blog/gaussian/frames/frame-00168.jpg" alt="frame 168" loading="lazy" />
  <img src="/blog/gaussian/frames/frame-00190.jpg" alt="frame 190" loading="lazy" />
</div>

## Step 3 — Structure from motion, camera calibration, sparse cloud

[COLMAP](https://colmap.github.io/) runs feature extraction (SIFT), exhaustive matching with geometric verification, and incremental SfM in one shot:

```bash
~/src/colmap/install/bin/colmap automatic_reconstructor \
    --image_path /home/nick/src/gaussian_test/PXL_20260525_164642769 \
    --workspace_path /home/nick/src/gaussian_test \
    --sparse 1 --dense 0 \
    --use_gpu 1
```

`--dense 0` is the magic flag: 3DGS doesn't need MVS PatchMatch, so we save ~25 minutes of GPU time and just get `sparse/0/{cameras,images,points3D}.bin`. On the 5070 Ti, 192 frames complete in 5–10 minutes.

3DGS trainers also expect **pinhole** cameras (no distortion), so we undistort the images into a new folder afterwards:

```bash
~/src/colmap/install/bin/colmap image_undistorter \
    --image_path /home/nick/src/gaussian_test/PXL_20260525_164642769 \
    --input_path /home/nick/src/gaussian_test/sparse/0 \
    --output_path /home/nick/src/gaussian_test/splat_input \
    --output_type COLMAP --max_image_size 1920
```

The output of this stage is a sparse 3D point cloud — the features COLMAP triangulated across views, colored by their average pixel value. Drag to orbit:

<!-- GaussianSplatBlock renders here -->

The point cloud below is committed at `static/blog/gaussian/points.ply` — a 2.4 MB ASCII PLY produced by [`scripts/colmap_points_to_ply.py`](https://github.com/nicholasmullikin/site/blob/main/scripts/colmap_points_to_ply.py) from COLMAP's binary `points3D.bin`. About 67k points. If fewer than ~80% of your frames register here, the dataset is bad and no amount of training will fix it — go re-shoot.

## Step 4 — Train the splat

[LichtFeld Studio](https://github.com/MrNeRF/Lichtfeld-Studio) is the open-source trainer I used. Drag the `splat_input/` folder into it, hit train, watch the iteration counter climb. Pick a `Max Gaussian` based on VRAM (3M for 8 GB, 10–15M for 16 GB); visual quality plateaus by ~4k iterations for most scenes.

The trained PLY is 736 MB raw (3.1M splats × 248 bytes per splat: position, normal, 48 SH coefficients, opacity, anisotropic scale, quaternion). That doesn't ship. The viewer below loads a 250k-splat decimation (~8 MB) kept by sorting on `opacity × volume` so the visible high-impact blobs survive:

<!-- second slot of GaussianSplatBlock renders here -->

The thumbnail at the top of this post is the same data, further filtered to the inner 25% by distance-from-median and rendered headlessly with Playwright — see [`scripts/render-splat-thumbnail.mjs`](https://github.com/nicholasmullikin/site/blob/main/scripts/render-splat-thumbnail.mjs).

## The build fixes I actually had to ship

Building both pieces from source on Fedora 44 (gcc 16.1.1, CUDA 13.2, binutils 2.46, RTX 5070 Ti) was a several-hour adventure. The two upstream READMEs only cover Debian/Ubuntu. Here's the full set of papercuts, in case you're on this stack.

### COLMAP

| Symptom                                           | Fix                                                                                                                                                                                                                                                                                                    |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `nvcc fatal: unsupported host compiler 'g++'`     | `dnf install gcc15 gcc15-c++`, then configure with `-DCMAKE_CUDA_HOST_COMPILER=/usr/bin/g++-15`. CUDA 13.2's `host_config.h` rejects gcc 16.                                                                                                                                                           |
| `OpenImageIOConfig.cmake not found`               | `dnf install OpenImageIO-devel` (Fedora splits the headers + CMake configs into the `-devel` package).                                                                                                                                                                                                 |
| Ceres complains about missing BLAS                | `dnf install flexiblas-devel lapack-devel`.                                                                                                                                                                                                                                                            |
| CMake error: `CAMDTargets_static.cmake not found` | `sudo touch /usr/lib64/cmake/{CAMD,CCOLAMD}/{CAMD,CCOLAMD}Targets_static.cmake`. Fedora's `suitesparse-devel` 7.11.0 references static-target CMake files that aren't actually shipped — empty stubs are enough.                                                                                       |
| `pycolmap` build can't find COLMAP                | The provided `python/incremental_build.sh` doesn't forward env vars through scikit-build. Build it manually: `uv pip install --no-build-isolation -Cbuild-dir="$PWD/python/build" -Ccmake.define.colmap_DIR="$PWD/install/share/colmap" -Ccmake.define.CMAKE_CUDA_HOST_COMPILER=/usr/bin/g++-15 -ve .` |

### LichtFeld Studio

| Symptom                                                                                    | Fix                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| vcpkg SDL3 build dies on `XCURSOR` / `XTEST` / GTK3                                        | `dnf install libXcursor-devel libXtst-devel libXi-devel libXfixes-devel libXrandr-devel wayland-devel wayland-protocols-devel mesa-libEGL-devel libdecor-devel ibus-devel dbus-devel gtk3-devel`. The vcpkg port unconditionally enables x11+wayland+ibus on Linux and the README hints are apt-only.                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `nvcc fatal: unsupported host compiler`                                                    | Same fix as COLMAP — pin gcc-15 as CUDA's host compiler. I patched [`CMakeLists.txt`](https://github.com/MrNeRF/Lichtfeld-Studio) to auto-detect gcc-15 on Linux so a clean clone Just Works on this distro.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `cmake` keeps restoring a broken cached SDL3 from vcpkg                                    | `./vcpkg remove sdl3:x64-linux --recurse ...` then re-configure with `VCPKG_BINARY_SOURCES='clear;default,write'` so vcpkg ignores the read cache.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `LFS_SDL3_HAS_LINUX_GUI_BACKEND - Failed` (a runtime `try_run` probe that segfaults)       | Replaced the probe with a static `nm` symbol check for `X11_bootstrap` / `Wayland_bootstrap` in `cmake/LinuxGuiSanity.cmake`. The runtime probe was a false negative — SDL3 was fine, the probe wasn't.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `dlopen("libusd_arch.so")` segfaults before `main`                                         | The real fight. **binutils 2.46's default `-z separate-code` has a regression on shared libs with large `.bss`.** OpenUSD ships a 64 MB BSS buffer in `pxr/base/arch/stackTrace.cpp`. The huge BSS pushes `.init` / `.plt` into a separate high-vaddr LOAD segment, but the `_init` symbol from `crti.o` keeps its original low-vaddr value. So `DT_INIT` points at offset `0x294` — straight into ELF header garbage. **Fix:** add `-Wl,-z,noseparate-code` to the linker flags via a vcpkg overlay triplet (`cmake/vcpkg-overlay-triplets/x64-linux.cmake`). USD then loads cleanly. I chased this through patching `DT_INIT` post-hoc with Python, shrinking the BSS, swapping `mold` for `bfd`, and finally found the OpenUSD issue thread that names binutils as the culprit. |
| Wayland session: `Installed Vulkan doesn't implement the VK_KHR_wayland_surface extension` | Add `"wayland"` to `vulkan-loader`'s feature list in `vcpkg.json`. The vcpkg port doesn't enable Wayland WSI by default.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |

The full diff of those fixes is up as a [LichtFeld Studio PR write-up](https://github.com/MrNeRF/Lichtfeld-Studio); the COLMAP build steps live in [the gaussian_test README](https://github.com/nicholasmullikin/nanlite). I sent the binutils investigation upstream too — it's the kind of bug that's going to bite every rolling-distro user who builds OpenUSD from source until binutils 2.47 backports the fix.

## What this is for

3DGS on its own is a curiosity. What's interesting is that the entire stack — feature matching, bundle adjustment, MVS, neural rasterization — now runs on a single consumer GPU in ten minutes for a small object, from a phone video. The thing standing between you and a photoreal 3D model is no longer a render farm; it's whether you can convince your toolchain to compile on whatever distro you're using.
