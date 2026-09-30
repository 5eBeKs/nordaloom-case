import { useState } from "react"
import { cn } from "@/lib/utils"

type Bar = { key: string; label: string; tooltip: string; value: number; highlight?: boolean }

/**
 * A quiet bar chart: three gridlines, bars in the shop's charcoal, the value
 * of the bar under the pointer shown above the chart.
 */
export function BarChart({
  bars,
  format,
  height = 220,
  labelEvery = 1,
  emptyText = "No sales yet in this period.",
}: {
  bars: Bar[]
  format: (v: number) => string
  height?: number
  labelEvery?: number
  emptyText?: string
}) {
  const [active, setActive] = useState<number | null>(null)
  const max = Math.max(...bars.map((b) => b.value), 0)
  const top = niceCeil(max)
  const shown = active !== null ? bars[active] : null
  const empty = max === 0
  /** The bar under the finger or pointer. */
  const pick = (e: React.PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    return Math.max(0, Math.min(bars.length - 1, Math.floor(((e.clientX - r.left) / r.width) * bars.length)))
  }

  return (
    <div>
      <p className="h-5 text-sm text-muted-foreground" aria-live="polite">
        {shown ? (
          <>
            <span className="text-foreground">{shown.tooltip}</span> · {format(shown.value)}
          </>
        ) : (
          "Point at or touch a bar to see its figure."
        )}
      </p>
      <div className="relative mt-8" style={{ height }}>
        {/* gridlines */}
        {[1, 0.5, 0].map((f) => (
          <div key={f} className="absolute inset-x-0 flex items-center gap-2" style={{ bottom: `${f * 100}%` }}>
            <span className="w-14 shrink-0 -translate-y-1/2 text-right text-[0.7rem] text-muted-foreground tabular-nums">
              {empty ? "" : format(top * f)}
            </span>
            <span className={cn("h-px flex-1 -translate-y-1/2", f === 0 ? "bg-border" : "bg-border/60")} />
          </div>
        ))}
        {empty && <p className="absolute inset-0 flex items-center justify-center pl-16 text-sm text-muted-foreground">{emptyText}</p>}
        <div
          className="absolute inset-y-0 right-0 left-16 flex touch-pan-y items-end gap-[3px] outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          tabIndex={0}
          role="group"
          aria-label="Chart: use the arrow keys to read each bar"
          onPointerMove={(e) => setActive(pick(e))}
          onPointerDown={(e) => setActive(pick(e))}
          onPointerLeave={(e) => e.pointerType === "mouse" && setActive(null)}
          onKeyDown={(e) => {
            if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
              e.preventDefault()
              const step = e.key === "ArrowRight" ? 1 : -1
              setActive((a) => Math.max(0, Math.min(bars.length - 1, (a ?? (step > 0 ? -1 : bars.length)) + step)))
            }
          }}
          onBlur={() => setActive(null)}
        >
          {bars.map((b, i) => (
            <span key={b.key} aria-hidden className="flex h-full flex-1 items-end">
              <span
                className={cn("block w-full transition-colors", active === i ? "bg-clay" : b.highlight ? "bg-foreground" : "bg-foreground/70")}
                style={{ height: top ? `${Math.max((b.value / top) * 100, b.value > 0 ? 1.5 : 0)}%` : 0 }}
              />
            </span>
          ))}
          <ul className="sr-only">
            {bars.map((b) => (
              <li key={b.key}>
                {b.tooltip}: {format(b.value)}
              </li>
            ))}
          </ul>
        </div>
      </div>
      <div className="mt-2 flex gap-[3px] pl-16">
        {bars.map((b, i) => (
          <span key={b.key} className="flex-1 truncate text-center text-[0.7rem] text-muted-foreground">
            {i % labelEvery === 0 || i === bars.length - 1 ? b.label : ""}
          </span>
        ))}
      </div>
    </div>
  )
}

/** Rounds a maximum up to a tidy axis value (e.g. 1 870 → 2 000). */
function niceCeil(v: number) {
  if (v <= 0) return 0
  const exp = Math.pow(10, Math.floor(Math.log10(v)))
  const f = v / exp
  const nice = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10
  return nice * exp
}
