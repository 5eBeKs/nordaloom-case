import { useState, type FormEvent, type ReactNode } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { EU_COUNTRIES } from "@/lib/checkout"
import type { AddressInput } from "@/lib/account"
import { cn } from "@/lib/utils"

type Errors = Partial<Record<keyof AddressInput, string>>

export const EMPTY_ADDRESS: AddressInput = {
  label: "",
  full_name: "",
  phone: "",
  country: "LV",
  address_line1: "",
  address_line2: "",
  city: "",
  postal_code: "",
}

function validate(a: AddressInput): Errors {
  const e: Errors = {}
  if (a.full_name.trim().length < 2) e.full_name = "Please enter a name."
  if (a.phone.replace(/\D/g, "").length < 6) e.phone = "Please enter a phone number."
  if (!a.address_line1.trim()) e.address_line1 = "Please enter the street address."
  if (!a.city.trim()) e.city = "Please enter the city."
  if (!a.postal_code.trim()) e.postal_code = "Please enter the postal code."
  return e
}

export function AddressForm({
  initial,
  submitLabel,
  showDefault,
  onSubmit,
  onCancel,
}: {
  initial: AddressInput
  submitLabel: string
  showDefault?: boolean
  onSubmit: (a: AddressInput) => Promise<string | null>
  onCancel?: () => void
}) {
  const [a, setA] = useState<AddressInput>(initial)
  const [errors, setErrors] = useState<Errors>({})
  const [formError, setFormError] = useState("")
  const [saving, setSaving] = useState(false)

  const set = (k: keyof AddressInput) => (v: string) => {
    setA((x) => ({ ...x, [k]: v }))
    if (errors[k]) setErrors((e) => ({ ...e, [k]: undefined }))
  }

  async function submit(ev: FormEvent) {
    ev.preventDefault()
    const e = validate(a)
    setErrors(e)
    if (Object.keys(e).length) return
    setSaving(true)
    const err = await onSubmit(a)
    setSaving(false)
    setFormError(err ?? "")
  }

  return (
    <form onSubmit={submit} noValidate className="grid gap-5 sm:grid-cols-6">
      <F id="label" label="Name this address (optional)" className="sm:col-span-6">
        <Input id="label" placeholder="e.g. Home, Work, Mum's" maxLength={40} value={a.label} onChange={(e) => set("label")(e.target.value)} className="h-11 rounded-none bg-card" />
      </F>
      <F id="a-full_name" label="Full name" error={errors.full_name} className="sm:col-span-3">
        <Input id="a-full_name" autoComplete="name" value={a.full_name} onChange={(e) => set("full_name")(e.target.value)} aria-invalid={!!errors.full_name || undefined} className="h-11 rounded-none bg-card" />
      </F>
      <F id="a-phone" label="Phone" error={errors.phone} className="sm:col-span-3">
        <Input id="a-phone" type="tel" autoComplete="tel" value={a.phone} onChange={(e) => set("phone")(e.target.value)} aria-invalid={!!errors.phone || undefined} className="h-11 rounded-none bg-card" />
      </F>
      <F id="a-country" label="Country" className="sm:col-span-6">
        <select
          id="a-country"
          value={a.country}
          onChange={(e) => set("country")(e.target.value)}
          className="h-11 w-full rounded-none border border-input bg-card px-3 text-sm"
        >
          {EU_COUNTRIES.map((c) => (
            <option key={c.code} value={c.code}>
              {c.name}
            </option>
          ))}
        </select>
      </F>
      <F id="a-line1" label="Street address" error={errors.address_line1} className="sm:col-span-6">
        <Input id="a-line1" autoComplete="address-line1" value={a.address_line1} onChange={(e) => set("address_line1")(e.target.value)} aria-invalid={!!errors.address_line1 || undefined} className="h-11 rounded-none bg-card" />
      </F>
      <F id="a-line2" label="Apartment, floor (optional)" className="sm:col-span-6">
        <Input id="a-line2" autoComplete="address-line2" value={a.address_line2} onChange={(e) => set("address_line2")(e.target.value)} className="h-11 rounded-none bg-card" />
      </F>
      <F id="a-city" label="City" error={errors.city} className="sm:col-span-4">
        <Input id="a-city" autoComplete="address-level2" value={a.city} onChange={(e) => set("city")(e.target.value)} aria-invalid={!!errors.city || undefined} className="h-11 rounded-none bg-card" />
      </F>
      <F id="a-postal" label="Postal code" error={errors.postal_code} className="sm:col-span-2">
        <Input id="a-postal" autoComplete="postal-code" value={a.postal_code} onChange={(e) => set("postal_code")(e.target.value)} aria-invalid={!!errors.postal_code || undefined} className="h-11 rounded-none bg-card" />
      </F>
      {showDefault && (
        <label className="flex items-center gap-2 text-sm sm:col-span-6">
          <input type="checkbox" checked={!!a.is_default} onChange={(e) => setA((x) => ({ ...x, is_default: e.target.checked }))} className="accent-foreground" />
          Use as my default address
        </label>
      )}
      {formError && (
        <p className="text-sm text-destructive sm:col-span-6" role="alert">
          {formError}
        </p>
      )}
      <div className="flex gap-3 sm:col-span-6">
        <Button type="submit" disabled={saving} className="h-11 rounded-none px-8">
          {saving ? "Saving…" : submitLabel}
        </Button>
        {onCancel && (
          <Button type="button" variant="ghost" onClick={onCancel} className="h-11 rounded-none">
            Cancel
          </Button>
        )}
      </div>
    </form>
  )
}

function F({ id, label, error, className, children }: { id: string; label: string; error?: string; className?: string; children: ReactNode }) {
  return (
    <div className={cn("space-y-2", className)}>
      <Label htmlFor={id} className="font-normal">
        {label}
      </Label>
      {children}
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  )
}
