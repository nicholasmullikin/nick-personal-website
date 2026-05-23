---
title: "Watching a beaker stir, on a phone, with nothing in the cloud"
category: "Projects"
date: "2026-05-21 18:00:00 +00:00"
desc: "A single HTML file that fuses on-device object detection and audio classification into a structured event stream."
thumbnail: "./images/sensor-fusion/thumbnail.jpg"
alt: "lab perception demo"
---

I had a question I couldn't shake: how much "lab perception" can you do _on a phone_, with no backend at all?

The pretext was a chemistry demo — watching someone stir a glass beaker with a metal rod and figuring out, in real time, what was going on. Object detection finds the beaker. Audio classification listens for the stir. Fusion glues them together: "stirring in vessel A", "impact while vessel A is present", "stirring complete".

The whole thing is a single `index.html`. Frames and audio never leave the device.

![UI showing camera feed with detected vessels, audio spectrum, and a structured event log — TODO replace with screenshot](./images/sensor-fusion/thumbnail.jpg)

## The pitch

You tap the page once. The browser asks for camera and mic in a single prompt. After that, three panes light up:

- A camera feed with detected vessels boxed and labelled `vessel A`, `vessel B`, `vessel C`...
- An audio spectrum and a YAMNet[^1] readout: `stirring 67%`, `impact 41%`, etc.
- A structured event log: `vessel_detected · A · 71% · cup`, `stir_start · yamnet 31% · vessel A`, `stirring_in_vessel · stir + vessel in view · vessel A`, `stir_end · yamnet 8% · vessel A`.

If you don't grant permissions, or your camera is held by another app, the page falls back to a canned demo video so the rest of the system still has something to react to.

## Three pipelines, one HTML file

Three loops run concurrently:

| Loop   | Cadence                                   | Model                                                                       |
| ------ | ----------------------------------------- | --------------------------------------------------------------------------- |
| Vision | per video frame (`requestAnimationFrame`) | MediaPipe `ObjectDetector` (EfficientDet-Lite0, GPU delegate, CPU fallback) |
| Audio  | every 500 ms                              | YAMNet via MediaPipe Tasks Audio (1 s rolling window)                       |
| Fusion | every 500 ms                              | Plain JavaScript rules over a 2-second event window                         |

That's it. No worker pool, no inference server, no service workers. Two `<script type="module">` imports off `cdn.jsdelivr.net` and you're running EfficientDet-Lite0 and YAMNet on a browser tab.

## The vessel tracker

Naive object detection gives you boxes per frame, with no identity. If you want "vessel A" to stay "vessel A" while a hand reaches across, the vessel briefly leaves frame, or the camera is reframed, you need a tracker.

The one in `index.html` is a small IoU-greedy multi-object tracker with three states:

```
tentative  -> not yet confirmed; box but no event emitted
confirmed  -> hit threshold met; vessel_detected emitted
stale      -> confirmed but currently missing; vessel_lost emitted,
              still eligible for re-id within VESSEL_STALE_MS (5s)
```

The constants are tuned for "phone in your hand looking at a benchtop":

- `VESSEL_HIT_FRAMES = 3` — confirm a sighting after about 100 ms.
- `VESSEL_MISS_FRAMES = 20` — about 700 ms of misses before declaring lost.
- `VESSEL_STALE_MS = 5000` — re-id window after going lost.
- `VESSEL_IOU_ACTIVE = 0.30` / `VESSEL_IOU_STALE = 0.15` — relaxed threshold when re-acquiring.

Labels are sequential letters (`A`, `B`, `C`, ...) and **never reused** within a session, even after a track expires. The next new vessel always gets the next letter, so the event log stays unambiguous if you read it back later.

## YAMNet thinks stirring is a glockenspiel

Here is the part I did not see coming.

YAMNet[^1] is trained on AudioSet, which has a perfectly reasonable label called `Stir`. The natural assumption is: stir a beaker, get high `Stir` confidence, done.

