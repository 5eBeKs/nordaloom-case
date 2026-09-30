import { Link } from "react-router-dom"
import { Button } from "@/components/ui/button"
import { CartLine } from "@/components/cart/CartLine"
import { DiscountField, DiscountLine, useBagDiscount } from "@/components/cart/Discount"
import { useCart } from "@/context/CartContext"
import { useAuth } from "@/context/AuthContext"
import { formatPrice, vatIncluded } from "@/lib/format"
import { useShippingRates, useShopSettings } from "@/lib/checkout"
import { useTitle } from "@/hooks/use-title"

export function CartPage() {
  useTitle("Your bag")
  const { items, count, subtotal, ready } = useCart()
  const { user } = useAuth()
  const { data: settings } = useShopSettings()
  const threshold = settings?.free_shipping_threshold_cents
  const { data: rates = [] } = useShippingRates()
  const cheapest = rates.length ? Math.min(...rates.map((r) => r.price_cents)) : undefined
  const stockProblem = items.some((i) => i.quantity > i.stock)
  const { code, discount, afterDiscount } = useBagDiscount(user?.email ?? undefined)

  return (
    <div className="container-shop pt-14 md:pt-20">
      <h1 className="text-5xl font-light md:text-6xl">Your bag</h1>

      {ready && count === 0 ? (
        <div className="mt-12 max-w-lg">
          <p className="text-lg text-muted-foreground">Your bag is empty. Our sweaters are waiting.</p>
          <Button asChild size="lg" className="mt-8 h-12 rounded-none px-8">
            <Link to="/shop">Browse the shop</Link>
          </Button>
        </div>
      ) : (
        <div className="mt-12 grid gap-12 lg:grid-cols-12 lg:gap-16">
          <ul className="divide-y border-y lg:col-span-8">
            {!ready || items.length === 0 ? (
              <li className="py-16 text-center text-muted-foreground">Loading your bag…</li>
            ) : (
              items.map((item) => <CartLine key={item.variantId} item={item} large />)
            )}
          </ul>

          <aside className="lg:col-span-4">
            <div className="bg-linen p-7 lg:sticky lg:top-28">
              <h2 className="text-2xl">Summary</h2>
              <dl className="mt-6 space-y-3 text-sm">
                <div className="flex justify-between">
                  <dt>
                    Subtotal ({count} {count === 1 ? "piece" : "pieces"})
                  </dt>
                  <dd className="tabular-nums">{formatPrice(subtotal)}</dd>
                </div>
                <DiscountLine code={code} amount={discount} />
                <div className="flex justify-between text-muted-foreground">
                  <dt>Delivery</dt>
                  <dd>{threshold !== undefined && afterDiscount >= threshold ? "Free" : cheapest !== undefined ? `From ${formatPrice(cheapest)}, at checkout` : "At checkout"}</dd>
                </div>
                <div className="flex justify-between border-t pt-4 text-base">
                  <dt className="font-medium">Total</dt>
                  <dd className="font-serif text-2xl tabular-nums">{formatPrice(afterDiscount)}</dd>
                </div>
                <div className="flex justify-between text-xs text-muted-foreground">
                  <dt>Includes 21% VAT</dt>
                  <dd className="tabular-nums">{formatPrice(vatIncluded(afterDiscount))}</dd>
                </div>
              </dl>
              <div className="mt-6">
                <DiscountField email={user?.email ?? undefined} />
              </div>
              {threshold !== undefined && afterDiscount > 0 && afterDiscount < threshold && (
                <p className="mt-6 text-sm text-muted-foreground">
                  Add {formatPrice(threshold - afterDiscount)} more for free delivery{discount > 0 && " (counted after the discount)"}.
                </p>
              )}
              {stockProblem ? (
                <p className="mt-6 text-sm text-destructive">Some pieces have sold out — please adjust your bag to continue.</p>
              ) : null}
              <Button
                asChild={!stockProblem && ready && items.length > 0}
                size="lg"
                disabled={stockProblem || !ready || items.length === 0}
                className="mt-6 h-12 w-full rounded-none text-[0.8rem] tracking-[0.12em] uppercase"
              >
                {!stockProblem && ready && items.length > 0 ? <Link to="/checkout">Checkout</Link> : <span>Checkout</span>}
              </Button>
              <p className="mt-3 text-center text-xs leading-relaxed text-muted-foreground">
                Pay by bank transfer · Delivery within the EU
              </p>
              {!user && (
                <p className="mt-6 border-t pt-5 text-sm text-muted-foreground">
                  <Link to="/login?next=/cart" className="text-foreground underline underline-offset-4">
                    Sign in
                  </Link>{" "}
                  to keep your bag on all your devices.
                </p>
              )}
            </div>
          </aside>
        </div>
      )}
    </div>
  )
}
