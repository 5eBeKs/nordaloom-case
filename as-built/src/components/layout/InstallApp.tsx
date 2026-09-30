import { useState } from "react"
import { Share, SquarePlus } from "lucide-react"
import { toast } from "sonner"
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet"
import { useInstall } from "@/lib/pwa"

/**
 * "Get the app": one tap where the browser can install it (Android, Chrome),
 * the two steps on an iPhone. Shows nothing when already installed.
 */
export function InstallApp({ className, onDone }: { className?: string; onDone?: () => void }) {
  const { how, install } = useInstall()
  const [iosOpen, setIosOpen] = useState(false)
  if (!how) return null

  return (
    <>
      <button
        type="button"
        className={className}
        onClick={async () => {
          if (how === "ios") {
            setIosOpen(true)
            return
          }
          if (await install()) toast.success("Nordaloom is on your home screen.")
          onDone?.()
        }}
      >
        Get the app
      </button>
      <Sheet open={iosOpen} onOpenChange={setIosOpen}>
        <SheetContent side="bottom" className="bg-background px-6 pt-8 pb-10">
          <SheetTitle className="text-2xl font-light">Put Nordaloom on your home screen</SheetTitle>
          <SheetDescription className="mt-2 text-sm text-muted-foreground">
            It opens full screen like an app, starts quickly, and shows what you've looked at even without a connection.
          </SheetDescription>
          <ol className="mt-6 space-y-4 text-sm">
            <li className="flex items-center gap-3">
              <span className="font-serif text-clay">1</span> Tap <Share className="size-4" strokeWidth={1.75} aria-label="Share" /> Share at the bottom of Safari.
            </li>
            <li className="flex items-center gap-3">
              <span className="font-serif text-clay">2</span> Choose <SquarePlus className="size-4" strokeWidth={1.75} aria-hidden /> <span className="font-medium">Add to Home Screen</span>.
            </li>
          </ol>
        </SheetContent>
      </Sheet>
    </>
  )
}
