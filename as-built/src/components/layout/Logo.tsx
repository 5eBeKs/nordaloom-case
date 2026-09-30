import { cn } from "@/lib/utils"

/** Wordmark: two rows of knit stitches and the name. */
export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <svg viewBox="0 0 24 20" className="h-4 w-5" aria-hidden>
        <path d="M2 3 L6 10 L10 3 L14 10 L18 3 L22 10" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M2 10 L6 17 L10 10 L14 17 L18 10 L22 17" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" opacity="0.45" />
      </svg>
      <span className="font-serif text-[1.45rem] leading-none tracking-[-0.01em]" style={{ fontVariationSettings: '"SOFT" 100, "opsz" 48' }}>
        Nordaloom
      </span>
    </span>
  )
}
