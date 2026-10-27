export const examples = {
  missing: {
    title: "Missing callback argument",
    source: "Simplified GTK source + captured output",
    description:
      "The signal supplies no timestamp, but the callback expects one. Non-timestamp data is interpreted as time; its original register value was not captured.",
    code: '// No timestamp is supplied:\ng_signal_emit_by_name(drag,\n                      "drop-performed");\n\n// The callback nevertheless expects one:\nvoid drop_performed(GdkDrag *drag,\n                    guint32 timestamp);\n\n// Captured outgoing timestamp:\nT = 1413247760;',
  },
  future: {
    title: "Future timestamp",
    source: "Captured · October 21, 2026",
    description:
      "The drop carried a time about 15 days ahead of the X server. Firefox reused this same value on October 26, when it was still about 12.6 days ahead.",
    code: "drop_timestamp_ms = 1413247760\nserver_time_ms    =  116326755\n\nahead_ms          = 1296921005\nahead_days        ≈ 15.01",
  },
  real: {
    title: "Real X server timestamp",
    source: "Captured clock samples · milliseconds",
    description:
      "X timestamps are 32-bit display-server clock values, not Unix dates. They wrap about every 49.7 days. A focus time must also satisfy Xorg’s last-focus-change constraint.",
    code: "// October 21, at the drop:\nserver_time_ms = 116326755\n\n// October 26, near activation:\nserver_time_ms ≈ 321267315",
  },
  key: {
    title: "A keyboard event",
    source: "Illustrative event · ordinary keys were redacted",
    description:
      "On a typical US X11 keymap, keycode 38 maps to A. With no modifiers it can produce “a”. Xorg sends the event to its actual focus window, even when Firefox looks active.",
    code: 'KeyPress {\n  window:  Slack_input_window,\n  time:    321279478,\n  keycode: 38,\n  state:   0\n}\n\n// Typical US keymap interpretation:\nkeysym = XK_a\ntext   = "a"',
  },
  takefocus: {
    title: "WM_TAKE_FOCUS",
    source: "Captured window + timestamp · decoded message layout",
    description:
      "Mutter invites Firefox to take focus using this timestamp. Firefox responds with SetInputFocus. The protocol names below are symbolic names for numeric X11 atoms.",
    code: "ClientMessage {\n  window:       0x3400017,\n  message_type: WM_PROTOCOLS,\n  format:       32,\n  data[0]:      WM_TAKE_FOCUS,\n  data[1]:      1413247760\n}\n\n// Captured Mutter log:\nWM_TAKE_FOCUS(0x3400017, 1413247760)",
  },
} as const
