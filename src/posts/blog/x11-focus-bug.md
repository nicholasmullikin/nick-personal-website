---
title: "Why Firefox looked focused while Slack got my typing."
category: "Linux"
date: "2026-10-27 12:00:00 -04:00"
desc: "A drag-and-drop timestamp 15 days in the future made Firefox look active while another app received the keys."
thumbnail: "./images/x11-focus-bug/thumbnail.png"
alt: "Layered diagram connecting Files, Firefox, Slack, GTK, Mutter and Xorg, with the broken focus path marked in red"
tags: ["Linux", "X11", "GTK", "Firefox", "Debugging"]
---

On Ubuntu’s GNOME/X11 desktop, Firefox sometimes came forward while my typing went to Slack or a terminal. The cause: a drag-and-drop timestamp **15 days in the future**.

## Who owns focus?

**GTK** is a library inside applications, roughly analogous to AppKit or WinUI. Files uses GTK4; Firefox uses GTK3 for Linux integration. Slack uses Electron/Chromium.

**X11** is the protocol connecting these applications to **Xorg**, the display server that delivers keyboard events. **Mutter**, GNOME Shell’s window manager and compositor, chooses the active window and assembles the desktop image.

Mutter’s **active window** and Xorg’s **keyboard focus** are separate state. Usually they agree.

<!-- X11_FOCUS_DIAGRAM -->

## The failure

GTK4’s drag-and-drop callback expected an argument its signal never supplied. The resulting bogus timestamp reached Firefox, where GTK3’s “only newer” user-time cache kept it: real input now looked older.

Firefox later reused that time to request activation. Mutter raised Firefox and sent `WM_TAKE_FOCUS`. Firefox requested keyboard focus, but [Xorg silently ignores future-dated focus requests](https://xorg.freedesktop.org/archive/X11R7.6/doc/libX11/specs/libX11/libX11.html#XSetInputFocus). The previous app kept receiving keys.

X timestamps are 32-bit server-clock milliseconds, not dates. The diagram’s hover/tap examples show the actual values and message formats.

## The evidence

On **October 21**, a Files-to-Firefox drop carried a time 15 days ahead; Firefox adopted it 18 ms later. On **October 26**, Firefox reused that exact value. The monitor recorded Firefox active while a terminal retained keyboard focus, followed by a key press. The diagram substitutes Slack for that terminal.

A [separate launcher path](https://bugzilla.mozilla.org/show_bug.cgi?id=2053470#c3) can import another window’s bad time. I reproduced it with an injected value; it was not the captured drop route.

## Fixed?

The [GTK4 callback fix](https://gitlab.gnome.org/GNOME/gtk/-/merge_requests/10132) shipped in [GTK 4.24.0](https://github.com/GNOME/gtk/blob/4.24.0/NEWS). That fixes the identified source, not necessarily the [cache behavior](https://gitlab.gnome.org/GNOME/gtk/-/work_items/8318), launcher, or focus handling—and does not mean Ubuntu’s installed packages contain it.