In practice, a metal rod tapping the inside of a glass beaker is acoustically a _struck idiophone_. Rhythmic metal-strike transients with ringing decay. AudioSet has labels for that too — but they live in the percussion family. YAMNet routes my beaker stirs through `Glockenspiel`, `Vibraphone`, `Tubular bells`, `Wind chime`, `Chime`, `Bell`, and `Cymbal` more often than `Stir`, `Cutlery`, or `Dishes, pots, and pans`.

So the regex accepts both families:

```javascript
const STIR_NAME_RE = /\b(stir|cutlery|silverware|dishes,? pots|chink|clink|
  clatter|jingle|tinkle|glass|music|musical instrument|glockenspiel|
  vibraphone|tubular bell|chime|wind chime|bell|tuning fork|marimba|
  xylophone|rattle|cowbell|gong|cymbal)\b/i;
```

The displayed label is then remapped from the raw YAMNet category back into our task vocabulary, so the UI doesn't say "music 67%" while the user is stirring a beaker:

```javascript
if (STIR_NAME_RE.test(topLabel)) yamnetTopLabel = "stirring"
else if (IMPACT_NAME_RE.test(topLabel)) yamnetTopLabel = "impact"
else yamnetTopLabel = topLabel.toLowerCase()
```

This regex is, embarrassingly, the most important line in the file.

## Hysteresis and locked labels

A classifier producing one score every 500 ms will jitter. If you wired it directly to `stir_start` / `stir_end`, the event log would be a mess. Two pieces of state quiet it down:

- **Schmitt-trigger hysteresis** on the stir score. `STIR_SCORE_ON = 0.25` to flip on, `STIR_SCORE_OFF = 0.10` to flip off, and you have to hold those values for 2 frames on / 3 frames off (~1 s on, ~1.5 s off).
- **Vessel label locking.** When `stir_start` fires, the active vessel is captured into `currentStirVesselLabel` and held there until `stir_end`. If the active vessel switches mid-stir — because someone reaches across or because vessel B happens to score higher for a frame — the entire stir is still attributed to vessel A. The event log says one consistent thing per stir, which is what a human reviewer expects.

The `impact` event uses the same idea but simpler: a 600 ms debounce so a single `Knock`-class transient produces one event, not five.

## The demo-mode fallback

The page assumes the worst about device permissions. There are three concrete failure modes I kept hitting on real phones:

- The user denies camera but allows mic, or vice versa. The page asks for them separately if the combined request was denied.
- Another app (Snapchat, Instagram, the system camera) is _holding_ the camera. The track shows up, but is muted at start or never produces frames.
- The user is in a dark environment (lens covered, lights off).

A small watchdog reads a 16×16 pixel sample of the video frame every 500 ms, looks at the maximum channel value, and if it's below 10 for three consecutive seconds, prompts:

> **camera appears dark.** No visible light has reached the camera for the last 3 seconds. The lens may be covered, or the device is in a dark environment.
>
> _\[ swap to demo video \]_ • _keep trying_

If the user agrees, the visible `<video>` is repointed at `demo.mp4`, the audio source is swapped to a hidden video element's `captureStream()`, and the rest of the system keeps running unchanged. The fusion engine doesn't know or care whether it's looking at a live camera or a canned recording.

## Why bother

Multimodal perception used to be a server farm. Object detection plus speech plus event reasoning meant Triton, GPUs, gRPC, and a lot of YAML. Doing the same thing in a browser tab, on a phone you already own, with the model weights coming off a CDN — that's still novel enough that it surprises me every time it works.

Also: it's a great party trick. Stir a beaker. Watch the page narrate what you're doing.

[^1]: YAMNet is a small audio classifier trained on Google's AudioSet ontology — about 521 classes covering everything from "Domestic animals, pets" to "Tubular bells". I'm using it via MediaPipe Tasks Audio, hosted on `cdn.jsdelivr.net` because the Kaggle and tfhub URLs started returning 403s to browser fetches in late 2025.
