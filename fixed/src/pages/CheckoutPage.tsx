import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react"
import { Link, useNavigate } from "react-router-dom"
import { useQueryClient } from "@tanstack/react-query"
import { CreditCard, Landmark, Lock } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ProductImage } from "@/components/art/ProductImage"
import { DemoDetailsNote } from "@/components/DemoNote"
import { useCart } from "@/context/CartContext"
import { useAuth } from "@/context/AuthContext"
import { formatPrice, vatIncluded } from "@/lib/format"
import {
  checkoutAttemptKey,
  earlierAttemptOrders,
  fingerprint,
  EU_COUNTRIES,
  forgetCheckoutAttempt,
  markAttemptUnanswered,
  placeOrder,
  rememberOrder,
  shippingFor,
  unansweredAttempt,
  useShippingRates,
  useShopSettings,
  type CustomerDetails,
  type EarlierOrder,
  type PaymentMethod,
} from "@/lib/checkout"
import { goToCardPayment, useCardPayments } from "@/lib/payments"
import { useOnline } from "@/lib/pwa"
import { useTitle } from "@/hooks/use-title"
import { DiscountField, DiscountLine, useBagDiscount } from "@/components/cart/Discount"
import { discountMessage, type DiscountReason } from "@/lib/discounts"
import { MAX_ADDRESSES, sameAddress, saveAddress, useAddresses, type SavedAddress } from "@/lib/account"
import { cn } from "@/lib/utils"
import { isOnline } from "@/lib/connection"

type Errors = Partial<Record<keyof CustomerDetails | "locker" | "shipping", string>>

const EMPTY: CustomerDetails = {
  email: "",
  full_name: "",
  phone: "",
  country: "LV",
  address_line1: "",
  address_line2: "",
  city: "",
  postal_code: "",
}

const SERVER_ERRORS: Record<string, string> = {
  invalid_email: "Please check your email address.",
  missing_details: "Please fill in your name, phone and full address.",
  details_too_long: "Some of the details are too long — please shorten them.",
  invalid_shipping: "Please choose a delivery option for your country.",
  missing_locker: "Please tell us which Omniva parcel locker to deliver to.",
  empty_cart: "Your bag is empty.",
  invalid_quantity: "One of the quantities in your bag isn't valid.",
}

