import { useState } from "react"
import { Tag, X } from "lucide-react"
import { Input } from "@/components/ui/input"
import { useCart } from "@/context/CartContext"
import { checkDiscount, describeDiscount, discountMessage, useDiscount, type DiscountCheck } from "@/lib/discounts"
import { formatPrice } from "@/lib/format"
import { cn } from "@/lib/utils"

/** The bag's discount: which code, whether it applies, and what it takes off. */
export function useBagDiscount(email?: string) {
  const { subtotal, discountCode, setDiscountCode } = useCart()
  const q = useDiscount(discountCode, subtotal, email)
  const check: DiscountCheck | undefined = q.data && q.data.code === discountCode ? q.data : undefined
  const discount = check?.ok ? (check.discount_cents ?? 0) : 0
  return { code: discountCode, check, discount, afterDiscount: subtotal - discount, checking: q.isFetching, setDiscountCode }
}

/** Code entry in the bag and at checkout. */
export function DiscountField({ email, compact }: { email?: string; compact?: boolean }) {
  const { subtotal } = useCart()
  const { code, check, discount, setDiscountCode } = useBagDiscount(email)
  const [open, setOpen] = useState(false)
  const [value, setValue] = useState("")
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)

  // Not a <form>: at checkout this sits inside the checkout form.
  async function apply() {
    const c = value.trim()
    if (!c) return
    setBusy(true)
    setError("")
    try {
      const result = await checkDiscount(c, subtotal, email)
      if (result.ok || result.reason === "min_order") {
        // A code below its minimum stays in the bag and starts working once the bag is big enough.
        setDiscountCode(result.code)
        setValue("")
        setOpen(false)
      } else {
        setError(discountMessage(result))
      }
    } catch {
      setError("We couldn't check that code just now. Please try again.")
    } finally {
      setBusy(false)
    }
  }

  if (code) {
    return (
      <div className={cn("text-sm", !compact && "border-y py-4")}>
        <div className="flex items-center justify-between gap-3">
          <span className="flex items-center gap-2">
            <Tag className="size-4 text-clay" strokeWidth={1.5} />
            <span className="font-medium tracking-wide">{code}</span>
            {check?.ok && <span className="text-muted-foreground">· {describeDiscount(check)}</span>}
          </span>
          <button type="button" onClick={() => setDiscountCode(null)} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground" aria-label={`Remove code ${code}`}>
            <X className="size-3.5" /> Remove
          </button>
        </div>
        {check && !check.ok && <p className="mt-2 text-destructive">{discountMessage(check)}</p>}
        {check?.ok && discount > 0 && check.needs_email && (
          <p className="mt-2 text-xs text-muted-foreground">
            {check.first_order_only ? "For a first order" : "Once per customer"} — we'll confirm it with your email at checkout.
          </p>
        )}
      </div>
    )
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className={cn("flex items-center gap-2 text-sm underline-offset-4 hover:underline", !compact && "py-1")}>
        <Tag className="size-4" strokeWidth={1.5} /> Have a discount code?
      </button>
    )
  }

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <label htmlFor="discount-code" className="sr-only">
          Discount code
        </label>
        <Input
          id="discount-code"
          autoFocus
          value={value}
          onChange={(e) => {
            setValue(e.target.value.toUpperCase())
            setError("")
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault()
              void apply()
            }
          }}
          placeholder="Discount code"
          autoComplete="off"
          spellCheck={false}
          aria-invalid={!!error || undefined}
          className="h-11 flex-1 rounded-none bg-background tracking-wide uppercase"
        />
        <button type="button" onClick={() => void apply()} disabled={busy || !value.trim()} className="h-11 bg-foreground px-5 text-sm text-background disabled:opacity-50">
          {busy ? "…" : "Apply"}
        </button>
      </div>
      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}

/** "Discount (CODE)  −€15.90" line for summaries. */
export function DiscountLine({ code, amount }: { code: string | null; amount: number }) {
  if (!code || amount <= 0) return null
  return (
    <div className="flex justify-between text-moss">
      <dt>Discount · {code}</dt>
      <dd className="tabular-nums">−{formatPrice(amount)}</dd>
    </div>
  )
}
