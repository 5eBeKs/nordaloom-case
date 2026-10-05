import { useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom"
import { useQueryClient } from "@tanstack/react-query"
import { ArrowLeft, ArrowRight, ImagePlus, Plus, Star, Trash2, X } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ProductImage } from "@/components/art/ProductImage"
import { imageUrl } from "@/lib/images"
import { saveProduct, slugify, uploadProductPhoto, useAdminProduct, type AdminProduct, type ProductInput } from "@/lib/admin"
import { useCategories } from "@/lib/catalogue"
import { DEMO, DEMO_CATALOGUE_OFF, DEMO_OFF } from "@/lib/demo"
import { formatPrice } from "@/lib/format"
import { useTitle } from "@/hooks/use-title"
import { cn } from "@/lib/utils"
import { Empty, Panel, Toggle } from "./ui"

type ColourRow = { key: string; name: string; hex: string; original?: string }
type SizeRow = { key: string; label: string; price: string; original?: string }

type Form = {
  name: string
  category_slug: string
  price: string
  short_description: string
  description: string
  materials: string
  care: string
  details: string
  images: string[]
  is_featured: boolean
  is_new: boolean
  is_published: boolean
  colours: ColourRow[]
  sizes: SizeRow[]
}

const SIZE_PRESETS: { label: string; sizes: string[] }[] = [
  { label: "XS – XL", sizes: ["XS", "S", "M", "L", "XL"] },
  { label: "One size", sizes: ["One size"] },
  { label: "Socks", sizes: ["36–38", "39–41", "42–44", "45–47"] },
  { label: "Mittens", sizes: ["S/M", "M/L"] },
]

const ERRORS: Record<string, string> = {
  invalid_name: "Please give the product a name (2–120 characters).",
  invalid_category: "Please choose a category.",
  invalid_price: "Please enter a price above €0.",
  need_colour_and_size: "Add at least one colour and one size.",
  invalid_colours: "Each colour needs a name, and two colours can't share a name.",
  invalid_sizes: "Each size needs a label, sizes must be different, and size prices must be above €0.",
  invalid_slug: "The name needs at least one letter or number.",
}

let keySeq = 0
const newKey = () => `k${++keySeq}`
const euros = (cents: number | null | undefined) => (cents == null ? "" : (cents / 100).toFixed(2).replace(/\.00$/, ""))
const toCents = (v: string) => {
  const n = parseFloat(v.replace(",", ".").replace(/[^\d.]/g, ""))
  return Number.isFinite(n) ? Math.round(n * 100) : NaN
}

function fromProduct(p: AdminProduct): Form {
  const sizePrice = (size: string) => p.product_variants.find((v) => v.size === size && v.price_cents != null)?.price_cents ?? null
  return {
    name: p.name,
    category_slug: p.category_slug,
    price: euros(p.price_cents),
    short_description: p.short_description,
    description: p.description,
    materials: p.materials,
    care: p.care.join("\n"),
    details: p.details.join("\n"),
    images: p.images,
    is_featured: p.is_featured,
    is_new: p.is_new,
    is_published: p.is_published,
    colours: p.colours.map((c) => ({ key: newKey(), name: c.name, hex: c.hex, original: c.name })),
    sizes: p.sizes.map((s) => ({ key: newKey(), label: s, price: euros(sizePrice(s)), original: s })),
  }
}

const emptyForm = (category: string): Form => ({
  name: "",
  category_slug: category,
  price: "",
  short_description: "",
  description: "",
  materials: "",
  care: "",
  details: "Knitted in small batches in Latvia",
  images: [],
  is_featured: false,
  is_new: true,
  is_published: false,
  colours: [{ key: newKey(), name: "", hex: "#d9ccb4" }],
  sizes: [],
})

