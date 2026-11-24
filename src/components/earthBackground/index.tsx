import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react"
import styled from "styled-components"

type Connection = EventTarget & { saveData?: boolean; effectiveType?: string }
type DeviceNavigator = Navigator & {
  deviceMemory?: number
  connection?: Connection
}
const preferenceKey = "earth-background-motion"
const MotionContext = createContext({
  allowed: false,
  enabled: true,
  toggle: () => {},
})

// Gatsby keeps this wrapper mounted across page navigation. The iframe, WebGL
// context, orbit and weather clock survive article changes and pause/resume.
export function EarthBackgroundRoot({
  children,
  pathname,
}: React.PropsWithChildren<{ pathname: string }>) {
  const fullWindow = /^\/blog\/earth\/?$/.test(pathname)
  const active = pathname.startsWith("/blog/") && !fullWindow
  const frame = useRef<HTMLIFrameElement>(null)
  const failed = useRef(false)
  const launchButton = useRef<HTMLButtonElement>(null)
  const closeButton = useRef<HTMLButtonElement>(null)
  const [exploring, setExploring] = useState(false)
  const [allowed, setAllowed] = useState<boolean | null>(null)
  const [enabled, setEnabled] = useState(true)
  const [mounted, setMounted] = useState(false)
  const [mediaVisible, setMediaVisible] = useState(false)
  const [ready, setReady] = useState(false)
  const canRender = allowed === true || exploring
  const closeExplore = useCallback(() => {
    setExploring(false)
    requestAnimationFrame(() =>
      launchButton.current?.focus({ preventScroll: true }),
    )
  }, [])
  const command = (value: string) =>
    frame.current?.contentWindow?.postMessage(
      { type: "earth-background-command", command: value },
      location.origin,
    )
  useEffect(() => {
    setExploring(false)
  }, [pathname])
  useEffect(() => {
    if (!exploring) return
    const overflow = document.body.style.overflow
    document.body.style.overflow = "hidden"
    closeButton.current?.focus({ preventScroll: true })
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault()
        closeExplore()
      }
      if (event.key === "Tab") {
        const buttons = [
          ...document.querySelectorAll<HTMLButtonElement>(
            "[data-earth-toolbar] button",
          ),
        ]
        const index = buttons.indexOf(
          document.activeElement as HTMLButtonElement,
        )
        if (
          index === -1 ||
          (event.shiftKey && index === 0) ||
          (!event.shiftKey && index === buttons.length - 1)
        ) {
          event.preventDefault()
          if (ready) frame.current?.focus()
          else closeButton.current?.focus()
        }
      }
    }
    addEventListener("keydown", keydown)
    return () => {
      document.body.style.overflow = overflow
      removeEventListener("keydown", keydown)
    }
  }, [exploring, closeExplore, ready])
  useEffect(() => {
    const device = navigator as DeviceNavigator
    const media = matchMedia(
      "(prefers-reduced-motion: reduce), (max-width: 767px), (pointer: coarse)",
    )
    const update = () =>
      setAllowed(
        !media.matches &&
          !device.connection?.saveData &&
          !/^(slow-2g|2g|3g)$/.test(device.connection?.effectiveType ?? "") &&
          (device.hardwareConcurrency || 8) > 4 &&
          (device.deviceMemory || 8) > 4,
      )
    try {
      setEnabled(localStorage.getItem(preferenceKey) !== "off")
    } catch {
      /* optional */
    }
    update()
    media.addEventListener("change", update)
    device.connection?.addEventListener("change", update)
    return () => {
      media.removeEventListener("change", update)
      device.connection?.removeEventListener("change", update)
    }
  }, [])
  useEffect(() => {
    if (!active || !canRender) {
      failed.current = false
      setMounted(false)
      setReady(false)
      return
    }
    if (((!enabled || mediaVisible) && !exploring) || mounted || failed.current) return
    if (exploring) {
      setMounted(true)
      return
    }
    let timer = 0,
      idle = 0
    const start = () => {
      if (!document.hidden) setMounted(true)
    }
    const defer = () => {
      if (document.hidden) return
      clearTimeout(timer)
      timer = window.setTimeout(() => {
        if ("requestIdleCallback" in window)
          idle = requestIdleCallback(start, { timeout: 3000 })
        else start()
      }, 1200)
    }
    defer()
    document.addEventListener("visibilitychange", defer)
    return () => {
      clearTimeout(timer)
      if (idle) cancelIdleCallback(idle)
      document.removeEventListener("visibilitychange", defer)
    }
  }, [active, canRender, enabled, mounted, exploring, mediaVisible])
  useEffect(() => {
    if (!active || !canRender) return
    let timer = 0,
      scrolling = false
    const visible = new Set<Element>()
    const observed = new Set<Element>()
    const send = () =>
      frame.current?.contentWindow?.postMessage(
        {
          type: "earth-background-active",
          interactive: exploring,
          active:
            !document.hidden &&
            (exploring ||
              (enabled &&
                !document.fullscreenElement &&
                !scrolling &&
                visible.size === 0)),
        },
        location.origin,
      )
    const message = (event: MessageEvent) => {
      if (
        event.source !== frame.current?.contentWindow ||
        event.origin !== location.origin
      )
        return
      if (event.data?.type === "earth-background-loaded") send()
      if (event.data?.type === "earth-background-ready") setReady(true)
      if (event.data?.type === "earth-background-exit") closeExplore()
      if (event.data?.type === "earth-background-focus-controls")
        closeButton.current?.focus({ preventScroll: true })
      if (event.data?.type === "earth-background-failed") {
        failed.current = true
        setReady(false)
        setMounted(false)
      }
    }
    const scroll = () => {
      scrolling = true
      clearTimeout(timer)
      send()
      timer = window.setTimeout(() => {
        scrolling = false
        send()
      }, 250)
    }
    const observer = new IntersectionObserver(
      entries => {
        for (const entry of entries) {
          if (entry.isIntersecting) visible.add(entry.target)
          else visible.delete(entry.target)
        }
        setMediaVisible(visible.size > 0)
        send()
      },
      { rootMargin: "120px" },
    )
    const observeMedia = () => {
      for (const element of observed)
        if (!element.isConnected) {
          observer.unobserve(element)
          observed.delete(element)
          visible.delete(element)
        }
      for (const element of document.querySelectorAll(
        "main canvas, main iframe, main video",
      )) {
        if (!observed.has(element)) {
          observed.add(element)
          observer.observe(element)
        }
      }
      setMediaVisible(visible.size > 0)
      send()
    }
    const mutations = new MutationObserver(observeMedia)
    const main = document.querySelector("main")
    if (main) mutations.observe(main, { childList: true, subtree: true })
    observeMedia()
    addEventListener("message", message)
    addEventListener("scroll", scroll, { passive: true })
    document.addEventListener("visibilitychange", send)
    document.addEventListener("fullscreenchange", send)
    return () => {
      clearTimeout(timer)
      observer.disconnect()
      mutations.disconnect()
      removeEventListener("message", message)
      removeEventListener("scroll", scroll)
      document.removeEventListener("visibilitychange", send)
      document.removeEventListener("fullscreenchange", send)
    }
  }, [active, canRender, mounted, enabled, pathname, exploring, closeExplore])
  const toggle = () => {
    setEnabled(!enabled)
    try {
      localStorage.setItem(preferenceKey, enabled ? "off" : "on")
    } catch {
      /* optional */
    }
  }
  return (
    <MotionContext.Provider
      value={{ allowed: allowed === true, enabled, toggle }}
    >
      <Root $fullWindow={fullWindow}>
        {active && (
          <Backdrop
            aria-hidden={exploring ? undefined : true}
            role={exploring ? "dialog" : undefined}
            aria-modal={exploring ? true : undefined}
            aria-label={exploring ? "Explore Earth" : undefined}
            data-earth-interactive={exploring}
            data-earth-background
            data-earth-state={ready ? "ready" : "static"}
            data-earth-poster={
              allowed === false || (!enabled && !ready) || failed.current
            }
          >
            <noscript>
              <style>
                {"[data-earth-background] img { opacity: 1 !important; }"}
              </style>
            </noscript>
            <picture>
              <source
                media="(max-width: 767px)"
                srcSet="/earth-background/poster-mobile.webp"
              />
              <img
                src="/earth-background/poster.webp"
                alt=""
                width="1440"
                height="900"
                decoding="async"
                fetchPriority="low"
              />
            </picture>
            {canRender && mounted && (
              <iframe
                ref={frame}
                src="/harp/earth-background.html"
                title={
                  exploring
                    ? "Interactive Earth globe"
                    : "Decorative Earth background"
                }
                inert={!exploring || undefined}
              />
            )}
            {exploring && (
              <>
                <ExploreHint>
                  {failed.current
                    ? "3D Earth is unavailable in this browser."
                    : ready
                      ? "Drag to rotate · Scroll or pinch to zoom · Esc to return"
                      : "Loading Earth…"}
                </ExploreHint>
                <ExploreToolbar data-earth-toolbar>
                  <button
                    ref={closeButton}
                    type="button"
                    onClick={closeExplore}
                  >
                    Back to article
                  </button>
                  <button
                    type="button"
                    disabled={!ready}
                    onClick={() => command("zoom-out")}
                    aria-label="Zoom out"
                  >
                    −
                  </button>
                  <button
                    type="button"
                    disabled={!ready}
                    onClick={() => command("zoom-in")}
                    aria-label="Zoom in"
                  >
                    +
                  </button>
                  <button
                    type="button"
                    disabled={!ready}
                    onClick={() => command("reset")}
                  >
                    Reset view
                  </button>
                </ExploreToolbar>
              </>
            )}
          </Backdrop>
        )}
        <div inert={exploring || undefined}>{children}</div>
        {active && allowed !== null && !exploring && (
          <ExploreLauncher
            ref={launchButton}
            type="button"
            onClick={() => setExploring(true)}
            aria-haspopup="dialog"
          >
            Explore Earth
          </ExploreLauncher>
        )}
      </Root>
    </MotionContext.Provider>
  )
}

