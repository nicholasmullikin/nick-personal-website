#!/usr/bin/env python3
"""
Volume wheel debounce filter for Corsair K70 RGB TKL.

The K70's rotary encoder exhibits contact bounce, sending rapid alternating
KEY_VOLUMEUP/KEY_VOLUMEDOWN events when turned in one direction. This filter:

1. Accumulates volume events over a short debounce window (default 30ms)
2. Uses direction momentum: once a scroll direction is established from clean
   events, noisy/ambiguous windows are forced to that direction
3. Resets direction lock after a gesture timeout (default 200ms pause)

All non-volume keyboard events are forwarded immediately with zero added latency.

Run with --test for a guided interactive test to evaluate filter quality.
"""

import asyncio
import argparse
import sys
import time

import evdev
from evdev import ecodes, UInput

VOLUME_KEYS = frozenset({ecodes.KEY_VOLUMEUP, ecodes.KEY_VOLUMEDOWN})
KEY_NAMES = {ecodes.KEY_VOLUMEUP: "UP", ecodes.KEY_VOLUMEDOWN: "DN"}

BLUE = "\033[94m"
GREEN = "\033[92m"
YELLOW = "\033[93m"
RED = "\033[91m"
BOLD = "\033[1m"
DIM = "\033[2m"
RESET = "\033[0m"


def find_device(vendor, product):
    for path in evdev.list_devices():
        dev = evdev.InputDevice(path)
        if dev.info.vendor == vendor and dev.info.product == product:
            caps = dev.capabilities()
            if ecodes.EV_KEY in caps:
                key_caps = caps[ecodes.EV_KEY]
                if ecodes.KEY_A in key_caps and ecodes.KEY_VOLUMEUP in key_caps:
                    return dev
        dev.close()
    return None


