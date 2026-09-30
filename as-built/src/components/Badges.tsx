import { cn } from "@/lib/utils"
import { STATUS_LABEL, type OrderStatus } from "@/lib/checkout"
import { RETURN_STATUS_LABEL, type ReturnStatus } from "@/lib/account"

const base = "inline-block px-2 py-1 text-[0.7rem] font-semibold tracking-[0.1em] whitespace-nowrap uppercase"

export function StatusBadge({ status }: { status: OrderStatus }) {
  return (
    <span
      className={cn(
        base,
        status === "awaiting_payment" && "bg-clay/15 text-clay",
        status === "paid" && "bg-moss/15 text-moss",
        status === "shipped" && "bg-foreground/10 text-foreground",
        status === "delivered" && "bg-foreground text-background",
        status === "cancelled" && "bg-muted text-muted-foreground line-through",
      )}
    >
      {STATUS_LABEL[status]}
    </span>
  )
}

export function ReturnBadge({ status }: { status: ReturnStatus }) {
  return (
    <span
      className={cn(
        base,
        status === "requested" && "bg-clay/15 text-clay",
        status === "approved" && "bg-moss/15 text-moss",
        status === "refunded" && "bg-foreground/10 text-foreground",
        status === "refused" && "bg-muted text-muted-foreground",
      )}
    >
      {RETURN_STATUS_LABEL[status]}
    </span>
  )
}