export default function EarthBackground() {
  const { allowed, enabled, toggle } = useContext(MotionContext)
  return (
    <Controls>
      <a href="/earth-background/credits.html">Earth imagery</a>
      {allowed && (
        <button type="button" onClick={toggle}>
          {enabled ? "Pause Earth background" : "Animate Earth background"}
        </button>
      )}
    </Controls>
  )
}

const Root = styled.div<{ $fullWindow: boolean }>`
  position: relative;
  isolation: isolate;
  min-height: ${({ $fullWindow }) => ($fullWindow ? "0" : "100vh")};
`
const Backdrop = styled.div`
  position: fixed;
  inset: 0;
  z-index: -1;
  overflow: hidden;
  pointer-events: none;
  user-select: none;
  background: #000;
  contain: strict;
  iframe {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
  }
  img {
    position: absolute;
    top: 0;
    left: 50%;
    transform: translateX(-50%);
    height: 100%;
    width: auto;
    max-width: none;
    opacity: 0;
  }
  &[data-earth-poster="true"] img {
    opacity: 1;
  }
  @media (max-width: 767px),
    (pointer: coarse),
    (prefers-reduced-motion: reduce) {
    img {
      opacity: 1;
    }
  }
  iframe {
    border: 0;
    opacity: 0;
    transition: opacity 1.2s;
  }
  &[data-earth-state="ready"] iframe {
    opacity: 1;
  }
  &::after {
    content: "";
    position: absolute;
    inset: 0;
    background: linear-gradient(
      90deg,
      rgba(255, 255, 255, 0.18),
      rgba(255, 255, 255, 0.78) max(16px, calc(50% - 370px)),
      rgba(255, 255, 255, 0.78) min(calc(100% - 16px), calc(50% + 370px)),
      rgba(255, 255, 255, 0.18)
    );
  }
  body.dark &::after {
    background: linear-gradient(
      90deg,
      rgba(18, 24, 32, 0.08),
      rgba(28, 28, 28, 0.7) max(16px, calc(50% - 370px)),
      rgba(28, 28, 28, 0.7) min(calc(100% - 16px), calc(50% + 370px)),
      rgba(18, 24, 32, 0.08)
    );
  }
  @media (max-width: 767px) {
    &::after {
      background: rgba(255, 255, 255, 0.78);
    }
    body.dark &::after {
      background: rgba(28, 28, 28, 0.7);
    }
  }
  &[data-earth-interactive="true"] {
    z-index: 1000;
    pointer-events: auto;
    &::after {
      display: none;
    }
    img {
      opacity: 0 !important;
    }
    iframe {
      touch-action: none;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    iframe {
      transition: none;
    }
  }
`
const Controls = styled.span`
  display: inline-flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 16px;
  font-size: var(--text-sm);
  a,
  button {
    color: var(--color-gray-6);
    text-decoration: underline;
    text-underline-offset: 3px;
  }
  button {
    background: none;
    border: 0;
    padding: 0;
    font: inherit;
    cursor: pointer;
  }
`