class VolumeFilter:
    def __init__(self, ui, debounce_ms, gesture_timeout_ms, verbose=False):
        self.ui = ui
        self.debounce_s = debounce_ms / 1000.0
        self.gesture_timeout_s = gesture_timeout_ms / 1000.0
        self.verbose = verbose

        self.accumulator = 0
        self.up_count = 0
        self.dn_count = 0
        self.timer_handle = None
        self.window_start = 0.0
        self.last_event_time = 0.0
        self.locked_direction = None

        self.emit_log_up = 0
        self.emit_log_dn = 0
        self.raw_log_up = 0
        self.raw_log_dn = 0

        self.loop = asyncio.get_running_loop()

    def reset_counters(self):
        self.emit_log_up = 0
        self.emit_log_dn = 0
        self.raw_log_up = 0
        self.raw_log_dn = 0

    def do_emit(self, direction, count):
        key = ecodes.KEY_VOLUMEUP if direction == "UP" else ecodes.KEY_VOLUMEDOWN
        for _ in range(count):
            self.ui.write(ecodes.EV_KEY, key, 1)
            self.ui.write(ecodes.EV_SYN, ecodes.SYN_REPORT, 0)
            self.ui.write(ecodes.EV_KEY, key, 0)
            self.ui.write(ecodes.EV_SYN, ecodes.SYN_REPORT, 0)
        if direction == "UP":
            self.emit_log_up += count
        else:
            self.emit_log_dn += count

    def flush(self):
        self.timer_handle = None
        elapsed = (time.monotonic() - self.window_start) * 1000 \
            if self.window_start else 0
        net = self.accumulator
        total = self.up_count + self.dn_count

        saved_up = self.up_count
        saved_dn = self.dn_count
        self.accumulator = 0
        self.up_count = self.dn_count = 0
        self.window_start = 0.0

        if total == 0:
            return

        minority = min(saved_up, saved_dn)
        is_clean = minority == 0
        net_dir = "UP" if net > 0 else ("DN" if net < 0 else None)
        tag = f"{saved_up}UP {saved_dn}DN = net {net:+d}"

        if self.locked_direction is None:
            if net_dir:
                self.locked_direction = net_dir
                self.do_emit(net_dir, abs(net))
                if self.verbose:
                    print(f"  FLUSH: {tag} | NEW LOCK {self.locked_direction}, "
                          f"emit {abs(net)}x {net_dir} ({elapsed:.0f}ms)",
                          flush=True)
            else:
                if self.verbose:
                    print(f"  FLUSH: {tag} | no lock yet, "
                          f"dropped ({elapsed:.0f}ms)", flush=True)

        elif net_dir == self.locked_direction:
            self.do_emit(self.locked_direction, abs(net))
            if self.verbose:
                print(f"  FLUSH: {tag} | lock={self.locked_direction}, "
                      f"emit {abs(net)}x {self.locked_direction} "
                      f"({elapsed:.0f}ms)", flush=True)

        elif net_dir is None:
            self.do_emit(self.locked_direction, 1)
            if self.verbose:
                print(f"  FLUSH: {tag} | lock={self.locked_direction}, "
                      f"net=0 bounce -> emit 1x {self.locked_direction} "
                      f"({elapsed:.0f}ms)", flush=True)

        else:
            if is_clean and abs(net) >= 2:
                self.locked_direction = net_dir
                self.do_emit(net_dir, abs(net))
                if self.verbose:
                    print(f"  FLUSH: {tag} | DIRECTION CHANGE -> "
                          f"{self.locked_direction}, emit {abs(net)}x "
                          f"{net_dir} ({elapsed:.0f}ms)", flush=True)
            else:
                self.do_emit(self.locked_direction, 1)
                if self.verbose:
                    reason = "stray" if is_clean else "noisy"
                    print(f"  FLUSH: {tag} | lock={self.locked_direction} "
                          f"OVERRIDE ({reason}), emit 1x "
                          f"{self.locked_direction} ({elapsed:.0f}ms)",
                          flush=True)

    def on_volume_press(self, code):
        now = time.monotonic()
        name = KEY_NAMES[code]

        if self.last_event_time and \
                (now - self.last_event_time) > self.gesture_timeout_s:
            if self.verbose:
                gap_ms = (now - self.last_event_time) * 1000
                print(f"  --- gesture reset (gap {gap_ms:.0f}ms, "
                      f"was {self.locked_direction}) ---", flush=True)
            self.locked_direction = None

        self.last_event_time = now

        if code == ecodes.KEY_VOLUMEUP:
            self.accumulator += 1
            self.up_count += 1
            self.raw_log_up += 1
        else:
            self.accumulator -= 1
            self.dn_count += 1
            self.raw_log_dn += 1

        if self.verbose:
            dt = (now - self.window_start) * 1000 if self.window_start else 0
            print(f"  IN: {name}  acc={self.accumulator:+d}  "
                  f"t={dt:.1f}ms  lock={self.locked_direction}", flush=True)

        if self.timer_handle is None:
            self.window_start = now
            self.timer_handle = self.loop.call_later(
                self.debounce_s, self.flush)

    def cancel_pending(self):
        if self.timer_handle:
            self.timer_handle.cancel()
            self.timer_handle = None
        try:
            self.flush()
        except Exception:
            pass


async def process_events(dev, filt):
    """Read events from device, filter volume keys, forward the rest."""
    async for event in dev.async_read_loop():
        if event.type == ecodes.EV_KEY and event.code in VOLUME_KEYS:
            if event.value == 1:
                filt.on_volume_press(event.code)
            continue
        filt.ui.write_event(event)


async def wait_for_enter():
    loop = asyncio.get_running_loop()
    await loop.run_in_executor(None, sys.stdin.readline)


