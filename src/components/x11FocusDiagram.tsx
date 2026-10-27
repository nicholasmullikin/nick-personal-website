import { useEffect, useRef, useState } from "react"
import styled from "styled-components"

import { examples } from "./x11FocusExamples"
import { DesktopLayers, MobileLayers } from "./x11FocusLayers"

type ExampleKey = keyof typeof examples
const controls: [ExampleKey, string][] = [
  ["missing", "Missing argument"],
  ["future", "Future timestamp"],
  ["real", "Real timestamp"],
  ["key", "Key event"],
  ["takefocus", "WM_TAKE_FOCUS"],
]

export default function X11FocusDiagram() {
  const root = useRef<HTMLElement>(null)
  const popup = useRef<HTMLDivElement>(null)
  const active = useRef<Element | null>(null)
  const pinned = useRef(false)
  const dismissHover = useRef(false)
  const [anchor, setAnchor] = useState<Element | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const [example, setExample] = useState<ExampleKey | null>(null)
  const [position, setPosition] = useState({ left: 0, top: 0 })

  function close() {
    clearTimeout(timer.current)
    active.current?.removeAttribute("aria-describedby")
    active.current = null
    setAnchor(null)
    dismissHover.current = true
    pinned.current = false
    setExample(null)
  }
  function open(target: HTMLElement | SVGElement, pin = false) {
    clearTimeout(timer.current)
    const key = target.dataset.example || target.dataset.exampleTarget
    if (!key || !(key in examples)) return
    active.current?.removeAttribute("aria-describedby")
    active.current = target
    setAnchor(target)
    pinned.current = pin
    target.setAttribute("aria-describedby", "x11-example-detail")
    setExample(key as ExampleKey)
  }
  function trigger(target: EventTarget | null) {
    return target instanceof Element
      ? target.closest<HTMLElement | SVGElement>(
          "[data-example], [data-example-target]",
        )
      : null
  }
  function leave() {
    clearTimeout(timer.current)
    if (!pinned.current) timer.current = setTimeout(close, 220)
  }

  useEffect(() => {
    if (!example) return
    function positionPopup() {
      if (!root.current || !popup.current || !active.current) return
      const r = root.current.getBoundingClientRect()
      const a = active.current.getBoundingClientRect()
      const p = popup.current.getBoundingClientRect()
      const left = Math.max(
        0,
        Math.min(
          r.width - p.width,
          a.left - r.left + a.width / 2 - p.width / 2,
        ),
      )
      let top = a.top - p.height - 10
      if (top < 8) top = a.bottom + 10
      top = Math.max(8, Math.min(window.innerHeight - p.height - 8, top))
      setPosition({ left, top: top - r.top })
    }
    function outside(event: PointerEvent) {
      if (!root.current?.contains(event.target as Node)) close()
      else if (
        !popup.current?.contains(event.target as Node) &&
        !trigger(event.target)
      )
        close()
    }
    function escape(event: KeyboardEvent) {
      if (event.key === "Escape") close()
    }
    positionPopup()
    window.addEventListener("resize", positionPopup)
    window.addEventListener("scroll", positionPopup, true)
    document.addEventListener("pointerdown", outside)
    document.addEventListener("keydown", escape)
    return () => {
      window.removeEventListener("resize", positionPopup)
      window.removeEventListener("scroll", positionPopup, true)
      document.removeEventListener("pointerdown", outside)
      document.removeEventListener("keydown", escape)
    }
  }, [example, anchor])

  useEffect(
    () => () => {
      clearTimeout(timer.current)
    },
    [],
  )
  const info = example ? examples[example] : null
  return (
    <Figure
      id="x11-layered-architecture"
      ref={root}
      onPointerMove={event => {
        if (
          event.pointerType !== "touch" &&
          (event.movementX || event.movementY)
        ) {
          dismissHover.current = false
          const target = trigger(event.target)
          if (target && !pinned.current && active.current !== target)
            open(target)
        }
      }}
      onPointerOver={event => {
        const target = trigger(event.target)
        if (popup.current?.contains(event.target as Node)) {
          clearTimeout(timer.current)
          return
        }
        if (!target) return
        clearTimeout(timer.current)
        if (
          event.pointerType === "touch" ||
          pinned.current ||
          dismissHover.current
        )
          return
        open(target)
      }}
      onPointerOut={event => {
        if (popup.current?.contains(event.relatedTarget as Node)) return
        if (!trigger(event.relatedTarget)) leave()
      }}
      onFocus={event => {
        const target = trigger(event.target)
        if (target) open(target)
      }}
      onBlur={leave}
      onClick={event => {
        const target = trigger(event.target)
        if (target) {
          if (active.current === target && pinned.current) close()
          else open(target, true)
        }
      }}
    >
      <h2>X11 desktop architecture and the focus bug</h2>
      <div className="legend">
        <span className="protocol">X11 requests / events</span>
        <span className="failure">Bug path · 1–5</span>
        <span className="healthy">Normal keyboard route</span>
      </div>
      <DesktopLayers />
      <MobileLayers />
      <p className="hint">
        Hover an underlined annotation, or focus / tap an example below. Escape
        dismisses it.
      </p>
      <div className="examples" aria-label="Protocol and timestamp examples">
        {controls.map(([key, label]) => (
          <button key={key} type="button" data-example={key}>
            {label}
          </button>
        ))}
      </div>
      {info && (
        <div
          ref={popup}
          role="tooltip"
          id="x11-example-detail"
          className="example-popup"
          style={position}
        >
          <strong>{info.title}</strong>
          <small>{info.source}</small>
          <p>{info.description}</p>
          <pre>
            <code>{info.code}</code>
          </pre>
        </div>
      )}
      <figcaption>
        <p>
          GTK and Electron run inside application processes; their
          responsibilities are shown separately here. App–Mutter messages travel
          through Xorg. Rendering, GPU plumbing, Wayland and the alternate
          Firefox launcher path are omitted.
        </p>
        <p>
          Layout adapted from{" "}
          <a href="https://static.linaro.org/connect/bkk16/Presentations/Wednesday/BKK16-315.pdf#page=3">
            Linaro’s Graphics Stack Update, slide 3
          </a>{" "}
          · Jammy Zhou · 2016.
        </p>
      </figcaption>
    </Figure>
  )
}

