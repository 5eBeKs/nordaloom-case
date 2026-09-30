import type { ReactNode } from "react"
import { Search } from "lucide-react"
import { cn } from "@/lib/utils"

export function PageHeader({ eyebrow, title, intro, actions }: { eyebrow?: string; title: string; intro?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-6">
      <div>
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h1 className={cn("text-4xl font-light md:text-5xl", eyebrow && "mt-3")}>{title}</h1>
        {intro && <p className="mt-3 max-w-2xl text-muted-foreground">{intro}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </header>
  )
}

export function Panel({ title, action, className, children }: { title?: string; action?: ReactNode; className?: string; children: ReactNode }) {
  return (
    <section className={cn("min-w-0 border bg-card p-5 sm:p-6", className)}>
      {(title || action) && (
        <div className="mb-5 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
          {title && <h2 className="text-xl">{title}</h2>}
          {action}
        </div>
      )}
      {children}
    </section>
  )
}

export function FilterTabs<T extends string>({
  options,
  value,
  onChange,
  counts,
}: {
  options: { key: T; label: string }[]
  value: T
  onChange: (v: T) => void
  counts?: Partial<Record<T, number>>
}) {
  return (
    <div className="flex gap-1 overflow-x-auto border-b">
      {options.map((f) => (
        <button
          key={f.key}
          onClick={() => onChange(f.key)}
          className={cn(
            "-mb-px shrink-0 border-b-2 px-4 py-3 text-sm whitespace-nowrap",
            value === f.key ? "border-foreground text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
          )}
        >
          {f.label}
          {counts && <span className="ml-1.5 text-xs text-muted-foreground tabular-nums">{counts[f.key] ?? 0}</span>}
        </button>
      ))}
    </div>
  )
}

export function SearchInput({ value, onChange, placeholder, className }: { value: string; onChange: (v: string) => void; placeholder: string; className?: string }) {
  return (
    <label className={cn("relative block", className)}>
      <span className="sr-only">{placeholder}</span>
      <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="h-11 w-full border border-input bg-card pr-3 pl-9 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
      />
    </label>
  )
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="py-16 text-center text-muted-foreground">{children}</p>
}

export function Toggle({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        // The switch looks small, but the area that responds to a finger is 44px high.
        "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 after:absolute after:-inset-x-1 after:-inset-y-2.5 after:content-['']",
        checked ? "bg-moss" : "bg-input",
      )}
    >
      <span className={cn("inline-block size-5 rounded-full bg-background shadow transition-transform", checked ? "translate-x-5.5" : "translate-x-0.5")} />
    </button>
  )
}
