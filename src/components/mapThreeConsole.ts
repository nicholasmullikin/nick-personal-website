import { setConsoleFunction } from "three"

const SILENCED_THREE_WARNINGS = ["Clock: This module has been deprecated"]

setConsoleFunction((type, message, ...rest) => {
  if (
    type === "warn" &&
    SILENCED_THREE_WARNINGS.some(needle => message.includes(needle))
  ) {
    return
  }
  const method = (
    console as unknown as Record<string, (...args: unknown[]) => void>
  )[type]
  method?.(message, ...rest)
})
