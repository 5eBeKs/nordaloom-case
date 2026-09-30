import { useEffect, useRef } from "react"
import { WifiOff } from "lucide-react"
import { toast } from "sonner"
import { useOnline } from "@/lib/pwa"

/** A clear, calm bar while there's no connection — and a word when it's back. */
export function OfflineNotice() {
  const online = useOnline()
  const wasOffline = useRef(false)

  useEffect(() => {
    if (!online) {
      wasOffline.current = true
      document.body.style.paddingBottom = "4.5rem"
    } else {
      document.body.style.paddingBottom = ""
      if (wasOffline.current) {
        wasOffline.current = false
        toast.success("You're back online — prices and stock are up to date again.")
      }
    }
  }, [online])

  if (online) return null
  return (
    <div role="status" className="fixed inset-x-0 bottom-0 z-50 border-t border-foreground/15 bg-foreground px-5 py-3 text-background" style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}>
      <div className="mx-auto flex max-w-5xl items-start gap-3 text-sm">
        <WifiOff className="mt-0.5 size-4 shrink-0" strokeWidth={1.75} />
        <p className="leading-snug">
          <span className="font-medium">You're offline.</span>{" "}
          <span className="text-background/80">
            You're seeing what's saved on this device — prices and stock may have changed. Your bag and wish list are kept and
            will catch up when you're back online.
          </span>
        </p>
      </div>
    </div>
  )
}
