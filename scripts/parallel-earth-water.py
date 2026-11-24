"""Run six paired visual experiments alongside the isolated timing benchmark."""
import argparse
from datetime import datetime, timezone
import fcntl
import html
import json
import os
from pathlib import Path
import subprocess
import time

from PIL import Image, ImageDraw, ImageStat

# Each entry varies one setting. Camera and time are identical within the pair.
TRIALS = [
    ("waterfront", "Zürich reflection detail", "512 × 320 / 1024 × 640", {}, {"largeShore": True}),
    ("alpine", "Walensee wind", "Calm / rough", {}, {"wind": "rough"}),
    ("coast", "Campus Point shoreline", "Sky and waves / local reflections", {"model": "waves"}, {}),
    ("fairsea", "Pacific sun glitter", "GGX / directional slopes", {"glint": "ggx"}, {"glint": "slopes"}),
    ("rainsea", "Overcast water", "Sky and waves / cloud reflections", {"model": "waves"}, {"model": "clouds"}),
    ("moon", "Moonlight on open water", "Calm / rough", {}, {"wind": "rough"}),
]


def batch(folder, side, workers, offset, env):
    settings = [dict({"scene": scene, "model": "coastal", "wind": "calm", "headingOffset": offset}, **trial)
                for scene, _, _, *sides in TRIALS for trial in [sides[side]]]
    folder.mkdir(parents=True, exist_ok=True)
    spec = folder / "cases.json"
    spec.write_text(json.dumps(settings))
    start = time.monotonic()
    subprocess.run(["node", "scripts/check-earth-water-reflections.cjs", "--visual-batch",
                    str(folder), str(spec), str(workers)], env=env, check=True, timeout=210)
    return time.monotonic() - start


def publish(folder, public, timing):
    rows = []
    for scene, title, legend, _, _ in TRIALS:
        row = Image.new("RGB", (960, 330))
        pair = []
        for i, side in enumerate(("original", "variant")):
            with Image.open(folder / side / (scene + ".jpg")) as im:
                im.load()
                if im.size != (800, 500) or max(ImageStat.Stat(im).stddev) < 1:
                    raise ValueError("invalid image: " + scene)
                row.paste(im.resize((480, 300), Image.Resampling.LANCZOS), (i * 480, 30))
            pair.append(json.loads((folder / side / (scene + ".json")).read_text()))
        if pair[0]["bundle"] != pair[1]["bundle"] or pair[0]["pose"] != pair[1]["pose"]:
            raise ValueError("mismatched inputs: " + scene)
        ImageDraw.Draw(row).text((10, 8), title + "    " + legend, fill="white")
        rows.append(row)
    sheet = Image.new("RGB", (960, 330 * len(rows)))
    for i, row in enumerate(rows):
        sheet.paste(row, (0, i * 330))
    dest = public / (folder.name + ".jpg")
    sheet.save(dest, quality=90)
    stamp = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    text = (f"<!doctype html><meta name=viewport content='width=device-width,initial-scale=1'><title>Water visual trials</title>"
            f"<main style='max-width:960px;margin:auto;font:18px system-ui'><h1>Water visual trials</h1>"
            f"<p>{stamp}. Each row shows its control on the left and its variant on the right. Camera offset {timing['heading']}°.</p>"
            f"<img style='width:100%' alt='Six paired water comparisons' src='{html.escape(dest.name)}'></main>")
    tmp = public / "index.tmp"
    tmp.write_text(text)
    tmp.replace(public / "index.html")


def main():
    p = argparse.ArgumentParser()
    p.add_argument("state", type=Path)
    p.add_argument("--end", required=True)
    args = p.parse_args()
    end = datetime.fromisoformat(args.end).timestamp()
    public = args.state / "review" / "visual-trials"
    public.mkdir(parents=True, exist_ok=True)
    env = {**os.environ, "TMPDIR": str(args.state / "browser-tmp")}
    repeat = 0
    while time.time() < end - 120:
        folder = args.state / "visual-trials" / datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
        heading = (0, 10, -10, 20, -20)[repeat % 5]
        timing = {"heading": heading}
        for side, workers, index in [("original", 6, 0), ("variant", 6, 1), ("serial-control", 1, 0)]:
            if side == "serial-control" and (args.state / "visual-throughput.json").exists():
                continue
            with (args.state / "capture-gpu.lock").open("a") as lock:
                fcntl.flock(lock, fcntl.LOCK_EX)
                if time.time() >= end - 60:
                    return
                timing[side] = batch(folder / side, index, workers, heading, env)
            if side == "variant":
                publish(folder, public, timing)
            if side == "serial-control":
                (args.state / "visual-throughput.json").write_text(json.dumps(timing))
        (folder / "duration.json").write_text(json.dumps(timing))
        repeat += 1
        time.sleep(max(0, min(240, end-time.time())))


if __name__ == "__main__":
    main()