const Figure = styled.figure`
  --focus-protocol: var(--color-blue);
  --focus-failure: #b42318;
  --focus-healthy: #187044;
  body.dark & {
    --focus-failure: #ff938a;
    --focus-healthy: #78dba6;
  }
  position: relative;
  width: min(980px, calc(100vw - 32px));
  left: 50%;
  transform: translateX(-50%);
  margin: 2.5rem 0;
  h2 {
    font-size: 1.3rem;
    font-weight: 600;
    margin-bottom: 1rem;
  }
  .legend,
  .examples {
    display: flex;
    flex-wrap: wrap;
    gap: 12px 20px;
  }
  .legend {
    font-size: 0.8rem;
  }
  .legend span::before {
    content: "";
    display: inline-block;
    width: 20px;
    margin-right: 8px;
    vertical-align: middle;
    border-top: 2px solid var(--focus-protocol);
  }
  .legend .failure::before {
    border-color: var(--focus-failure);
  }
  .legend .healthy::before {
    border-color: var(--focus-healthy);
    border-top-style: dashed;
  }
  svg {
    display: block;
    width: 100%;
    height: auto;
  }
  svg text {
    font-family: inherit;
    font-size: 12px;
    fill: var(--color-text);
  }
  svg .strong {
    font-weight: 600;
  }
  svg .muted {
    fill: var(--color-text-2);
  }
  svg .fault {
    fill: var(--focus-failure);
  }
  svg text[data-example-target] {
    cursor: help;
    text-decoration: underline dotted;
    text-underline-offset: 3px;
    pointer-events: bounding-box;
  }
  .mobile-layers {
    display: none;
  }
  .hint,
  figcaption {
    font-size: 0.85rem;
    line-height: 1.6;
    color: var(--color-text-2);
  }
  .hint {
    margin: 12px 0;
  }
  figcaption p {
    margin-top: 12px;
  }
  a {
    text-decoration: underline;
  }
  button {
    background: var(--color-card);
    border: 1px solid var(--color-divider);
    border-radius: 6px;
    padding: 9px 12px;
    font: inherit;
    font-size: 0.85rem;
    cursor: pointer;
  }
  button:hover {
    border-color: var(--color-blue);
  }
  .example-popup {
    position: absolute;
    z-index: 10;
    box-sizing: border-box;
    width: min(470px, 100%);
    max-height: calc(100dvh - 16px);
    overflow-y: auto;
    padding: 18px;
    background: var(--color-background);
    border: 1px solid var(--color-divider);
    border-radius: 8px;
    box-shadow: 0 8px 32px #0003;
    font-size: 0.9rem;
    line-height: 1.5;
  }
  .example-popup strong {
    display: block;
    font-weight: 600;
  }
  .example-popup small {
    display: block;
    font-size: 0.75rem;
    color: var(--color-text-2);
    margin-top: 4px;
  }
  .example-popup p {
    margin: 12px 0;
  }
  pre {
    background: var(--color-code-block);
    padding: 12px;
    border-radius: 4px;
  }
  code {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    font: 0.8rem/1.6 monospace;
  }
  @media (max-width: 999px) {
    .desktop-layers {
      display: none;
    }
    .mobile-layers {
      display: block;
      max-width: 500px;
      margin: auto;
    }
    .mobile-layers text {
      font-size: 13px;
    }
  }
`
