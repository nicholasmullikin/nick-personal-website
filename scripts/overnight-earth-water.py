"""Run paired water comparisons on the local Earth preview and publish their measurements."""
import argparse
import csv
import datetime as dt
import fcntl
from contextlib import contextmanager
import html
import json
import os
from pathlib import Path
import statistics
import subprocess
import time

from PIL import Image, ImageOps

SITE = Path(__file__).resolve().parents[1]
BROWSERS = ["chromium", "firefox"]
RESOLUTIONS = ["1920x1080", "3840x2160"]
WINDS = ["calm", "breezy", "rough"]
CASES = ["waterfront,inlet,quay", "ocean,cloud,overcast", "moon,sunset,orbit", "down,coast,dry", "alpine,rainsea,fairsea"]
CAMERAS = {
    "Zürich waterfront": ("47.36555,8.5426,406,120,82,26", 5.5),
    "Campus Lagoon": ("34.40845,-119.8461,1,90,81,12", 15.5),
    "Walensee mountain reflections": ("47.1211,9.2114,419,480,82,346", 4.8),
    "Overcast Pacific": ("0,-140,0,360,82,249", 18.6),
    "Clear Pacific": ("0,-140,0,360,82,249", 18.6),
    "Pacific sunset": ("0,-140,0,650,81,249", 19.1),
}


def atomic(path, contents):
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(contents)
    tmp.replace(path)


