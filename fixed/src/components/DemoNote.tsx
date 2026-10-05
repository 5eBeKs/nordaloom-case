import { DEMO, DEMO_DETAILS_NOTE, DEMO_ORDERS_NOTE } from "@/lib/demo"
import { cn } from "@/lib/utils"

/** VITE_DEMO only: above the forms that take personal details (checkout, contact). Renders nothing in the shop. */
export function DemoDetailsNote({ className, orders = false }: { className?: string; orders?: boolean }) {
  if (!DEMO) return null
  return (
    <p role="note" className={cn("border border-moss/30 bg-moss/5 p-4 text-sm leading-relaxed", className)}>
      {DEMO_DETAILS_NOTE}
      {orders && ` ${DEMO_ORDERS_NOTE}`}
    </p>
  )
}