export function CheckoutPage() {
  useTitle("Checkout")
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { items, count, subtotal, ready, clearAfterOrder, refresh } = useCart()
  const { user, profile } = useAuth()
  const { data: rates = [] } = useShippingRates()
  const { data: settings } = useShopSettings()

  const [form, setForm] = useState<CustomerDetails>(EMPTY)
  const [shippingCode, setShippingCode] = useState("")
  const [locker, setLocker] = useState("")
  const [errors, setErrors] = useState<Errors>({})
  const [formError, setFormError] = useState<ReactNode>(null)
  const [placing, setPlacing] = useState(false)
  // Orders that an earlier, unanswered attempt turned out to have made (shown when the bag is empty after it).
  const [wentThrough, setWentThrough] = useState<EarlierOrder[]>([])
  const online = useOnline()
  const { data: cardPayments } = useCardPayments()
  const cardAvailable = !!cardPayments?.enabled
  const [method, setMethod] = useState<PaymentMethod | null>(null)
  // Card first when it's available; bank transfer otherwise.
  const payment: PaymentMethod = method ?? (cardAvailable ? "card" : "bank_transfer")
  const { data: addresses = [] } = useAddresses(user?.id)
  const [chosenAddress, setChosenAddress] = useState<string | "new" | null>(null)
  const [saveNewAddress, setSaveNewAddress] = useState(true)

  // Prefill from the account, without overwriting anything typed.
  useEffect(() => {
    if (!user) return
    setForm((f) => ({
      ...f,
      email: f.email || user.email || "",
      full_name: f.full_name || profile?.full_name || "",
    }))
  }, [user, profile?.full_name])

  const fillFrom = (a: SavedAddress) => {
    setForm((f) => ({
      ...f,
      full_name: a.full_name,
      phone: a.phone,
      country: a.country,
      address_line1: a.address_line1,
      address_line2: a.address_line2,
      city: a.city,
      postal_code: a.postal_code,
    }))
    setErrors({})
  }

  // Start from the default saved address, once they've loaded.
  useEffect(() => {
    if (chosenAddress !== null || addresses.length === 0) return
    const def = addresses.find((a) => a.is_default) ?? addresses[0]
    setChosenAddress(def.id)
    fillFrom(def)
  }, [addresses, chosenAddress])

  // The bag is empty and an earlier press got no answer (a signed-in customer's bag is emptied
  // by the order itself): find out whether that order went through, and say so.
  useEffect(() => {
    // Only for a signed-in customer: a guest's bag stays on the device, and they press again.
    if (!ready || count > 0 || placing || !user) return
    const unanswered = unansweredAttempt()
    if (!unanswered || unanswered.email.trim().toLowerCase() !== (user.email ?? "").toLowerCase()) return
    let cancelled = false
    void earlierAttemptOrders(unanswered.key, unanswered.email).then((orders) => {
      if (cancelled || !orders) return
      if (orders.length > 0) forgetCheckoutAttempt()
      setWentThrough(orders)
    })
    return () => {
      cancelled = true
    }
  }, [ready, count, placing, user])

  const matchesSaved = addresses.some((a) => sameAddress(a, form))
  const offerSave = !!user && !matchesSaved && addresses.length < MAX_ADDRESSES

  const countryRates = useMemo(() => rates.filter((r) => r.countries.includes(form.country)), [rates, form.country])
  const rate = countryRates.find((r) => r.code === shippingCode)

  // Keep a valid delivery option selected for the chosen country.
  useEffect(() => {
    if (countryRates.length && !countryRates.some((r) => r.code === shippingCode)) {
      setShippingCode(countryRates[0].code)
    }
  }, [countryRates, shippingCode])

  const threshold = settings?.free_shipping_threshold_cents
  const { code: discountCode, check: discountCheck, discount, afterDiscount, setDiscountCode } = useBagDiscount(form.email)
  // A code that doesn't apply (e.g. this email has ordered before) must be removed before ordering.
  const discountBlocked = !!discountCode && !!discountCheck && !discountCheck.ok
  // Free delivery counts from the amount after the discount.
  const shipping = shippingFor(rate, afterDiscount, threshold)
  const total = afterDiscount + shipping
  const stockProblem = items.some((i) => i.quantity > i.stock)

  const set = (key: keyof CustomerDetails) => (value: string) => {
    setForm((f) => ({ ...f, [key]: value }))
    if (errors[key]) setErrors((e) => ({ ...e, [key]: undefined }))
  }

  function validate(): Errors {
    const e: Errors = {}
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form.email.trim())) e.email = "Please enter a valid email address."
    if (form.full_name.trim().length < 2) e.full_name = "Please enter your full name."
    if (form.phone.replace(/\D/g, "").length < 6) e.phone = "Please enter a phone number — the courier may need it."
    if (!form.address_line1.trim()) e.address_line1 = "Please enter your street address."
    if (!form.city.trim()) e.city = "Please enter your city."
    if (!form.postal_code.trim()) e.postal_code = "Please enter your postal code."
    if (!rate) e.shipping = "Please choose a delivery option."
    if (rate?.needs_locker && !locker.trim()) e.locker = "Please tell us which parcel locker to deliver to."
    return e
  }

  async function submit(ev: FormEvent) {
    ev.preventDefault()
    setFormError(null)
    const e = validate()
    setErrors(e)
    if (Object.keys(e).length > 0) {
      setFormError("Please check the highlighted fields.")
      document.querySelector<HTMLElement>("[aria-invalid=true]")?.focus()
      return
    }
    if (!isOnline()) {
      setFormError(
        "You're offline. Your bag and details are kept here — place your order when you're back online. Nothing has been sent or charged.",
      )
      return
    }
    setPlacing(true)
    const sending = {
      items: items.map((i) => ({ variant_id: i.variantId, quantity: i.quantity })),
      customer: form,
      shipping: shippingCode,
      locker: rate?.needs_locker ? locker : "",
      code: discountCode && discountCheck?.ok ? discountCode : null,
      method: (payment === "card" && cardAvailable ? "card" : "bank_transfer") as PaymentMethod,
    }
    const print = JSON.stringify([
      // signed in or not is part of what the shop takes as "the same order"
      user?.id ?? "",
      [...sending.items].sort((a, b) => a.variant_id.localeCompare(b.variant_id)),
      Object.values(sending.customer).map((v) => v.trim().toLowerCase()),
      sending.shipping,
      sending.locker.trim().toLowerCase(),
      sending.code,
      sending.method,
    ])
    // An earlier press got no answer, and something has been changed since. The same order sent
    // again is recognised by the shop; a changed one would be a second order. So first find out
    // whether the earlier one went through, and say so before ordering anything more.
    const unanswered = unansweredAttempt()
    if (unanswered && unanswered.print !== fingerprint(print)) {
      // Asked whatever has changed, with the address the attempt was sent with. The earlier order is
      // named only to someone ordering with that same address; anyone else is told only that an
      // earlier attempt from this device went through.
      const sameCustomer = unanswered.email.trim().toLowerCase() === form.email.trim().toLowerCase()
      const earlier = await earlierAttemptOrders(unanswered.key, unanswered.email)
      if (earlier === null) {
        setPlacing(false)
        setFormError("We couldn't reach the shop. Nothing new has been sent — please try again in a moment.")
        return
      }
      // Either way the changed order is a new attempt, with a key of its own.
      forgetCheckoutAttempt()
      if (earlier.length > 0 && !sameCustomer) {
        setPlacing(false)
        setFormError(
          <>
            An earlier attempt from this device did reach us, under another email address. If that was you, the order is in that
            mailbox{earlier.some((o) => o.payment_method === "card") ? " (a card order that isn't paid cancels itself within 40 minutes)" : ""}.
            Pressing the button again places what is here now as <strong>a new order</strong>.
          </>,
        )
        return
      }
      if (earlier.length > 0) {
        setPlacing(false)
        setFormError(
          <>
            Your earlier attempt did reach us:{" "}
            {earlier.map((o, i) => (
              <span key={o.order_number}>
                {i > 0 && ", "}
                order <strong>{o.order_number}</strong> for {formatPrice(o.total_cents)}
              </span>
            ))}{" "}
            {earlier.some((o) => o.payment_method === "card") ? (
              <>
                was made but not paid: it will be cancelled by itself within 40 minutes, and nothing is taken from your card. Press the
                button again to place the order as it is here now.
              </>
            ) : (
              <>
                {earlier.length === 1 ? "is" : "are"} placed, and how to pay was emailed to <strong>{unanswered.email}</strong>. What is here
                now is different from it, so pressing the button again places it as <strong>another order</strong>. If the earlier order is
                the one you wanted, there is nothing more to do.
              </>
            )}
          </>,
        )
        return
      }
    }
    const result = await placeOrder(
      sending.items,
      sending.customer,
      sending.shipping,
      sending.locker,
      sending.code,
      sending.method,
      checkoutAttemptKey(),
      // Known only once the shop's delivery rules have loaded; without it the shop's own total stands.
      settings ? total : null,
    )
    if (result.ok) {
      forgetCheckoutAttempt()
      if (offerSave && saveNewAddress) {
        // Best effort: the order is placed either way.
        await saveAddress({ ...form, label: "" })
        void queryClient.invalidateQueries({ queryKey: ["addresses"] })
      }
      // A guest's only way back to the order; an account's orders open from the account.
      if (!user) rememberOrder(result.orderNumber, result.accessToken)
      const orderPage = `/order/${result.orderNumber}${user ? "" : `?token=${result.accessToken}`}`
      clearAfterOrder()
      // Stock has changed: product pages should show it.
      void queryClient.invalidateQueries({ queryKey: ["products"] })
      void queryClient.invalidateQueries({ queryKey: ["product"] })
      if (payment === "card" && cardAvailable) {
        // Off to Stripe's payment page; if it can't open, the order page offers the choices.
        const started = await goToCardPayment(result.orderNumber, result.accessToken)
        if (started.ok) return
        navigate(`${orderPage}${user ? "?" : "&"}card=failed`, { replace: true })
        return
      }
      navigate(orderPage, { replace: true })
      return
    }
    setPlacing(false)
    if (result.code === "network") {
      markAttemptUnanswered(print, form.email)
      setFormError(
        "We couldn't confirm your order — the connection dropped, and it may already have reached us. Your bag is kept. When you're back online, press the button again without changing anything: if the order did go through you'll be shown it, and it won't be placed twice.",
      )
      return
    }
    if (result.code === "price_changed") {
      // Whatever moved the total: a piece's price, the code, a delivery price or the free-delivery line.
      await refresh()
      await Promise.all(["discount", "shipping-rates", "shop-settings"].map((key) => queryClient.invalidateQueries({ queryKey: [key] })))
      const now = Number(result.detail)
      setFormError(
        <>
          A price changed while you were checking out
          {Number.isFinite(now) && now > 0 ? (
            <>
              : your order now comes to <strong>{formatPrice(now)}</strong>, not {formatPrice(total)}
            </>
          ) : null}
          . Nothing has been ordered yet — please check the summary and press the button again.
        </>,
      )
      return
    }
    if (result.code === "too_many_unpaid") {
      setFormError(
        result.detail === "account"
          ? "You already have five orders waiting for payment. Please pay for one of them, or wait until it is cancelled, before placing another."
          : `There are already three orders waiting for a bank transfer under this email address. Please pay for one of them or wait until it is cancelled — or ${cardAvailable ? "pay by card, or " : ""}sign in to the account with this address.`,
      )
      return
    }
    if (result.code === "too_many_guest_orders") {
      // Limits for the whole shop on orders without an account; a signed-in customer is never held to them.
      // Orders waiting for a transfer stay for days, so waiting an hour only helps with the hourly one.
      const account = (
        <>
          <Link to="/login?next=/checkout" className="underline underline-offset-4">
            sign in
          </Link>{" "}
          or{" "}
          <Link to="/register?next=/checkout" className="underline underline-offset-4">
            create an account
          </Link>
        </>
      )
      setFormError(
        result.detail === "bank_transfer" ? (
          cardAvailable ? (
            <>Lots of orders are coming in right now. Please pay by card, or {account}.</>
          ) : (
            <>Lots of orders are coming in right now. To order, please {account}.</>
          )
        ) : (
          <>Lots of orders are coming in right now. To order now, please {account}; otherwise, try again in an hour.</>
        ),
      )
      return
    }
    if (result.code === "order_too_large") {
      setFormError("One order can hold up to 40 pieces. For more, please place a second order — or write to us and we'll arrange it.")
      return
    }
    if (result.code === "too_many_orders") {
      setFormError("We've had an unusual number of unpaid orders from your network today, so we can't take another one just now. Please try again later — or write to us and we'll place it for you.")
      return
    }
    if (result.code === "out_of_stock") {
      await refresh()
      const names = [...new Set((result.unavailable ?? []).map((u) => u.name).filter(Boolean))]
      const withdrawn = [...new Set((result.unavailable ?? []).filter((u) => u.withdrawn).map((u) => u.name))]
      if (withdrawn.length > 0) {
        setFormError(
          <>
            Sorry — {withdrawn.join(", ")} {withdrawn.length === 1 ? "is" : "are"} no longer sold, so nothing was ordered.{" "}
            <Link to="/cart" className="underline underline-offset-4">
              Please review your bag
            </Link>{" "}
            and try again.
          </>,
        )
        return
      }
      setFormError(
        <>
          Sorry — {names.length ? names.join(", ") : "something in your bag"} just sold out or has fewer pieces left
          than you asked for. We've updated your bag;{" "}
          <Link to="/cart" className="underline underline-offset-4">
            please review it
          </Link>{" "}
          and try again.
        </>,
      )
      return
    }
    if (result.code === "discount_invalid") {
      setFormError(
        <>
          {discountMessage({ ok: false, code: discountCode ?? "", reason: result.detail as DiscountReason })}{" "}
          <button type="button" className="underline underline-offset-4" onClick={() => { setDiscountCode(null); setFormError(null) }}>
            Remove the code
          </button>{" "}
          to continue without it.
        </>,
      )
      return
    }
    setFormError(SERVER_ERRORS[result.code] ?? "Something went wrong placing your order. Nothing has been charged — please try again.")
  }

  if (ready && count === 0 && !placing) {
    return (
      <div className="container-shop pt-14 md:pt-20">
        <h1 className="text-5xl font-light">Checkout</h1>
        {wentThrough.length > 0 && (
          <p className="mt-6 max-w-xl border border-foreground p-5 text-base" role="status">
            Your order did reach us:{" "}
            {wentThrough.map((o, i) => (
              <span key={o.order_number}>
                {i > 0 && ", "}
                <strong>{o.order_number}</strong> for {formatPrice(o.total_cents)}
              </span>
            ))}
            .{" "}
            {wentThrough.some((o) => o.payment_method === "card") ? (
              <>It isn't paid: a card order that isn't paid cancels itself within 40 minutes, and nothing is taken from your card.</>
            ) : (
              <>
                How to pay is in your email and in{" "}
                <Link to="/account" className="underline underline-offset-4">
                  your account
                </Link>
                .
              </>
            )}
          </p>
        )}
        <p className="mt-6 text-lg text-muted-foreground">Your bag is empty.</p>
        <Button asChild size="lg" className="mt-8 h-12 rounded-none px-8">
          <Link to="/shop">Browse the shop</Link>
        </Button>
      </div>
    )
  }

  return (
    <div className="container-shop pt-10 md:pt-16">
      <nav className="text-xs text-muted-foreground" aria-label="Breadcrumb">
        <Link to="/cart" className="hover:text-foreground">
          Bag
        </Link>{" "}
        / <span className="text-foreground">Checkout</span>
      </nav>
      <h1 className="mt-4 text-5xl font-light md:text-6xl">Checkout</h1>
      <DemoDetailsNote className="mt-6 max-w-2xl" orders />

      <form onSubmit={submit} noValidate className="mt-12 grid gap-12 lg:grid-cols-12 lg:gap-16">
        <div className="space-y-14 lg:col-span-7">
          {/* Contact */}
          <Section step="1" title="Contact">
            {!user && (
              <p className="-mt-2 mb-6 text-sm text-muted-foreground">
                No account needed.{" "}
                <Link to="/login?next=/checkout" className="text-foreground underline underline-offset-4">
                  Sign in
                </Link>{" "}
                if you have one.
              </p>
            )}
            <div className="grid gap-5 sm:grid-cols-2">
              <Field id="email" label="Email" error={errors.email} className="sm:col-span-2">
                <TextInput id="email" type="email" autoComplete="email" value={form.email} onChange={set("email")} invalid={!!errors.email} />
              </Field>
              <Field id="full_name" label="Full name" error={errors.full_name}>
                <TextInput id="full_name" autoComplete="name" value={form.full_name} onChange={set("full_name")} invalid={!!errors.full_name} />
              </Field>
              <Field id="phone" label="Phone" error={errors.phone}>
                <TextInput id="phone" type="tel" autoComplete="tel" placeholder="+371 …" value={form.phone} onChange={set("phone")} invalid={!!errors.phone} />
              </Field>
            </div>
          </Section>

          {/* Address */}
          <Section step="2" title="Address">
            {addresses.length > 0 && (
              <fieldset className="mb-8">
                <legend className="mb-3 text-sm">Your saved addresses</legend>
                <div className="grid gap-3 sm:grid-cols-2">
                  {addresses.map((a) => (
                    <label
                      key={a.id}
                      className={cn(
                        "flex cursor-pointer gap-3 border p-4 text-sm transition-colors",
                        chosenAddress === a.id ? "border-foreground bg-card" : "border-input hover:border-foreground/40",
                      )}
                    >
                      <input
                        type="radio"
                        name="saved-address"
                        checked={chosenAddress === a.id}
                        onChange={() => {
                          setChosenAddress(a.id)
                          fillFrom(a)
                        }}
                        className="mt-0.5 accent-foreground"
                      />
                      <span>
                        <span className="block font-medium">{a.label || a.full_name}</span>
                        <span className="block text-muted-foreground">
                          {a.address_line1}, {a.city}
                        </span>
                      </span>
                    </label>
                  ))}
                  <label
                    className={cn(
                      "flex cursor-pointer items-center gap-3 border border-dashed p-4 text-sm transition-colors",
                      chosenAddress === "new" ? "border-foreground bg-card" : "border-input hover:border-foreground/40",
                    )}
                  >
                    <input
                      type="radio"
                      name="saved-address"
                      checked={chosenAddress === "new"}
                      onChange={() => {
                        setChosenAddress("new")
                        setForm((f) => ({ ...f, address_line1: "", address_line2: "", city: "", postal_code: "" }))
                      }}
                      className="accent-foreground"
                    />
                    A different address
                  </label>
                </div>
              </fieldset>
            )}
            <div className="grid gap-5 sm:grid-cols-6">
              <Field id="country" label="Country" className="sm:col-span-6">
                <select
                  id="country"
                  autoComplete="country"
                  value={form.country}
                  onChange={(e) => set("country")(e.target.value)}
                  className="h-12 w-full rounded-none border border-input bg-card px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                >
                  {EU_COUNTRIES.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.name}
                    </option>
                  ))}
                </select>
                <p className="mt-2 text-xs text-muted-foreground">We ship within the European Union only.</p>
              </Field>
              <Field id="address_line1" label="Street address" error={errors.address_line1} className="sm:col-span-6">
                <TextInput id="address_line1" autoComplete="address-line1" value={form.address_line1} onChange={set("address_line1")} invalid={!!errors.address_line1} />
              </Field>
              <Field id="address_line2" label="Apartment, floor (optional)" className="sm:col-span-6">
                <TextInput id="address_line2" autoComplete="address-line2" value={form.address_line2} onChange={set("address_line2")} />
              </Field>
              <Field id="city" label="City" error={errors.city} className="sm:col-span-4">
                <TextInput id="city" autoComplete="address-level2" value={form.city} onChange={set("city")} invalid={!!errors.city} />
              </Field>
              <Field id="postal_code" label="Postal code" error={errors.postal_code} className="sm:col-span-2">
                <TextInput id="postal_code" autoComplete="postal-code" value={form.postal_code} onChange={set("postal_code")} invalid={!!errors.postal_code} />
              </Field>
              {offerSave && (
                <label className="flex items-center gap-2 text-sm sm:col-span-6">
                  <input type="checkbox" checked={saveNewAddress} onChange={(e) => setSaveNewAddress(e.target.checked)} className="accent-foreground" />
                  Save this address to my account
                </label>
              )}
            </div>
          </Section>

          {/* Delivery */}
          <Section step="3" title="Delivery">
            <fieldset>
              <legend className="sr-only">Delivery option</legend>
              <div className="space-y-3">
                {countryRates.map((r) => {
                  const price = shippingFor(r, afterDiscount, threshold)
                  return (
                    <label
                      key={r.code}
                      className={cn(
                        "flex cursor-pointer items-start gap-4 border p-4 transition-colors",
                        shippingCode === r.code ? "border-foreground bg-card" : "border-input hover:border-foreground/40",
                      )}
                    >
                      <input
                        type="radio"
                        name="shipping"
                        value={r.code}
                        checked={shippingCode === r.code}
                        onChange={() => setShippingCode(r.code)}
                        className="mt-1 accent-foreground"
                      />
                      <span className="flex-1">
                        <span className="block font-medium">{r.label}</span>
                        <span className="mt-0.5 block text-sm text-muted-foreground">{r.description}</span>
                      </span>
                      <span className="text-sm tabular-nums">
                        {price === 0 ? (
                          <>
                            <span className="mr-2 text-muted-foreground line-through">{formatPrice(r.price_cents)}</span>
                            <span className="text-moss">Free</span>
                          </>
                        ) : (
                          formatPrice(price)
                        )}
                      </span>
                    </label>
                  )
                })}
              </div>
              {errors.shipping && <p className="mt-2 text-sm text-destructive">{errors.shipping}</p>}
            </fieldset>

            {rate?.needs_locker && (
              <Field id="locker" label="Omniva parcel locker" error={errors.locker} className="mt-5">
                <TextInput
                  id="locker"
                  placeholder="e.g. Rīga, Origo shopping centre"
                  value={locker}
                  onChange={(v) => {
                    setLocker(v)
                    if (errors.locker) setErrors((e) => ({ ...e, locker: undefined }))
                  }}
                  invalid={!!errors.locker}
                />
                <p className="mt-2 text-xs text-muted-foreground">
                  Write the locker's name or address. Omniva will text you a code when your parcel arrives.
                </p>
              </Field>
            )}

            {threshold !== undefined && afterDiscount < threshold && (
              <p className="mt-5 text-sm text-muted-foreground">
                Add {formatPrice(threshold - afterDiscount)} more for free delivery{discount > 0 && " (counted after the discount)"}.
              </p>
            )}
          </Section>

          {/* Payment */}
          <Section step="4" title="Payment">
            <div className="space-y-3" role="radiogroup" aria-label="How would you like to pay?">
              {cardAvailable && (
                <PaymentOption
                  checked={payment === "card"}
                  onSelect={() => setMethod("card")}
                  icon={<CreditCard className="mt-0.5 size-5 shrink-0" strokeWidth={1.5} />}
                  title="Card"
                  text="Pay now on Stripe's secure payment page, then come straight back here. Your order is on its way to being packed as soon as the payment goes through."
                  note={cardPayments?.test ? "Test mode: use the card number 4242 4242 4242 4242, any future date and any CVC." : undefined}
                />
              )}
              <PaymentOption
                checked={payment === "bank_transfer"}
                onSelect={() => setMethod("bank_transfer")}
                icon={<Landmark className="mt-0.5 size-5 shrink-0" strokeWidth={1.5} />}
                title="Bank transfer"
                text={`After you place your order you'll see our bank details and a payment reference. We reserve your pieces for ${settings?.payment_days ?? 5} days and send them as soon as your payment arrives; unpaid orders are cancelled after that.`}
              />
            </div>
          </Section>
        </div>

        {/* Summary */}
        <aside className="lg:col-span-5">
          <div className="bg-linen p-6 sm:p-8 lg:sticky lg:top-28">
            <h2 className="text-2xl">Your order</h2>
            <ul className="mt-6 divide-y">
              {items.map((i) => (
                <li key={i.variantId} className="flex gap-4 py-4">
                  <div className="relative aspect-[4/5] w-16 shrink-0 overflow-hidden bg-muted">
                    <ProductImage product={i.product} colour={i.product.colours.find((c) => c.name === i.colour)} />
                    <span className="absolute top-1 right-1 flex size-5 items-center justify-center rounded-full bg-foreground text-[0.7rem] font-semibold text-background">
                      {i.quantity}
                    </span>
                  </div>
                  <div className="min-w-0 flex-1 text-sm">
                    <p className="font-medium">{i.product.name}</p>
                    <p className="mt-0.5 text-muted-foreground">
                      {i.colour}
                      {i.size !== "One size" && <> · {i.size}</>}
                    </p>
                    {i.quantity > i.stock && (
                      <p className="mt-1 text-destructive">{i.stock === 0 ? "Sold out" : `Only ${i.stock} left`}</p>
                    )}
                  </div>
                  <p className="text-sm tabular-nums">{formatPrice(i.lineTotal)}</p>
                </li>
              ))}
            </ul>
            <dl className="mt-4 space-y-3 border-t pt-5 text-sm">
              <div className="flex justify-between">
                <dt>Subtotal</dt>
                <dd className="tabular-nums">{formatPrice(subtotal)}</dd>
              </div>
              <DiscountLine code={discountCode} amount={discount} />
              <div className="flex justify-between">
                <dt>Delivery{rate && <span className="text-muted-foreground"> · {rate.label}</span>}</dt>
                <dd className="tabular-nums">{rate ? (shipping === 0 ? "Free" : formatPrice(shipping)) : "—"}</dd>
              </div>
              <div className="flex items-baseline justify-between border-t pt-4 text-base">
                <dt className="font-medium">Total</dt>
                <dd className="font-serif text-2xl tabular-nums">{formatPrice(total)}</dd>
              </div>
              <div className="flex justify-between text-xs text-muted-foreground">
                <dt>Includes 21% VAT</dt>
                <dd className="tabular-nums">{formatPrice(vatIncluded(total))}</dd>
              </div>
            </dl>

            <div className="mt-5 border-t pt-5">
              <DiscountField email={form.email} compact />
            </div>

            {!online && !formError && (
              <p className="mt-6 border border-foreground/20 bg-background p-4 text-sm" role="status">
                You're offline. Your bag is kept — you can place your order as soon as you're back online.
              </p>
            )}
            {formError && (
              <p className="mt-6 border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive" role="alert">
                {formError}
              </p>
            )}
            {stockProblem && !formError && (
              <p className="mt-6 text-sm text-destructive">
                Some pieces in your bag have sold out.{" "}
                <Link to="/cart" className="underline underline-offset-4">
                  Update your bag
                </Link>{" "}
                to continue.
              </p>
            )}

            <Button
              type="submit"
              size="lg"
              disabled={placing || !ready || items.length === 0 || stockProblem || discountBlocked}
              className="mt-6 h-13 w-full rounded-none text-[0.8rem] tracking-[0.12em] uppercase"
            >
              {placing
                ? payment === "card"
                  ? "Opening secure payment…"
                  : "Placing your order…"
                : payment === "card"
                  ? `Continue to payment · ${formatPrice(total)}`
                  : `Place order · ${formatPrice(total)}`}
            </Button>
            <p className="mt-3 flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
              <Lock className="size-3" />{" "}
              {payment === "card" ? "You'll pay by card on Stripe's secure page." : "You'll pay by bank transfer after placing the order."}
            </p>
          </div>
        </aside>
      </form>
    </div>
  )
}