@contextmanager
def gpu_slot(state_dir):
    # The browser health check and recovery jobs share the timing GPU.
    with (state_dir / "capture-gpu.lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        yield


def comparison_sheet(folder, public):
    pairs = []
    for candidate in sorted(folder.glob("*-coastal-*.jpg")):
        original = candidate.with_name(candidate.name.replace("-coastal-", "-baseline-", 1))
        if original.is_file() and original.stat().st_size and candidate.stat().st_size:
            pairs.append((original, candidate))
    if not pairs:
        return None

    def destination(count):
        return public / f"{folder.name}-{count}.jpg"

    dest = destination(len(pairs))
    newest = max(source.stat().st_mtime for pair in pairs for source in pair)
    if dest.exists() and dest.stat().st_mtime >= newest:
        return dest.name

    rows = []
    for pair in pairs:
        row = Image.new("RGB", (720, 202))
        try:
            for column, source in enumerate(pair):
                with Image.open(source) as im:
                    row.paste(ImageOps.contain(im, (360, 202)), (column * 360, 0))
        except OSError:
            continue
        rows.append(row)
    if not rows:
        return None
    dest = destination(len(rows))
    sheet = Image.new("RGB", (720, len(rows) * 202))
    for index, row in enumerate(rows):
        sheet.paste(row, (0, index * 202))
    temp = dest.with_suffix(".tmp")
    sheet.save(temp, "JPEG", quality=87)
    temp.replace(dest)
    return dest.name


def report(root, public, status):
    rows = []
    pairs = {}
    for path in sorted(root.glob("round-*/*.json")):
        try:
            capture = json.loads(path.read_text())
        except (OSError, ValueError):
            continue
        data = capture["stats"]
        gpu = data["gpu"].get("frame", {})
        row = [path.parent.name, path.name.split("-")[0], "x".join(map(str, data["size"])),
               capture["name"], capture["wind"], capture["model"], capture["settled"],
               len(capture["errors"]), gpu.get("samples"), gpu.get("median"), gpu.get("p95"),
               data["cpu"]["p95"], data["wallP95"], data.get("build")]
        rows.append(row)
        if capture["settled"] and not capture["errors"] and not data.get("failedPrograms") and gpu.get("samples", 0) >= 10:
            pairs.setdefault(tuple(row[:5]), {})[capture["model"]] = row
    public.mkdir(parents=True, exist_ok=True)
    csv_tmp = public / "measurements.tmp"
    with csv_tmp.open("w") as f:
        writer = csv.writer(f)
        writer.writerow(["round", "browser", "drawing_buffer", "scene", "wind", "model",
                         "settled", "errors", "gpu_samples", "gpu_median_ms", "gpu_p95_ms",
                         "cpu_p95_ms", "render_interval_p95_ms", "bundle"])
        writer.writerows(rows)
    csv_tmp.replace(public / "measurements.csv")
    deltas = {}
    for key, pair in pairs.items():
        if "baseline" not in pair or "coastal" not in pair or pair["baseline"][-1] != pair["coastal"][-1]:
            continue
        deltas.setdefault(key[2], []).append(pair["coastal"][10] - pair["baseline"][10])
    metrics = " ".join(f"<p>{resolution}: {len(values)} paired scenes, median change in p95 GPU time {statistics.median(values):+.2f} ms, largest {max(values):+.2f} ms.</p>"
                       for resolution, values in sorted(deltas.items()))
    links = []
    for title, (pose, sun) in CAMERAS.items():
        cloud = 6 if title == "Overcast Pacific" else "off"
        links.append(f"<li>{title} — " + " · ".join(
            f'<a href="/blog/earth/?view={pose}&amp;sun={sun}&amp;cloud={cloud}&amp;wind=calm&amp;reflection={mode}">{label}</a>'
            for mode, label in [("baseline", "Original"), ("waves", "Water and sky"), ("coastal", "Shore reflections"), ("mask", "Water coverage")]) + "</li>")
    def poster(movie):
        still = movie.with_suffix(".jpg")
        return f'poster="{still.name}"' if still.exists() else ""

    clips = "".join(f'<figure><figcaption>{html.escape(movie.stem.title())} · Original at left, candidate at right</figcaption><video controls preload="none" {poster(movie)} src="{movie.name}"></video></figure>'
                    for movie in sorted(public.glob("*.mp4")))
    galleries = []
    for folder in sorted(root.glob("round-*"), reverse=True):
        sheet = comparison_sheet(folder, public)
        if sheet:
            galleries.append(f'<a href="{sheet}">{html.escape(folder.name)}</a>')
    gallery = " · ".join(galleries)
    failures = len(list(root.glob("round-*/*.error")))
    page = f"""<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Earth water comparisons</title><style>body{{font:16px/1.5 system-ui;max-width:1150px;margin:2em auto;padding:0 1em;color:#e9f2f3;background:#142128}}a{{color:#9ed9e3}}video{{width:100%}}figure{{margin:1.5em 0}}li{{margin:.6em 0}}</style>
<h1>Earth water comparisons</h1><ul>{''.join(links)}</ul>{clips}
<h2>Overnight measurements</h2><p>{html.escape(status)}. {len(rows)} captures. {failures} failed attempts.</p>
{metrics}<p>Camera comparisons from each round, with the original on the left and the candidate on the right.</p><p>{gallery}</p><p><a href="measurements.csv">Download all measurements</a>. GPU comparisons use matched scenes and builds with at least ten GPU samples per capture. Firefox also records CPU frame time and the interval between rendered frames.</p></html>"""
    atomic(public / "index.html", page)


def main():
    p = argparse.ArgumentParser()
    p.add_argument("root", type=Path)
    p.add_argument("public", type=Path)
    p.add_argument("--round-interval", type=int, default=240, help="Target seconds between round starts")
    p.add_argument("--end", help="UTC end time in ISO 8601 format")
    args = p.parse_args()
    args.root.mkdir(parents=True, exist_ok=True)
    if not args.end:
        report(args.root, args.public, "Initial comparisons")
        return
    browser_tmp = args.root.parent.resolve() / "browser-tmp"
    browser_tmp.mkdir(mode=0o700, exist_ok=True)
    end = dt.datetime.fromisoformat(args.end).timestamp()
    previous = [int(p.name[6:]) for p in args.root.glob("round-[0-9][0-9][0-9]")]
    round_number = max(previous, default=-1) + 1
    while time.time() < end - 120:
        started = time.time()
        folder = args.root / f"round-{round_number:03}"
        folder.mkdir(exist_ok=True)
        engine = BROWSERS[(round_number // 2) % 2]
        size = RESOLUTIONS[round_number % 2]
        wind = WINDS[(round_number // 4 + round_number % 2) % 3]
        cases = CASES[round_number % len(CASES)]
        models = ["baseline", "coastal"] if round_number % 3 else ["baseline", "waves", "coastal"]
        if round_number % 2:
            models.reverse()
        for model in models:
            remaining = int(end - time.time())
            if remaining < 90:
                break
            label = f"Round {round_number + 1} · {engine} · {size} · {wind} · {model}"
            report(args.root, args.public, label)
            for scene in cases.split(","):
                command = ["node", "scripts/check-earth-water-reflections.cjs", str(folder),
                           model, engine, size, scene, wind]
                for attempt in range(2):
                    if time.time() > end - 60:
                        break
                    try:
                        with gpu_slot(args.root.parent), (folder / f"{model}.log").open("a") as log:
                            subprocess.run(command, cwd=SITE, stdin=subprocess.DEVNULL, stdout=log,
                                           stderr=subprocess.STDOUT, timeout=min(150, end-time.time()),
                                           env={**os.environ, "TMPDIR": str(browser_tmp),
                                                "EARTH_WATER_MOTION": "1" if round_number % 8 >= 4 else ""}, check=True)
                        break
                    except (subprocess.SubprocessError, OSError, ValueError) as err:
                        (folder / f"{model}-{scene}-{attempt}.error").write_text(type(err).__name__)
        round_number += 1
        report(args.root, args.public, f"Completed round {round_number}")
        # Reserve an interval for browser health checks between GPU batches.
        next_start = max(started + args.round_interval, time.time() + 90)
        time.sleep(max(0, min(end, next_start) - time.time()))
    report(args.root, args.public, "Overnight run finished")


if __name__ == "__main__":
    main()