async def run_test_phase(filt, phase_num, total_phases, title, instructions,
                         expected_dir, duration):
    filt.reset_counters()

    print(f"\n{BOLD}--- Test {phase_num}/{total_phases}: {title} ---{RESET}")
    print(f"  {instructions}")
    print(f"\n  {DIM}Press ENTER when ready...{RESET}", end="", flush=True)
    await wait_for_enter()
    print(f"  {BOLD}GO!{RESET} Listening for {duration} seconds...\n", flush=True)

    for i in range(duration):
        await asyncio.sleep(1)
        bar_done = "=" * (i + 1)
        bar_left = "-" * (duration - i - 1)
        print(f"\r  [{bar_done}{bar_left}] {i+1}/{duration}s  "
              f"emitted: {filt.emit_log_dn} DN, {filt.emit_log_up} UP  "
              f"{DIM}(raw: {filt.raw_log_dn} DN, {filt.raw_log_up} UP){RESET}",
              end="", flush=True)

    print()

    e_up = filt.emit_log_up
    e_dn = filt.emit_log_dn
    r_up = filt.raw_log_up
    r_dn = filt.raw_log_dn
    total = e_up + e_dn
    raw_total = r_up + r_dn

    if total == 0:
        status = f"{YELLOW}NO INPUT DETECTED{RESET}"
    elif expected_dir == "DN":
        correct = e_dn
        wrong = e_up
        pct = correct / total * 100 if total else 0
        raw_wrong = r_up
        raw_pct = (raw_total - raw_wrong) / raw_total * 100 \
            if raw_total else 0
        if wrong == 0:
            status = f"{GREEN}PERFECT{RESET}"
        elif pct >= 90:
            status = f"{GREEN}GOOD ({pct:.0f}% correct){RESET}"
        elif pct >= 70:
            status = f"{YELLOW}OK ({pct:.0f}% correct){RESET}"
        else:
            status = f"{RED}NEEDS TUNING ({pct:.0f}% correct){RESET}"
    elif expected_dir == "UP":
        correct = e_up
        wrong = e_dn
        pct = correct / total * 100 if total else 0
        raw_wrong = r_dn
        raw_pct = (raw_total - raw_wrong) / raw_total * 100 \
            if raw_total else 0
        if wrong == 0:
            status = f"{GREEN}PERFECT{RESET}"
        elif pct >= 90:
            status = f"{GREEN}GOOD ({pct:.0f}% correct){RESET}"
        elif pct >= 70:
            status = f"{YELLOW}OK ({pct:.0f}% correct){RESET}"
        else:
            status = f"{RED}NEEDS TUNING ({pct:.0f}% correct){RESET}"
    else:
        status = f"{GREEN}OK{RESET} (both directions)"
        raw_pct = None
        pct = None

    print(f"\n  {BOLD}Result:{RESET} emitted {e_dn} DN, {e_up} UP  [{status}]")
    if raw_total > 0 and expected_dir in ("UP", "DN"):
        print(f"  {DIM}Raw encoder sent {r_dn} DN, {r_up} UP "
              f"({raw_pct:.0f}% correct before filter){RESET}")

    return {
        "title": title,
        "e_up": e_up, "e_dn": e_dn,
        "r_up": r_up, "r_dn": r_dn,
        "expected": expected_dir,
        "status": status,
    }


async def run_test_mode(dev, ui, debounce_ms, gesture_timeout_ms, verbose):
    filt = VolumeFilter(ui, debounce_ms, gesture_timeout_ms, verbose)

    print(f"\n{BOLD}{'=' * 52}")
    print(f"  K70 Volume Wheel Debounce - Guided Test")
    print(f"{'=' * 52}{RESET}")
    print(f"\n  Settings: debounce={debounce_ms}ms, "
          f"gesture_timeout={gesture_timeout_ms}ms")
    print(f"  Keyboard grabbed - your typing works through the filter.")
    print(f"\n  {DIM}Each test will ask you to scroll the volume wheel.")
    print(f"  The filter runs live so you'll see (and hear) the volume change.")
    print(f"  Results compare raw encoder output vs filtered output.{RESET}")

    reader_task = asyncio.create_task(process_events(dev, filt))

    tests = [
        ("Slow scroll DOWN",
         "Scroll the volume wheel DOWN with slow, deliberate single clicks.",
         "DN", 8),
        ("Slow scroll UP",
         "Scroll the volume wheel UP with slow, deliberate single clicks.",
         "UP", 8),
        ("Fast scroll DOWN",
         "Scroll the volume wheel DOWN as fast as you can.",
         "DN", 6),
        ("Fast scroll UP",
         "Scroll the volume wheel UP as fast as you can.",
         "UP", 6),
        ("Direction change",
         "Scroll DOWN for ~3 seconds, pause briefly, then scroll UP.",
         "BOTH", 10),
    ]

    results = []
    for i, (title, instr, expected, dur) in enumerate(tests, 1):
        result = await run_test_phase(
            filt, i, len(tests), title, instr, expected, dur)
        results.append(result)

    reader_task.cancel()
    try:
        await reader_task
    except asyncio.CancelledError:
        pass

    filt.cancel_pending()

    print(f"\n{BOLD}{'=' * 52}")
    print(f"  SUMMARY")
    print(f"{'=' * 52}{RESET}\n")

    for r in results:
        title = r["title"]
        e_up, e_dn = r["e_up"], r["e_dn"]
        r_up, r_dn = r["r_up"], r["r_dn"]
        print(f"  {title:<22s} "
              f"emitted {e_dn:>3d} DN {e_up:>3d} UP  "
              f"{DIM}(raw {r_dn:>3d} DN {r_up:>3d} UP){RESET}  "
              f"{r['status']}")

    any_bad = any(
        "NEEDS TUNING" in r["status"] or "NO INPUT" in r["status"]
        for r in results
    )
    print()
    if any_bad:
        print(f"  {YELLOW}Some tests need improvement. Try adjusting:{RESET}")
        print(f"    --debounce-ms 50       "
              f"{DIM}(longer window to catch more bounces){RESET}")
        print(f"    --gesture-timeout-ms 300  "
              f"{DIM}(longer pause needed to change direction){RESET}")
    else:
        print(f"  {GREEN}Filter is working well!{RESET}")
        print(f"\n  To install as a system service:")
        print(f"    sudo install -m 755 {sys.argv[0]} "
              f"/usr/local/bin/k70-volume-debounce")
        print(f"    sudo cp k70-volume-debounce.service "
              f"/etc/systemd/system/")
        print(f"    sudo systemctl daemon-reload")
        print(f"    sudo systemctl enable --now k70-volume-debounce")
    print()