export function ProductEditorPage() {
  const { id } = useParams()
  const isNew = !id
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { data: product, isLoading } = useAdminProduct(id)
  const { data: categories = [] } = useCategories()

  const [form, setForm] = useState<Form | null>(null)
  const [initial, setInitial] = useState("")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const [uploading, setUploading] = useState(0)
  const fileInput = useRef<HTMLInputElement>(null)

  useTitle(isNew ? "New product" : product?.name ?? "Product")

  // Load the form once the product (or the categories, for a new one) arrive.
  const loadedKey = isNew ? "new" : product ? `${product.id}-${product.updated_at}` : null
  useEffect(() => {
    if (!loadedKey) return
    if (isNew && categories.length === 0) return
    const f = isNew ? emptyForm(params.get("category") ?? categories[0]?.slug ?? "") : fromProduct(product!)
    setForm(f)
    setInitial(JSON.stringify(f))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadedKey, categories.length])

  const dirty = form !== null && JSON.stringify(form) !== initial
  useEffect(() => {
    if (!dirty) return
    const warn = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener("beforeunload", warn)
    return () => window.removeEventListener("beforeunload", warn)
  }, [dirty])

  // Stock that a save would remove (colours or sizes taken out).
  const removedStock = useMemo(() => {
    if (!form || !product) return []
    const keptColours = new Set(form.colours.map((c) => c.original).filter(Boolean))
    const keptSizes = new Set(form.sizes.map((s) => s.original).filter(Boolean))
    return product.product_variants.filter((v) => v.stock > 0 && (!keptColours.has(v.colour) || !keptSizes.has(v.size)))
  }, [form, product])

  if (!isNew && isLoading) return <Empty>Loading…</Empty>
  if (!isNew && !product) return <Empty>This product doesn't exist.</Empty>
  if (!form) return <Empty>Loading…</Empty>

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => (f ? { ...f, [k]: v } : f))
  const slugForPhotos = product?.slug ?? slugify(form.name)

  async function addPhotos(files: FileList | null) {
    if (!files?.length) return
    const list = [...files].filter((f) => f.type.startsWith("image/"))
    setUploading((n) => n + list.length)
    for (const file of list) {
      try {
        const path = await uploadProductPhoto(file, slugForPhotos)
        setForm((f) => (f ? { ...f, images: [...f.images, path] } : f))
      } catch {
        toast.error(`Couldn't upload ${file.name}.`)
      } finally {
        setUploading((n) => n - 1)
      }
    }
  }

  function movePhoto(i: number, dir: -1 | 1) {
    const imgs = [...form!.images]
    const j = i + dir
    if (j < 0 || j >= imgs.length) return
    ;[imgs[i], imgs[j]] = [imgs[j], imgs[i]]
    set("images", imgs)
  }

  function addPreset(sizes: string[]) {
    const have = new Set(form!.sizes.map((s) => s.label.trim().toLowerCase()))
    set("sizes", [...form!.sizes, ...sizes.filter((s) => !have.has(s.toLowerCase())).map((s) => ({ key: newKey(), label: s, price: "" }))])
  }

  async function save() {
    setError("")
    const f = form!
    const price = toCents(f.price)
    if (!f.name.trim()) return setError(ERRORS.invalid_name)
    if (!(price > 0)) return setError(ERRORS.invalid_price)
    if (f.colours.length === 0 || f.sizes.length === 0) return setError(ERRORS.need_colour_and_size)
    const badSizePrice = f.sizes.some((s) => s.price.trim() && !(toCents(s.price) > 0))
    if (badSizePrice) return setError(ERRORS.invalid_sizes)
    if (removedStock.length > 0) {
      const list = removedStock.map((v) => `${v.colour} · ${v.size}: ${v.stock}`).join("\n")
      if (!window.confirm(`These combinations still have stock and will be removed:\n\n${list}\n\nSave anyway?`)) return
    }

    const input: ProductInput = {
      id: product?.id,
      name: f.name.trim(),
      slug: isNew ? slugify(f.name) : undefined,
      category_slug: f.category_slug,
      short_description: f.short_description,
      description: f.description,
      materials: f.materials,
      care: f.care.split("\n"),
      details: f.details.split("\n"),
      price_cents: price,
      images: f.images,
      is_featured: f.is_featured,
      is_new: f.is_new,
      is_published: f.is_published,
      colours: f.colours.map((c) => ({ name: c.name.trim(), hex: c.hex, previous_name: c.original })),
      sizes: f.sizes.map((s) => ({ label: s.label.trim(), previous_label: s.original, price_cents: s.price.trim() ? toCents(s.price) : null })),
    }

    setSaving(true)
    const result = await saveProduct(input)
    setSaving(false)
    if (!result.ok) {
      setError(result.code === DEMO_OFF ? DEMO_CATALOGUE_OFF : (ERRORS[result.code] ?? "Something went wrong saving. Please try again."))
      return
    }
    for (const key of ["admin-products", "admin-product", "products", "product", "admin-dashboard"]) void queryClient.invalidateQueries({ queryKey: [key] })
    setInitial(JSON.stringify(form))
    if (isNew) {
      toast.success("Product created. Add stock numbers on the Stock page when you're ready.")
      navigate(`/admin/products/${result.id}`, { replace: true })
    } else {
      toast.success("Saved.")
    }
  }

  const previewProduct = {
    slug: product?.slug ?? (slugify(form.name) || "new"),
    category_slug: form.category_slug,
    name: form.name || "New product",
    images: form.images,
    colours: form.colours.filter((c) => c.name).map((c) => ({ name: c.name, hex: c.hex })),
  }
  const stockTotal = product?.product_variants.reduce((n, v) => n + v.stock, 0) ?? 0

  return (
    <div className="space-y-8">
      <Link to="/admin/products" className="-my-2 inline-flex items-center gap-1 py-2.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Products
      </Link>
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">{isNew ? "New product" : categories.find((c) => c.slug === form.category_slug)?.name}</p>
          <h1 className="mt-3 text-4xl font-light md:text-5xl">{form.name || (isNew ? "A new piece" : "Untitled")}</h1>
        </div>
        {product && product.is_published && (
          <Link to={`/product/${product.slug}`} className="text-sm underline underline-offset-4">
            View in the shop
          </Link>
        )}
      </header>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="min-w-0 space-y-6 lg:col-span-2">
          <Panel title="The basics">
            <div className="grid gap-5 sm:grid-cols-6">
              <Field label="Name" className="sm:col-span-4">
                <Input value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="e.g. Kāpa Crewneck" className="h-11 rounded-none bg-background" />
              </Field>
              <Field label="Price (€, incl. VAT)" className="sm:col-span-2">
                <Input value={form.price} onChange={(e) => set("price", e.target.value)} inputMode="decimal" placeholder="159" className="h-11 rounded-none bg-background" />
              </Field>
              <Field label="Category" className="sm:col-span-2">
                <select value={form.category_slug} onChange={(e) => set("category_slug", e.target.value)} className="h-11 w-full border border-input bg-background px-3 text-sm">
                  {categories.map((c) => (
                    <option key={c.slug} value={c.slug}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="One-line description" hint="Shown under the name in the shop" className="sm:col-span-4">
                <Input value={form.short_description} onChange={(e) => set("short_description", e.target.value)} placeholder="Our everyday raglan crewneck" className="h-11 rounded-none bg-background" />
              </Field>
            </div>
          </Panel>

          <Panel
            title="Photos"
            action={
              <span className="text-xs text-muted-foreground">
                {form.images.length === 0 ? "Without a photo the shop shows a drawing" : "The first photo is the main one"}
              </span>
            }
          >
            <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5">
              {form.images.map((img, i) => (
                <div key={img} className="group relative aspect-[4/5] overflow-hidden bg-muted">
                  <img src={imageUrl(img)} alt="" className="h-full w-full object-cover" />
                  {i === 0 && (
                    <span className="absolute top-1.5 left-1.5 flex items-center gap-1 bg-background/90 px-1.5 py-0.5 text-[0.7rem] font-semibold">
                      <Star className="size-3" /> Main
                    </span>
                  )}
                  <div className="absolute inset-x-0 bottom-0 flex justify-between bg-background/90 p-1 opacity-100 sm:opacity-0 sm:group-hover:opacity-100">
                    <IconBtn label="Move left" disabled={i === 0} onClick={() => movePhoto(i, -1)}>
                      <ArrowLeft className="size-3.5" />
                    </IconBtn>
                    <IconBtn label="Remove photo" onClick={() => set("images", form.images.filter((x) => x !== img))}>
                      <Trash2 className="size-3.5" />
                    </IconBtn>
                    <IconBtn label="Move right" disabled={i === form.images.length - 1} onClick={() => movePhoto(i, 1)}>
                      <ArrowRight className="size-3.5" />
                    </IconBtn>
                  </div>
                </div>
              ))}
              {Array.from({ length: uploading }, (_, i) => (
                <div key={`up-${i}`} className="flex aspect-[4/5] animate-pulse items-center justify-center bg-muted text-xs text-muted-foreground">
                  Uploading…
                </div>
              ))}
              <button
                type="button"
                onClick={() => (DEMO ? toast.info("Photo uploads are off in the demo.") : fileInput.current?.click())}
                className="flex aspect-[4/5] flex-col items-center justify-center gap-2 border border-dashed border-input text-sm text-muted-foreground transition-colors hover:border-foreground hover:text-foreground"
              >
                <ImagePlus className="size-5" strokeWidth={1.5} />
                Add photos
              </button>
              <input
                ref={fileInput}
                type="file"
                accept="image/*"
                multiple
                hidden
                onChange={(e) => {
                  void addPhotos(e.target.files)
                  e.target.value = ""
                }}
              />
            </div>
          </Panel>

          <Panel title="Colours">
            <ul className="space-y-2">
              {form.colours.map((c, i) => (
                <li key={c.key} className="flex items-center gap-3">
                  <label className="relative size-10 shrink-0 cursor-pointer overflow-hidden rounded-full ring-1 ring-black/10" style={{ background: c.hex }}>
                    <span className="sr-only">Colour of {c.name || "this colour"}</span>
                    <input
                      type="color"
                      value={c.hex}
                      onChange={(e) => set("colours", form.colours.map((x, j) => (j === i ? { ...x, hex: e.target.value } : x)))}
                      className="absolute inset-0 cursor-pointer opacity-0"
                    />
                  </label>
                  <Input
                    value={c.name}
                    onChange={(e) => set("colours", form.colours.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
                    placeholder="Colour name, e.g. Oat"
                    className="h-10 max-w-xs rounded-none bg-background"
                  />
                  {c.original && c.original !== c.name.trim() && <span className="text-xs text-muted-foreground">was {c.original}</span>}
                  <IconBtn label={`Remove ${c.name || "colour"}`} onClick={() => set("colours", form.colours.filter((_, j) => j !== i))}>
                    <X className="size-4" />
                  </IconBtn>
                </li>
              ))}
            </ul>
            <button
              type="button"
              onClick={() => set("colours", [...form.colours, { key: newKey(), name: "", hex: "#b9b8b0" }])}
              className="mt-3 inline-flex items-center gap-1 py-2 text-sm underline underline-offset-4"
            >
              <Plus className="size-4" /> Add a colour
            </button>
            <p className="mt-2 text-xs text-muted-foreground">Renaming a colour keeps its stock. Two-tone colourways work too, e.g. “Ecru / Night Blue”.</p>
          </Panel>

          <Panel
            title="Sizes"
            action={
              <div className="flex flex-wrap justify-end gap-1">
                {SIZE_PRESETS.map((p) => (
                  <button key={p.label} type="button" onClick={() => addPreset(p.sizes)} className="border px-3 py-2 text-xs text-muted-foreground hover:border-foreground hover:text-foreground">
                    + {p.label}
                  </button>
                ))}
              </div>
            }
          >
            {form.sizes.length === 0 ? (
              <p className="text-sm text-muted-foreground">No sizes yet — use the buttons above, or add your own.</p>
            ) : (
              <ul className="space-y-2">
                {form.sizes.map((s, i) => (
                  <li key={s.key} className="flex items-center gap-3">
                    <Input
                      value={s.label}
                      onChange={(e) => set("sizes", form.sizes.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))}
                      placeholder="Size"
                      className="h-10 w-48 rounded-none bg-background"
                    />
                    <Input
                      value={s.price}
                      onChange={(e) => set("sizes", form.sizes.map((x, j) => (j === i ? { ...x, price: e.target.value } : x)))}
                      inputMode="decimal"
                      placeholder={form.price ? `€${form.price}` : "Same price"}
                      aria-label={`Price for ${s.label}`}
                      className="h-10 w-32 rounded-none bg-background"
                    />
                    <IconBtn label="Move up" disabled={i === 0} onClick={() => set("sizes", swap(form.sizes, i, i - 1))}>
                      <ArrowLeft className="size-3.5 rotate-90" />
                    </IconBtn>
                    <IconBtn label={`Remove ${s.label || "size"}`} onClick={() => set("sizes", form.sizes.filter((_, j) => j !== i))}>
                      <X className="size-4" />
                    </IconBtn>
                  </li>
                ))}
              </ul>
            )}
            <button
              type="button"
              onClick={() => set("sizes", [...form.sizes, { key: newKey(), label: "", price: "" }])}
              className="mt-4 inline-flex items-center gap-1 text-sm underline underline-offset-4"
            >
              <Plus className="size-4" /> Add a size
            </button>
            <p className="mt-2 text-xs text-muted-foreground">Leave a size's price empty to use the main price. A different price suits a larger blanket.</p>
          </Panel>

          <Panel title="Description, materials and care">
            <div className="space-y-5">
              <Field label="Description" hint="Leave an empty line between paragraphs">
                <Textarea rows={6} value={form.description} onChange={(v) => set("description", v)} />
              </Field>
              <Field label="Materials">
                <Input value={form.materials} onChange={(e) => set("materials", e.target.value)} placeholder="100% lambswool" className="h-11 rounded-none bg-background" />
              </Field>
              <div className="grid gap-5 sm:grid-cols-2">
                <Field label="Care" hint="One instruction per line">
                  <Textarea rows={5} value={form.care} onChange={(v) => set("care", v)} placeholder={"Hand wash cold (max 30 °C)\nDry flat"} />
                </Field>
                <Field label="Fit & details" hint="One per line">
                  <Textarea rows={5} value={form.details} onChange={(v) => set("details", v)} placeholder={"Regular fit\nMid-weight"} />
                </Field>
              </div>
            </div>
          </Panel>
        </div>

        {/* Right column: visibility, preview, save */}
        <div className="space-y-6 lg:sticky lg:top-24 lg:self-start">
          <Panel>
            <div className="space-y-4">
              <SwitchRow label="Show in the shop" hint={form.is_published ? "Customers can see and buy it" : "Hidden from customers"} checked={form.is_published} onChange={(v) => set("is_published", v)} />
              <SwitchRow label="Feature on the home page" checked={form.is_featured} onChange={(v) => set("is_featured", v)} />
              <SwitchRow label="Mark as new" checked={form.is_new} onChange={(v) => set("is_new", v)} />
            </div>
            {error && (
              <p className="mt-5 text-sm text-destructive" role="alert">
                {error}
              </p>
            )}
            <Button onClick={save} disabled={saving || uploading > 0 || (!dirty && !isNew)} className="mt-6 h-12 w-full rounded-none text-[0.8rem] tracking-[0.12em] uppercase">
              {saving ? "Saving…" : uploading > 0 ? "Uploading photos…" : isNew ? "Create product" : dirty ? "Save changes" : "Saved"}
            </Button>
            {!isNew && (
              <p className="mt-3 text-center text-xs text-muted-foreground">
                {stockTotal} in stock ·{" "}
                <Link to={`/admin/stock?product=${product!.id}`} className="underline underline-offset-4">
                  Edit stock
                </Link>
              </p>
            )}
          </Panel>

          <div>
            <p className="eyebrow mb-3">Preview</p>
            <div className="aspect-[4/5] overflow-hidden bg-muted">
              <ProductImage key={form.images[0] ?? "art"} product={previewProduct} />
            </div>
            <div className="mt-3 flex justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate font-medium">{previewProduct.name}</p>
                <p className="truncate text-sm text-muted-foreground">{form.short_description}</p>
              </div>
              <p className="shrink-0">{toCents(form.price) > 0 ? formatPrice(toCents(form.price)) : "—"}</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function swap<T>(list: T[], i: number, j: number) {
  if (j < 0 || j >= list.length) return list
  const next = [...list]
  ;[next[i], next[j]] = [next[j], next[i]]
  return next
}

function Field({ label, hint, className, children }: { label: string; hint?: string; className?: string; children: ReactNode }) {
  return (
    <label className={cn("block space-y-2", className)}>
      <span className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-sm">
        {label}
        {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
      </span>
      {children}
    </label>
  )
}

function Textarea({ value, onChange, rows, placeholder }: { value: string; onChange: (v: string) => void; rows: number; placeholder?: string }) {
  return (
    <textarea
      rows={rows}
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      className="w-full border border-input bg-background p-3 text-sm leading-relaxed outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
    />
  )
}

function SwitchRow({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-sm">
        {label}
        {hint && <span className="block text-xs text-muted-foreground">{hint}</span>}
      </span>
      <Toggle checked={checked} onChange={onChange} label={label} />
    </div>
  )
}

function IconBtn({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: ReactNode }) {
  return (
    <button type="button" aria-label={label} title={label} onClick={onClick} disabled={disabled} className="flex size-10 items-center justify-center text-muted-foreground hover:text-foreground disabled:opacity-30">
      {children}
    </button>
  )
}
