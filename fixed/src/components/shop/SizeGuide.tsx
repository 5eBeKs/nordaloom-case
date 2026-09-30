import { useState } from "react"
import { Link } from "react-router-dom"
import { Ruler } from "lucide-react"
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet"
import { HOW_TO_MEASURE, sizeTableFor, type SizeTable } from "@/lib/sizes"
import { cn } from "@/lib/utils"

/** One size table, e.g. for sweaters. `highlight` marks a chosen size. */
export function SizeTableView({ table, highlight, compact }: { table: SizeTable; highlight?: string | null; compact?: boolean }) {
  return (
    <div>
      <div className="-mx-1 overflow-x-auto px-1">
        <table className="w-full min-w-[26rem] border-collapse text-sm">
          <caption className="sr-only">{table.title}: measurements in centimetres</caption>
          <thead>
            <tr className="border-b border-foreground/30 text-left">
              {table.columns.map((c, i) => (
                <th key={c} scope="col" className={cn("py-3 pr-4 font-medium", i > 0 && "text-right")}>
                  {c}
                  {i > 0 && <span className="font-normal text-muted-foreground"> cm</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.rows.map((r) => (
              <tr key={String(r[0])} className={cn("border-b", highlight === r[0] && "bg-sand/70")}>
                {r.map((v, i) =>
                  i === 0 ? (
                    <th key={i} scope="row" className="py-3 pr-4 text-left font-medium">
                      {v}
                    </th>
                  ) : (
                    <td key={i} className="py-3 pr-4 text-right tabular-nums">
                      {v}
                    </td>
                  ),
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {table.note && <p className={cn("mt-3 text-muted-foreground", compact ? "text-xs" : "text-sm")}>{table.note}</p>}
    </div>
  )
}

/** "Size guide" link next to the sizes on a product page; opens the right table in a side panel. */
export function SizeGuideLink({ categorySlug, productName, fitNote, size }: { categorySlug: string; productName: string; fitNote?: string; size?: string | null }) {
  const [open, setOpen] = useState(false)
  const table = sizeTableFor(categorySlug)
  if (!table) return null
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="-my-2 inline-flex items-center gap-1.5 py-2.5 text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground">
        <Ruler className="size-3.5" strokeWidth={1.5} />
        Size guide
      </button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className="w-full overflow-y-auto bg-background p-0 sm:max-w-xl">
          <div className="px-6 py-8 sm:px-8">
            <p className="eyebrow">Size guide</p>
            <SheetTitle className="mt-3 text-3xl font-light">{table.title}</SheetTitle>
            <SheetDescription className="mt-3 text-sm leading-relaxed text-muted-foreground">{table.intro}</SheetDescription>
            {fitNote && (
              <p className="mt-6 border-l-2 border-clay/40 bg-linen/60 px-4 py-3 text-sm">
                <span className="font-medium">{productName}:</span> {fitNote.charAt(0).toLowerCase() + fitNote.slice(1)}
              </p>
            )}
            <div className="mt-8">
              <SizeTableView table={table} highlight={size} compact />
            </div>
            <h3 className="mt-10 text-lg">How to measure</h3>
            <dl className="mt-3 space-y-2 text-sm">
              {HOW_TO_MEASURE.filter((m) => measuresFor(table.key).includes(m.title)).map((m) => (
                <div key={m.title}>
                  <dt className="inline font-medium">{m.title}. </dt>
                  <dd className="inline text-muted-foreground">{m.text}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-8 text-sm text-muted-foreground">
              Still unsure?{" "}
              <Link to="/contact?topic=sizing" className="text-foreground underline underline-offset-4" onClick={() => setOpen(false)}>
                Ask us
              </Link>{" "}
              — we're happy to measure a piece for you. Or see the{" "}
              <Link to="/size-guide" className="text-foreground underline underline-offset-4" onClick={() => setOpen(false)}>
                full size guide
              </Link>
              .
            </p>
          </div>
        </SheetContent>
      </Sheet>
    </>
  )
}

export function measuresFor(key: string) {
  if (key === "hats") return ["Head"]
  if (key === "mittens") return ["Hand"]
  if (key === "socks") return ["Foot"]
  return ["Chest", "Length", "Sleeve"]
}
