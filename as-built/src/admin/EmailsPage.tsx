import { useMemo, useState } from "react"
import { Mail, MailCheck, RotateCw } from "lucide-react"
import { useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet"
import { MAX_ATTEMPTS, retryEmail, useEmailSettings, useOrderEmails, useOutbox, type OutboxEmail } from "@/lib/emails"
import { EMAIL_KINDS, kindLabel, renderEmail, type EmailKind } from "@emails/templates.ts"
import { sampleData } from "@emails/samples.ts"
import { imageUrl } from "@/lib/images"
import { dateTime } from "@/lib/admin"
import { useTitle } from "@/hooks/use-title"
import { cn } from "@/lib/utils"
import { EmailPreview } from "./EmailPreview"
import { Empty, FilterTabs, PageHeader, SearchInput } from "./ui"

// emailId: a real email (its delivery details stay live while the preview is open); none for template examples.
type Open = { kind: string; data: unknown; to?: string; emailId?: string } | null

export function EmailsPage() {
  useTitle("Emails")
  const [tab, setTab] = useState<"outbox" | "templates">("outbox")
  const [open, setOpen] = useState<Open>(null)
  const { data: emails = [] } = useOutbox()

  return (
    <div className="space-y-8">
      <PageHeader title="Emails" intro="Every email the shop sends to customers, in the shop's own words and look." />

      <div className="flex gap-4 border border-moss/30 bg-moss/5 p-5 text-sm">
        <MailCheck className="mt-0.5 size-5 shrink-0 text-moss" strokeWidth={1.5} />
        <p className="leading-relaxed">
          <span className="font-medium">Emails go out as soon as something happens</span> — an order, a payment, a parcel, a return. In this setup every
          email lands in the test mailbox, not with real people. Emails from before sending was switched on were never sent and are marked “Not sent”.
        </p>
      </div>

      <div>
        <FilterTabs
          options={[
            { key: "outbox" as const, label: "Emails sent" },
            { key: "templates" as const, label: "All templates" },
          ]}
          value={tab}
          onChange={setTab}
        />
        {tab === "outbox" ? <Outbox onOpen={setOpen} /> : <Templates onOpen={setOpen} />}
      </div>

      <PreviewSheet open={open} onClose={() => setOpen(null)} emails={emails} />
    </div>
  )
}

function Outbox({ onOpen }: { onOpen: (o: Open) => void }) {
  const { data: emails = [], isLoading } = useOutbox()
  const [kind, setKind] = useState("all")
  const [search, setSearch] = useState("")

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase()
    return emails.filter(
      (e) =>
        (kind === "all" || e.kind === kind) &&
        (!q || e.to_email.toLowerCase().includes(q) || String(e.data.order_number ?? "").toLowerCase().includes(q) || (e.to_name ?? "").toLowerCase().includes(q)),
    )
  }, [emails, kind, search])

  return (
    <div className="space-y-6 pt-6">
      <div className="flex flex-wrap gap-3">
        <SearchInput value={search} onChange={setSearch} placeholder="Search by email, name or order number" className="w-full max-w-sm" />
        <select value={kind} onChange={(e) => setKind(e.target.value)} className="h-11 border border-input bg-card px-3 text-sm" aria-label="Kind of email">
          <option value="all">All emails</option>
          {EMAIL_KINDS.map((k) => (
            <option key={k.kind} value={k.kind}>
              {k.label}
            </option>
          ))}
        </select>
      </div>
      {isLoading ? (
        <Empty>Loading…</Empty>
      ) : shown.length === 0 ? (
        <Empty>{emails.length === 0 ? "No emails yet — the first one will appear when an order is placed or someone joins the newsletter." : "No emails match."}</Empty>
      ) : (
        <ul className="divide-y border-y">
          {shown.map((e) => (
            <OutboxRow key={e.id} email={e} onOpen={onOpen} />
          ))}
        </ul>
      )}
    </div>
  )
}

export function OutboxRow({ email: e, onOpen, compact }: { email: OutboxEmail; onOpen: (o: Open) => void; compact?: boolean }) {
  const subject = useMemo(() => renderEmail(e.kind, e.data, { imageUrl }).subject, [e])
  const orderNumber = e.data.order_number as string | undefined
  return (
    <li>
      <button
        type="button"
        onClick={() =>
          onOpen({
            kind: e.kind,
            data: e.data,
            to: e.to_name ? `${e.to_name} <${e.to_email}>` : e.to_email,
            emailId: e.id,
          })
        }
        className={cn("grid w-full grid-cols-12 items-center gap-3 px-2 text-left text-sm hover:bg-sand/50", compact ? "py-3" : "py-4")}
      >
        <span className={cn("flex min-w-0 items-center gap-2", compact ? "col-span-5" : "col-span-12 sm:col-span-3")}>
          <Mail className="size-4 shrink-0 text-muted-foreground" strokeWidth={1.5} />
          <span className="truncate font-medium">{kindLabel(e.kind)}</span>
        </span>
        {!compact && (
          <span className="col-span-12 min-w-0 sm:col-span-5">
            <span className="block truncate">{subject}</span>
            <span className="block truncate text-xs text-muted-foreground">
              To {e.to_email}
              {orderNumber && <> · {orderNumber}</>}
            </span>
          </span>
        )}
        <span className={cn("text-xs text-muted-foreground", compact ? "col-span-4" : "col-span-6 sm:col-span-2")}>{dateTime.format(new Date(e.created_at))}</span>
        <span className={cn("text-right", compact ? "col-span-3" : "col-span-6 sm:col-span-2")}>
          <StatusBadge email={e} />
        </span>
      </button>
    </li>
  )
}

