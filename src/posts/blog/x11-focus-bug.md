---
title: "Why Firefox looked focused while Slack got my typing."
category: "Linux"
date: "2026-10-27 12:00:00 -04:00"
desc: "A bad drag-and-drop timestamp crossed GTK, Firefox, Mutter and Xorg—and separated the window that looked active from the one receiving my keys."
thumbnail: "./images/x11-focus-bug/thumbnail.png"
alt: "Layered diagram connecting Files, Firefox, Slack, GTK, Mutter and Xorg, with the broken focus path marked in red"
tags: ["Linux", "X11", "GTK", "Firefox", "Debugging"]
---

Sometimes I would switch windows on Ubuntu, start typing into the newly raised window, and discover that the text had gone to the old application. Firefox looked active; Slack or a terminal still received the keys. Switching away and back usually cleared it.

The intermittent behavior made it easy to blame Alt-Tab, a dock, or an input method. A monitor comparing the window manager’s active window with the X server’s keyboard focus eventually captured a more specific failure. A drag-and-drop operation had introduced a timestamp about **15 days in the future**. Firefox was still reusing it five days later.

This investigation concerns GNOME on **X11**, on my Ubuntu 24.04 laptop. It does not establish that every superficially similar focus problem has this cause.

## The parts of a Linux desktop

An application such as Firefox or Slack is a process. A toolkit such as **GTK** is a library loaded into that process, handling widgets and integration with the desktop. Think of the role AppKit plays on macOS or WinUI on Windows, without assuming identical implementations. Firefox draws much of its own interface but uses GTK for Linux integration. Files, GNOME’s file manager, uses GTK too. Slack uses Electron and Chromium.

**X11** is a protocol. **Xorg** is the display-server process implementing it here. Applications send requests over X11 connections; Xorg maintains windows and input state and delivers keyboard events.

**Mutter**, running inside GNOME Shell, is the window manager and compositor. It chooses which window should be active, controls stacking and combines windows into the desktop image. It cooperates with Xorg, but the two maintain distinct state.

There are consequently several meanings of “focus”: Mutter’s active top-level window, Xorg’s actual keyboard-focus window, and the text field an application selects internally. Normally these agree. A highlighted title bar only tells you part of the story.

<!-- X11_FOCUS_DIAGRAM -->

## A timestamp that could not have happened yet

X11 timestamps are 32-bit millisecond values from the display server’s clock, not Unix dates. They wrap roughly every 49.7 days. They let the desktop relate requests to user actions and avoid applying an old focus request after a newer interaction. Comparisons must account for wraparound.

The first defect was in GTK4’s drag-and-drop implementation. Its `drop-performed` signal supplied no timestamp argument, but a callback expected one. Data that was not a timestamp could therefore be interpreted as one and sent in an `XdndDrop` message. The callback mismatch is tracked in [GTK issue 8307](https://gitlab.gnome.org/GNOME/gtk/-/work_items/8307).

On **October 21**, my capture recorded a real Files-to-Firefox drop carrying `1413247760`, when the server clock was `116326755`. The difference was about 15 days. Firefox’s user-time property adopted that value 18 milliseconds later. The original contents of the missing callback argument were not captured; the outgoing protocol value was.

The second problem made that momentary corruption persistent. GTK3, used by Firefox here, maintains a cached “last user interaction” time that advances when it sees a newer value. A plausible-looking future value can enter that cache. Subsequent genuine input looks older, so it cannot repair the cache until time catches up. Changing a public window property alone does not necessarily reset the private cached value. This behavior is discussed in [GTK issue 8318](https://gitlab.gnome.org/GNOME/gtk/-/work_items/8318).

## Raised successfully, focused unsuccessfully

On **October 26**, Firefox requested activation with the exact same `1413247760` value. The server clock was now around `321267315`: the request was still roughly 12.6 days early.

Mutter accepted the activation and made Firefox visually active. For this Firefox window, it sent a `WM_TAKE_FOCUS` message inviting the application to take keyboard focus with the supplied time. Firefox then requested the focus change from Xorg.

Xorg’s rules require it to **ignore a focus request dated in the future**; an older-than-last-focus-change time is invalid too. There is no protocol error announcing that refusal. The [Xlib specification](https://xorg.freedesktop.org/archive/X11R7.6/doc/libX11/specs/libX11/libX11.html#XSetInputFocus) describes this behavior.

Mutter’s active-window state had changed, but Xorg’s keyboard focus had not. At 13:58:07 the monitor recorded the disagreement, and at 13:58:18 it recorded a key press while the terminal retained focus. Slack appears as the previous application in the diagram; the same mechanism applies to either recipient. Ordinary key contents were redacted. The example “a” in the diagram is illustrative.

## Why Firefox was especially vulnerable

There is another propagation route, separate from the captured drop. Firefox’s launcher can synthesize a startup token by scanning windows for their user-time properties and choosing the numerically largest value. A future value from another application can therefore contaminate Firefox without a direct drop into its window. I reproduced that route separately in an isolated test using an injected future property.

The wider chain is described in [Firefox bug 2053470](https://bugzilla.mozilla.org/show_bug.cgi?id=2053470#c3). It explains why merely finding a bad timestamp on Firefox would not identify where it originated. It also explains the intermittency: the cache can remain poisoned, while only particular activation paths reuse that time. This does not mean every Alt-Tab must fail.

## What “fixed upstream” means here

GTK’s callback correction was merged in [merge request 10132](https://gitlab.gnome.org/GNOME/gtk/-/merge_requests/10132) and included in [GTK 4.24.0](https://github.com/GNOME/gtk/blob/4.24.0/NEWS). That removes the identified source of malformed drops. It does not by itself prove that the cache, launcher and focus-handling weaknesses are all repaired—or that Ubuntu’s installed GTK packages contain the change.

The useful diagnostic was recording both kinds of focus, then tracing the timestamp across process boundaries. The window on top and the window receiving keys were separate facts. Once those were measured separately, the apparently random behavior became a chain of individually understandable decisions.
