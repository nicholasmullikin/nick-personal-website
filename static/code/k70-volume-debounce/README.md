# Corsair K70 TKL volume wheel debounce

Companion code for the post [_A grab bag of Fedora 43 desktop fixes_](https://nicholasmullikin.com/blog/fedora-43-fixes/) (section 2).

The K70 RGB TKL's volume wheel rotary encoder has a hardware defect: scrolling
up slowly sends ~35% wrong-direction events. This is a Python `evdev` filter
that grabs the keyboard, forwards every non-volume event with zero added
latency, and applies a debounce window plus a direction momentum lock to
volume events.

## Files

- `k70-volume-debounce.py` — the filter script
- `k70-volume-debounce.service` — systemd unit

## Install

```bash
sudo dnf install python3-evdev
sudo install -m 755 k70-volume-debounce.py /usr/local/bin/k70-volume-debounce
sudo cp k70-volume-debounce.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now k70-volume-debounce
```

## Usage

```bash
# Guided test that evaluates filter quality
sudo k70-volume-debounce --test --debounce-ms 50

# Run interactively with verbose logging
sudo k70-volume-debounce --debounce-ms 50 -v

# Once installed as a service
sudo systemctl status k70-volume-debounce
```

## Tuning

| Flag                   | Default | Effect                                                                                              |
| ---------------------- | ------- | --------------------------------------------------------------------------------------------------- |
| `--debounce-ms`        | 30      | Accumulation window. Higher = more bounce filtered, but adds latency. 50 works well for this board. |
| `--gesture-timeout-ms` | 200     | Pause that resets the direction lock. Lower = faster direction changes, more sensitive to bounces.  |
| `--vendor`             | 0x1b1c  | USB vendor ID (Corsair).                                                                            |
| `--product`            | 0x1b73  | USB product ID (K70 TKL).                                                                           |

## Test results (`--debounce-ms 50`)

| Test      | Raw encoder  | After filter |
| --------- | ------------ | ------------ |
| Slow DOWN | 100% correct | 100%         |
| Slow UP   | 65% correct  | **100%**     |
| Fast DOWN | 100% correct | 100%         |
| Fast UP   | 92% correct  | **95%**      |
