import { useEffect, useState } from "react"
import { Link } from "react-router-dom"

const KEY = "nordaloom.notice.v1"

/**
 * A quiet note, once. The shop only keeps what it needs to work (bag, wish
 * list, sign-in) and has no tracking, so there's nothing to accept or refuse.
 */
export function CookieNotice() {
  const [show, setShow] = useState(false)

  useEffect(() => {
    try {
      if (!localStorage.getItem(KEY)) {
        const t = setTimeout(() => setShow(true), 1200)
        return () => clearTimeout(t)
      }
    } catch {
      // No storage, nothing to remember either: don't show it.
    }
  }, [])

  if (!show) return null

  function close() {
    setShow(false)
    try {
      localStorage.setItem(KEY, new Date().toISOString())
    } catch {
      // Ignore.
    }
  }

  return (
    <div
      role="region"
      aria-label="About cookies"
      className="fixed inset-x-3 bottom-3 z-30 animate-in fade-in slide-in-from-bottom-2 duration-500 sm:inset-x-auto sm:left-5 sm:bottom-5 sm:max-w-sm"
    >
      <div className="border bg-background/95 p-5 text-sm shadow-[0_10px_40px_-12px_rgba(43,40,36,0.25)] backdrop-blur">
        <p className="leading-relaxed text-muted-foreground">
          <span className="text-foreground">No tracking here.</span> We don't use advertising or analytics cookies — your
          browser only keeps what the shop needs to work, like your bag and wish list.
        </p>
        <div className="mt-4 flex items-center gap-5">
          <button type="button" onClick={close} className="bg-foreground px-5 py-2 text-xs tracking-[0.12em] text-background uppercase hover:bg-foreground/90">
            Got it
          </button>
          <Link to="/privacy#browser" onClick={close} className="text-xs underline underline-offset-4 hover:text-foreground">
            What we keep
          </Link>
        </div>
      </div>
    </div>
  )
}
