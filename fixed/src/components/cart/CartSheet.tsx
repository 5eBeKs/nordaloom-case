import { Link } from "react-router-dom"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Button } from "@/components/ui/button"
import { useCart } from "@/context/CartContext"
import { formatPrice } from "@/lib/format"
import { CartLine } from "./CartLine"
import { useBagDiscount } from "./Discount"
import { useAuth } from "@/context/AuthContext"

export function CartSheet() {
  const { items, count, subtotal, open, setOpen, ready } = useCart()
  const close = () => setOpen(false)
  const { user } = useAuth()
  const { code, discount, afterDiscount } = useBagDiscount(user?.email ?? undefined)

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetContent className="flex w-full flex-col gap-0 bg-background p-0 sm:max-w-md">
        <SheetHeader className="border-b px-6 py-5">
          <SheetTitle className="font-serif text-xl font-normal">Your bag</SheetTitle>
          <SheetDescription>
            {count === 0 ? "Nothing here yet." : `${count} ${count === 1 ? "piece" : "pieces"}`}
          </SheetDescription>
        </SheetHeader>

        {count === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-5 px-8 text-center">
            <p className="font-serif text-2xl">Your bag is empty</p>
            <p className="text-sm text-muted-foreground">Have a look around — there's plenty of wool to go round.</p>
            <Button asChild size="lg" className="rounded-none px-8">
              <Link to="/shop" onClick={close}>
                Browse the shop
              </Link>
            </Button>
          </div>
        ) : (
          <>
            <ul className="flex-1 divide-y overflow-y-auto px-6">
              {!ready || items.length === 0 ? (
                <li className="py-10 text-center text-sm text-muted-foreground">Loading your bag…</li>
              ) : (
                items.map((item) => <CartLine key={item.variantId} item={item} onNavigate={close} />)
              )}
            </ul>
            <div className="space-y-4 border-t bg-linen px-6 py-6">
              {discount > 0 && (
                <div className="flex items-baseline justify-between text-sm text-moss">
                  <span>Discount · {code}</span>
                  <span className="tabular-nums">−{formatPrice(discount)}</span>
                </div>
              )}
              <div className="flex items-baseline justify-between">
                <span className="text-sm">{discount > 0 ? "Subtotal after discount" : "Subtotal"}</span>
                <span className="font-serif text-xl tabular-nums">
                  {discount > 0 && <span className="mr-2 text-sm text-muted-foreground line-through">{formatPrice(subtotal)}</span>}
                  {formatPrice(afterDiscount)}
                </span>
              </div>
              <p className="text-xs text-muted-foreground">Including VAT. Shipping is calculated at checkout.</p>
              <Button asChild size="lg" className="h-12 w-full rounded-none">
                <Link to="/cart" onClick={close}>
                  View bag &amp; checkout
                </Link>
              </Button>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}
