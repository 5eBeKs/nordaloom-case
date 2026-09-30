import { Monitor, Moon, Sun } from "lucide-react"
import { useTheme, type ThemeChoice } from "@/lib/theme"
import { cn } from "@/lib/utils"

const OPTIONS: { value: ThemeChoice; label: string; icon: typeof Sun }[] = [
  { value: "system", label: "Auto", icon: Monitor },
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
]

/** Light, dark, or the same as the phone. */
export function ThemeSwitch({ className }: { className?: string }) {
  const { choice, setChoice } = useTheme()
  return (
    <div role="radiogroup" aria-label="Colours" className={cn("inline-flex border border-input", className)}>
      {OPTIONS.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={choice === o.value}
          onClick={() => setChoice(o.value)}
          title={o.value === "system" ? "Follow this device's setting" : `${o.label} colours`}
          className={cn(
            "flex min-h-11 items-center gap-1.5 px-3.5 text-xs transition-colors",
            choice === o.value ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground",
          )}
        >
          <o.icon className="size-3.5" strokeWidth={1.75} aria-hidden />
          {o.label}
        </button>
      ))}
    </div>
  )
}
