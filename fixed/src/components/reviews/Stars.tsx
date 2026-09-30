import { useState } from "react"
import { Star } from "lucide-react"
import { cn } from "@/lib/utils"

/** Five stars, filled to `value` (halves and quarters too). */
export function Stars({ value, className, size = "size-3.5" }: { value: number; className?: string; size?: string }) {
  const label = `${(Math.round(value * 10) / 10).toLocaleString("en-GB")} out of 5 stars`
  return (
    <span className={cn("relative inline-flex shrink-0", className)} role="img" aria-label={label} title={label}>
      <span className="flex gap-0.5 text-foreground/20">
        {[0, 1, 2, 3, 4].map((i) => (
          <Star key={i} className={size} strokeWidth={0} fill="currentColor" />
        ))}
      </span>
      <span className="absolute inset-y-0 left-0 flex gap-0.5 overflow-hidden text-foreground" style={{ width: `${(Math.max(0, Math.min(5, value)) / 5) * 100}%` }}>
        {[0, 1, 2, 3, 4].map((i) => (
          <Star key={i} className={cn(size, "shrink-0")} strokeWidth={0} fill="currentColor" />
        ))}
      </span>
    </span>
  )
}

const WORDS = ["", "Not for me", "Could be better", "It's fine", "I like it", "I love it"]

/** Choosing 1–5 stars, as radio buttons (arrow keys work). */
export function StarInput({ value, onChange, id }: { value: number; onChange: (n: number) => void; id?: string }) {
  const [hover, setHover] = useState(0)
  const shown = hover || value
  return (
    <div className="flex items-center gap-4">
      <div id={id} role="radiogroup" aria-label="Your rating" className="flex" onMouseLeave={() => setHover(0)}>
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={value === n}
            aria-label={`${n} ${n === 1 ? "star" : "stars"}`}
            tabIndex={value === n || (value === 0 && n === 1) ? 0 : -1}
            onMouseEnter={() => setHover(n)}
            onClick={() => onChange(n)}
            onKeyDown={(e) => {
              const step = e.key === "ArrowRight" || e.key === "ArrowUp" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowDown" ? -1 : 0
              if (!step) return
              e.preventDefault()
              const next = Math.max(1, Math.min(5, (value || (step > 0 ? 0 : 2)) + step))
              onChange(next)
              ;(e.currentTarget.parentElement?.children[next - 1] as HTMLElement | undefined)?.focus()
            }}
            className="p-1 first:-ml-1"
          >
            <Star
              className={cn("size-7 transition-colors", n <= shown ? "text-foreground" : "text-foreground/20")}
              strokeWidth={0}
              fill="currentColor"
            />
          </button>
        ))}
      </div>
      <span className="text-sm text-muted-foreground" aria-hidden>
        {WORDS[shown]}
      </span>
    </div>
  )
}
