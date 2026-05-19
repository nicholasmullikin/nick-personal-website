import React, { useContext, useEffect, useRef } from "react"

import { DARK } from "~/src/constants/theme"
import useSiteMetadata from "~/src/hooks/useSiteMetadata"
import ThemeContext from "~/src/stores/themeContext"

const source = "https://utteranc.es"
const utterancesSelector = "iframe.utterances-frame"
const LIGHT_THEME = "github-light"
const DARK_THEME = "github-dark"

type ThemeMode = typeof LIGHT_THEME | typeof DARK_THEME

const Comment = () => {
  const site = useSiteMetadata()
  const { repo } = site.utterances ?? { repo: undefined }
  const theme = useContext(ThemeContext)
  const containerReference = useRef<HTMLDivElement>(null)
  const isUtterancesCreated = useRef(false)

  useEffect(() => {
    if (!repo) return

    let themeMode: ThemeMode

    if (isUtterancesCreated.current) {
      themeMode = theme === DARK ? DARK_THEME : LIGHT_THEME
    } else {
      themeMode =
        document.body.dataset.theme === DARK ? DARK_THEME : LIGHT_THEME
    }

    const createUtterancesElement = () => {
      const comment = document.createElement("script")
      const attributes = {
        src: `${source}/client.js`,
        repo,
        "issue-term": "title",
        label: "comment",
        theme: themeMode,
        crossOrigin: "anonymous",
        async: "true",
      }
      for (const [key, value] of Object.entries(attributes)) {
        comment.setAttribute(key, value)
      }
      containerReference.current?.append(comment)
      isUtterancesCreated.current = true
    }

    const postThemeMessage = (iframe: HTMLIFrameElement) => {
      const message = {
        type: "set-theme",
        theme: themeMode,
      }
      // Until the iframe has navigated to utteranc.es, its browsing context is
      // same-origin (e.g. localhost); postMessage with a strict target origin
      // fails. `*` is what Utterances documents for theme sync from the parent.
      iframe.contentWindow?.postMessage(message, "*")
    }

    const bindIframe = (iframe: HTMLIFrameElement) => {
      const onLoad = () => postThemeMessage(iframe)
      iframe.addEventListener("load", onLoad)
      queueMicrotask(onLoad)
      return () => iframe.removeEventListener("load", onLoad)
    }

    if (!isUtterancesCreated.current) {
      createUtterancesElement()
    }

    const iframe = containerReference.current?.querySelector(
      utterancesSelector,
    ) as HTMLIFrameElement | null

    if (!iframe) {
      const root = containerReference.current
      if (!root) return
      let unbindIframe: (() => void) | undefined
      const observer = new MutationObserver(() => {
        const el = root.querySelector(
          utterancesSelector,
        ) as HTMLIFrameElement | null
        if (!el) return
        observer.disconnect()
        unbindIframe = bindIframe(el)
      })
      observer.observe(root, { childList: true, subtree: true })
      return () => {
        observer.disconnect()
        unbindIframe?.()
      }
    }

    return bindIframe(iframe)
  }, [repo, theme])

  return <div ref={containerReference} />
}

Comment.displayName = "comment"

export default Comment
