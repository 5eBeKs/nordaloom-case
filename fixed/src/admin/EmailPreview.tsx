import { useMemo, useState } from "react"
import { Monitor, Smartphone } from "lucide-react"
import { imageUrl } from "@/lib/images"
import { renderEmail } from "@emails/templates.ts"
import { cn } from "@/lib/utils"

/** Shows an email as the customer would see it, plus its plain-text version. */
export function EmailPreview({ kind, data, to, meta }: { kind: string; data: unknown; to?: string; meta?: React.ReactNode }) {
  const email = useMemo(() => renderEmail(kind, data, { imageUrl }), [kind, data])
  const [view, setView] = useState<"desktop" | "phone" | "text">("desktop")

  return (
    <div className="flex h-full flex-col">
      <div className="space-y-1 border-b px-6 py-4 text-sm">
        {to && (
          <p>
            <span className="inline-block w-16 text-muted-foreground">To</span> {to}
          </p>
        )}
        <p>
          <span className="inline-block w-16 text-muted-foreground">Subject</span> <span className="font-medium">{email.subject}</span>
        </p>
        <p className="text-muted-foreground">
          <span className="inline-block w-16">Preview</span> {email.preheader}
        </p>
        {meta}
      </div>
      <div className="flex items-center gap-1 border-b px-6 py-2">
        {(
          [
            ["desktop", "Computer", Monitor],
            ["phone", "Phone", Smartphone],
            ["text", "Plain text", null],
          ] as const
        ).map(([key, label, Icon]) => (
          <button
            key={key}
            type="button"
            onClick={() => setView(key)}
            className={cn("flex items-center gap-1.5 px-3 py-1.5 text-xs", view === key ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground")}
          >
            {Icon && <Icon className="size-3.5" />} {label}
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-auto bg-muted/50 p-4">
        {view === "text" ? (
          <pre className="mx-auto max-w-[600px] bg-card p-6 font-mono text-xs leading-relaxed whitespace-pre-wrap">{email.text}</pre>
        ) : (
          <iframe
            title={email.subject}
            srcDoc={email.html}
            sandbox="allow-popups"
            className={cn("mx-auto block h-[1400px] border bg-white transition-[width]", view === "phone" ? "w-[380px]" : "w-full max-w-[700px]")}
          />
        )}
      </div>
    </div>
  )
}
