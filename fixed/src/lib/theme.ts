// Light, dark, or following the phone ("system"). Applied to <html> as the
// "dark" class; index.html applies it before the first paint too.
import { useEffect, useSyncExternalStore } from "react"

export type ThemeChoice = "system" | "light" | "dark"

const KEY = "nordaloom.theme"
const listeners = new Set<() => void>()
const media = typeof window !== "undefined" ? window.matchMedia("(prefers-color-scheme: dark)") : null

export function getChoice(): ThemeChoice {
  try {
    const v = localStorage.getItem(KEY)
    return v === "light" || v === "dark" ? v : "system"
  } catch {
    return "system"
  }
}

function apply() {
  const choice = getChoice()
  const dark = choice === "dark" || (choice === "system" && !!media?.matches)
  document.documentElement.classList.toggle("dark", dark)
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", dark ? "#1b1916" : "#f7f3ec")
  listeners.forEach((l) => l())
}

export function setChoice(choice: ThemeChoice) {
  try {
    if (choice === "system") localStorage.removeItem(KEY)
    else localStorage.setItem(KEY, choice)
  } catch {
    // Private mode: the choice lasts for this visit.
  }
  apply()
}

// The phone switched to dark in the evening: follow it (when on "system").
media?.addEventListener("change", apply)
// Another tab changed the choice.
if (typeof window !== "undefined") window.addEventListener("storage", (e) => e.key === KEY && apply())

const subscribe = (cb: () => void) => {
  listeners.add(cb)
  return () => void listeners.delete(cb)
}

export function useTheme() {
  const choice = useSyncExternalStore(subscribe, getChoice, () => "system" as ThemeChoice)
  const dark = useSyncExternalStore(subscribe, () => document.documentElement.classList.contains("dark"), () => false)
  useEffect(() => apply(), [])
  return { choice, dark, setChoice }
}