async def run_filter_mode(dev, ui, debounce_ms, gesture_timeout_ms, verbose):
    filt = VolumeFilter(ui, debounce_ms, gesture_timeout_ms, verbose)

    print(f"Filter active (debounce={debounce_ms}ms, "
          f"gesture_timeout={gesture_timeout_ms}ms)", flush=True)

    try:
        await process_events(dev, filt)
    except (OSError, IOError) as e:
        print(f"Device error: {e}", file=sys.stderr, flush=True)
    finally:
        filt.cancel_pending()


async def run(vendor, product, debounce_ms, gesture_timeout_ms,
              verbose, test_mode):
    dev = find_device(vendor, product)
    if not dev:
        print(f"Device {vendor:04x}:{product:04x} not found, waiting...",
              file=sys.stderr, flush=True)
        await asyncio.sleep(5)
        return not test_mode

    print(f"Found: {dev.name} ({dev.path})", flush=True)

    try:
        name = f"{dev.name} (debounced)"
        if len(name) > 80:
            name = name[:80]
        ui = UInput.from_device(dev, name=name)
    except Exception as e:
        print(f"Failed to create uinput device: {e}",
              file=sys.stderr, flush=True)
        dev.close()
        await asyncio.sleep(5)
        return not test_mode

    try:
        dev.grab()
    except IOError as e:
        print(f"Cannot grab device (is another program using it?): {e}",
              file=sys.stderr, flush=True)
        ui.close()
        dev.close()
        await asyncio.sleep(5)
        return not test_mode

    try:
        if test_mode:
            await run_test_mode(dev, ui, debounce_ms, gesture_timeout_ms,
                                verbose)
            return False
        else:
            await run_filter_mode(dev, ui, debounce_ms, gesture_timeout_ms,
                                  verbose)
            return True
    finally:
        try:
            dev.ungrab()
        except Exception:
            pass
        dev.close()
        ui.close()


async def main(args):
    should_retry = True
    while should_retry:
        try:
            should_retry = await run(
                args.vendor, args.product, args.debounce_ms,
                args.gesture_timeout_ms, args.verbose, args.test)
        except Exception as e:
            print(f"Unexpected error: {e}", file=sys.stderr, flush=True)
            if args.test:
                break
        if should_retry:
            await asyncio.sleep(2)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Debounce filter for rotary encoder volume wheels")
    parser.add_argument("--debounce-ms", type=int, default=30,
                        help="Debounce window in milliseconds (default: 30)")
    parser.add_argument("--gesture-timeout-ms", type=int, default=200,
                        help="Gap to reset direction lock in ms (default: 200)")
    parser.add_argument("--vendor", type=lambda x: int(x, 0), default=0x1b1c,
                        help="USB vendor ID (default: 0x1b1c / Corsair)")
    parser.add_argument("--product", type=lambda x: int(x, 0), default=0x1b73,
                        help="USB product ID (default: 0x1b73 / K70 TKL)")
    parser.add_argument("-v", "--verbose", action="store_true",
                        help="Log every raw event and filter decision")
    parser.add_argument("--test", action="store_true",
                        help="Run guided interactive test")
    args = parser.parse_args()

    try:
        asyncio.run(main(args))
    except KeyboardInterrupt:
        pass