function statusOf(e: OutboxEmail) {
  if (e.status === "sent") return { label: "Sent", tone: "bg-moss/15 text-moss" }
  if (e.status === "skipped") return { label: "Not sent", tone: "bg-muted text-muted-foreground" }
  if (e.status === "failed" && e.attempts >= MAX_ATTEMPTS) return { label: "Failed", tone: "bg-destructive/10 text-destructive" }
  if (e.status === "failed") return { label: "Trying again", tone: "bg-clay/10 text-clay" }
  return { label: "Sending", tone: "bg-sand text-foreground/70" }
}

function StatusBadge({ email }: { email: OutboxEmail }) {
  const s = statusOf(email)
  return <span className={cn("inline-block px-2 py-1 text-[0.7rem] font-semibold tracking-[0.1em] whitespace-nowrap uppercase", s.tone)}>{s.label}</span>
}

/** Under the subject in the preview: whether it went out, when, and what went wrong. */
function Delivery({ email: e }: { email: OutboxEmail }) {
  const queryClient = useQueryClient()
  const [busy, setBusy] = useState(false)
  const s = statusOf(e)
  async function retry() {
    setBusy(true)
    const ok = await retryEmail(e.id)
    setBusy(false)
    if (!ok) {
      toast.error("That didn't work — please refresh and try again.")
      return
    }
    toast.success("Sending it again.")
    void queryClient.invalidateQueries({ queryKey: ["admin-emails"] })
  }
  return (
    <div className="space-y-1">
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="inline-block w-16 text-muted-foreground">Status</span>
        <span className={cn("px-2 py-0.5 text-[0.7rem] font-semibold tracking-[0.1em] uppercase", s.tone)}>{s.label}</span>
        <span className="text-muted-foreground">
          {e.status === "sent" && e.sent_at ? `on ${dateTime.format(new Date(e.sent_at))}` : `created ${dateTime.format(new Date(e.created_at))}`}
          {e.attempts > 1 && ` · ${e.attempts} tries`}
        </span>
        {e.status === "failed" && e.kind !== "password_reset" && (
          <Button size="sm" variant="outline" className="ml-auto h-7 rounded-none bg-transparent" disabled={busy} onClick={retry}>
            <RotateCw className="size-3.5" /> Send again
          </Button>
        )}
      </p>
      {e.error && (
        <p className={cn("pl-18 text-xs", e.status === "failed" ? "text-destructive" : "text-muted-foreground")}>
          {e.error}
          {e.status === "failed" && e.attempts < MAX_ATTEMPTS && e.next_attempt_at && ` Next try ${dateTime.format(new Date(e.next_attempt_at))}.`}
        </p>
      )}
      {e.kind === "password_reset" && (
        <p className="pl-18 text-xs text-muted-foreground">The link in this email isn't kept here, so nobody reading it can get into the account.</p>
      )}
    </div>
  )
}

function PreviewSheet({ open, onClose, emails }: { open: Open; onClose: () => void; emails: OutboxEmail[] }) {
  const live = open?.emailId ? emails.find((e) => e.id === open.emailId) : undefined
  return (
    <Sheet open={open !== null} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="flex w-full flex-col gap-0 bg-background p-0 sm:max-w-3xl">
        <SheetTitle className="sr-only">Email</SheetTitle>
        <SheetDescription className="sr-only">How the email looks to the customer.</SheetDescription>
        {open && <EmailPreview kind={open.kind} data={open.data} to={open.to} meta={live && <Delivery email={live} />} />}
      </SheetContent>
    </Sheet>
  )
}

function Templates({ onOpen }: { onOpen: (o: Open) => void }) {
  const { data: settings } = useEmailSettings()
  if (!settings) return <Empty>Loading…</Empty>
  return (
    <div className="pt-6">
      <p className="mb-6 max-w-2xl text-sm text-muted-foreground">Each email shown with example details, so you can read them before any real order exists.</p>
      <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {EMAIL_KINDS.map((k) => {
          const data = sampleData(k.kind as EmailKind, settings.siteUrl, settings.contactEmail, settings.welcomeCode)
          const email = renderEmail(k.kind, data, { imageUrl })
          return (
            <li key={k.kind}>
              <button
                type="button"
                onClick={() => onOpen({ kind: k.kind, data, to: "anna@example.com (example)" })}
                className="block h-full w-full border bg-card p-5 text-left transition-colors hover:border-foreground/40"
              >
                <p className="eyebrow">{k.when}</p>
                <p className="mt-2 font-serif text-xl">{k.label}</p>
                <p className="mt-2 text-sm text-muted-foreground">“{email.subject}”</p>
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

/** The emails that belong to one order, for the order page. */
export function OrderEmails({ orderId }: { orderId: string }) {
  const { data: emails = [], isLoading } = useOrderEmails(orderId)
  const [open, setOpen] = useState<Open>(null)
  return (
    <>
      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : emails.length === 0 ? (
        <p className="text-sm text-muted-foreground">No emails for this order yet.</p>
      ) : (
        <ul className="-mx-2 divide-y">
          {emails.map((e) => (
            <OutboxRow key={e.id} email={e} onOpen={setOpen} compact />
          ))}
        </ul>
      )}
      <PreviewSheet open={open} onClose={() => setOpen(null)} emails={emails} />
    </>
  )
}