const ExploreLauncher = styled.button`
  position: fixed;
  bottom: 24px;
  left: 24px;
  z-index: 20;
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 24px;
  background: #172333;
  color: #f3f6fa;
  padding: 12px 18px;
  font: inherit;
  font-size: 14px;
  cursor: pointer;
  box-shadow: 0 3px 16px #0003;
  &:hover {
    background: #263a50;
  }
  @media (max-width: 767px) {
    left: 16px;
    bottom: 16px;
  }
`
const ExploreHint = styled.p`
  position: absolute;
  top: 20px;
  left: 16px;
  right: 16px;
  text-align: center;
  color: #f3f6fa;
  font-size: 14px;
  line-height: 1.5;
  text-shadow: 0 1px 6px #000;
  pointer-events: none;
`
const ExploreToolbar = styled.div`
  position: absolute;
  bottom: 24px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px;
  border: 1px solid #ffffff30;
  border-radius: 28px;
  background: #172333f2;
  white-space: nowrap;
  box-shadow: 0 4px 24px #0005;
  button {
    background: transparent;
    border: 0;
    border-radius: 22px;
    color: #f3f6fa;
    padding: 10px 14px;
    min-height: 44px;
    min-width: 44px;
    font: inherit;
    font-size: 14px;
    cursor: pointer;
    &:hover {
      background: #ffffff20;
    }
    &:disabled {
      opacity: 0.4;
      cursor: default;
    }
  }
  @media (max-width: 767px) {
    bottom: 16px;
    gap: 0;
    button {
      padding: 10px;
    }
  }
`