function PaymentOption({ checked, onSelect, icon, title, text, note }: { checked: boolean; onSelect: () => void; icon: ReactNode; title: string; text: string; note?: string }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      onClick={onSelect}
      className={cn("flex w-full gap-4 border p-5 text-left transition-colors", checked ? "border-foreground bg-card" : "border-input hover:border-foreground/50")}
    >
      <span className={cn("mt-1 flex size-4 shrink-0 items-center justify-center rounded-full border", checked ? "border-foreground" : "border-input")}>
        {checked && <span className="size-2 rounded-full bg-foreground" />}
      </span>
      {icon}
      <span>
        <span className="block font-medium">{title}</span>
        <span className="mt-1 block text-sm leading-relaxed text-muted-foreground">{text}</span>
        {note && checked && <span className="mt-2 block text-xs text-clay">{note}</span>}
      </span>
    </button>
  )
}

function Section({ step, title, children }: { step: string; title: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="mb-6 flex items-baseline gap-3 text-2xl">
        <span className="font-serif text-base text-clay">{step.padStart(2, "0")}</span> {title}
      </h2>
      {children}
    </section>
  )
}

function Field({ id, label, error, className, children }: { id: string; label: string; error?: string; className?: string; children: ReactNode }) {
  return (
    <div className={cn("space-y-2", className)}>
      <Label htmlFor={id} className="font-normal">
        {label}
      </Label>
      {children}
      {error && (
        <p id={`${id}-error`} className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}

function TextInput({
  id,
  value,
  onChange,
  invalid,
  type = "text",
  autoComplete,
  placeholder,
}: {
  id: string
  value: string
  onChange: (v: string) => void
  invalid?: boolean
  type?: string
  autoComplete?: string
  placeholder?: string
}) {
  return (
    <Input
      id={id}
      type={type}
      autoComplete={autoComplete}
      placeholder={placeholder}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-invalid={invalid || undefined}
      aria-describedby={invalid ? `${id}-error` : undefined}
      className="h-12 rounded-none bg-card"
    />
  )
}
