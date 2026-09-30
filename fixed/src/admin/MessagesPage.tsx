import { useState } from "react"
import { Link, useSearchParams } from "react-router-dom"
import { useQueryClient } from "@tanstack/react-query"
import { ChevronDown, Mail } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { deleteContactMessage, topicLabel, updateContactMessage, useContactMessages, type ContactMessage } from "@/lib/contact"
import { dateTime } from "@/lib/admin"
import { useTitle } from "@/hooks/use-title"
import { cn } from "@/lib/utils"
import { Empty, FilterTabs, PageHeader, SearchInput } from "./ui"

type Filter = "open" | "answered" | "all"
const FILTERS: { key: Filter; label: string }[] = [
  { key: "open", label: "To answer" },
  { key: "answered", label: "Answered" },
  { key: "all", label: "All" },
]

export function MessagesPage() {
  useTitle("Messages")
  const [params, setParams] = useSearchParams()
  const filter = (FILTERS.some((f) => f.key === params.get("status")) ? params.get("status") : "open") as Filter
  const [search, setSearch] = useState("")
  const { data: messages = [], isLoading } = useContactMessages()

  const matches = (m: ContactMessage, f: Filter) => f === "all" || (f === "answered" ? m.status === "answered" : m.status !== "answered")
  const counts = Object.fromEntries(FILTERS.map((f) => [f.key, messages.filter((m) => matches(m, f.key)).length]))
  const q = search.trim().toLowerCase()
  const shown = messages.filter(
    (m) => matches(m, filter) && (!q || [m.name, m.email, m.order_number ?? "", m.message].some((s) => s.toLowerCase().includes(q))),
  )

  return (
    <div className="space-y-8">
      <PageHeader
        title="Messages"
        intro="Everything sent through the contact form. Reply by email — the button opens your email program with the message quoted — then mark it answered."
      />
      <div>
        <FilterTabs options={FILTERS} value={filter} onChange={(v) => setParams(v === "open" ? {} : { status: v })} counts={counts} />
        <div className="pt-6">
          <SearchInput value={search} onChange={setSearch} placeholder="Search by name, email, order or words" className="w-full max-w-sm" />
        </div>
        {isLoading ? (
          <Empty>Loading messages…</Empty>
        ) : shown.length === 0 ? (
          <Empty>{q ? "No messages match." : filter === "open" ? "Nothing waiting — every message has been answered." : "No messages here yet."}</Empty>
        ) : (
          <ul className="mt-6 divide-y border-y">
            {shown.map((m) => (
              <MessageRow key={m.id} message={m} />
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

function MessageRow({ message: m }: { message: ContactMessage }) {
  const [open, setOpen] = useState(m.status === "new")
  const [note, setNote] = useState(m.owner_note ?? "")
  const [confirmDelete, setConfirmDelete] = useState(false)
  const queryClient = useQueryClient()

  async function change(update: Parameters<typeof updateContactMessage>[1], message?: string) {
    const ok = await updateContactMessage(m.id, update)
    if (!ok) {
      toast.error("That didn't work — please refresh and try again.")
      return
    }
    if (message) toast.success(message)
    for (const key of ["admin-messages", "admin-waiting"]) void queryClient.invalidateQueries({ queryKey: [key] })
  }

  function toggle() {
    const next = !open
    setOpen(next)
    if (next && m.status === "new") void change({ status: "read" })
  }

  async function remove() {
    if (!(await deleteContactMessage(m.id))) {
      toast.error("That didn't work — please refresh and try again.")
      return
    }
    toast("Message deleted.")
    for (const key of ["admin-messages", "admin-waiting"]) void queryClient.invalidateQueries({ queryKey: [key] })
  }

  const subject = `Re: ${m.order_number ? `${m.order_number} — ` : ""}${topicLabel(m.topic)}`
  const quoted = `\n\n\n— On ${dateTime.format(new Date(m.created_at))}, ${m.name} wrote:\n\n${m.message.split("\n").map((l) => `> ${l}`).join("\n")}`
  const mailto = `mailto:${m.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(`Dear ${m.name.split(" ")[0]},${quoted}`)}`

  return (
    <li>
      <button onClick={toggle} className="grid w-full grid-cols-12 items-center gap-3 px-2 py-4 text-left text-sm hover:bg-sand/50" aria-expanded={open}>
        <span className="col-span-12 flex min-w-0 items-center gap-2 sm:col-span-3">
          {m.status === "new" && <span className="size-2 shrink-0 rounded-full bg-clay" aria-label="New" />}
          <span className={cn("truncate", m.status === "new" && "font-semibold")}>{m.name}</span>
        </span>
        <span className="col-span-12 min-w-0 sm:col-span-6">
          <span className="block truncate">
            <span className="text-muted-foreground">{topicLabel(m.topic)}{m.order_number && ` · ${m.order_number}`} — </span>
            {m.message}
          </span>
        </span>
        <span className="col-span-8 text-xs text-muted-foreground sm:col-span-2">{dateTime.format(new Date(m.created_at))}</span>
        <span className="col-span-4 flex items-center justify-end gap-3 sm:col-span-1">
          {m.status === "answered" && <span className="text-[0.7rem] font-semibold tracking-[0.1em] text-moss uppercase">Answered</span>}
          <ChevronDown className={cn("size-4 text-muted-foreground transition-transform", open && "rotate-180")} />
        </span>
      </button>

      {open && (
        <div className="grid gap-8 px-2 pb-8 md:grid-cols-3">
          <div className="md:col-span-2">
            <div className="border bg-card p-5">
              <p className="leading-relaxed whitespace-pre-line">{m.message}</p>
            </div>
            <div className="mt-5 flex flex-wrap gap-2">
              <Button asChild size="sm" className="rounded-none">
                <a href={mailto}>
                  <Mail className="size-4" /> Reply by email
                </a>
              </Button>
              {m.status !== "answered" ? (
                <Button size="sm" variant="outline" className="rounded-none bg-transparent" onClick={() => change({ status: "answered", answered_at: new Date().toISOString() }, "Marked as answered.")}>
                  Mark as answered
                </Button>
              ) : (
                <Button size="sm" variant="outline" className="rounded-none bg-transparent" onClick={() => change({ status: "read", answered_at: null }, "Moved back to “To answer”.")}>
                  Not answered yet
                </Button>
              )}
              {confirmDelete ? (
                <span className="flex items-center gap-2 text-sm">
                  <span className="text-muted-foreground">Delete for good?</span>
                  <Button size="sm" variant="ghost" className="rounded-none text-destructive" onClick={remove}>
                    Delete
                  </Button>
                  <Button size="sm" variant="ghost" className="rounded-none" onClick={() => setConfirmDelete(false)}>
                    Keep
                  </Button>
                </span>
              ) : (
                <Button size="sm" variant="ghost" className="rounded-none text-muted-foreground" onClick={() => setConfirmDelete(true)}>
                  Delete
                </Button>
              )}
            </div>
          </div>
          <div className="space-y-5 text-sm">
            <div>
              <p className="eyebrow">From</p>
              <p className="mt-2 leading-relaxed">
                {m.name}
                <br />
                {m.email}
                {m.user_id && <span className="text-muted-foreground"> · has an account</span>}
              </p>
            </div>
            {m.order_number && (
              <div>
                <p className="eyebrow">Order</p>
                <Link to={`/admin/orders/${m.order_number}`} className="mt-2 inline-block underline underline-offset-4">
                  {m.order_number}
                </Link>
              </div>
            )}
            <div>
              <label htmlFor={`note-${m.id}`} className="eyebrow block">
                Your note (only you see it)
              </label>
              <textarea
                id={`note-${m.id}`}
                rows={3}
                maxLength={2000}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                onBlur={() => note !== (m.owner_note ?? "") && change({ owner_note: note.trim() || null }, "Note saved.")}
                placeholder="e.g. Sent a replacement on Monday"
                className="mt-2 w-full border border-input bg-card p-3 text-sm"
              />
            </div>
            {m.answered_at && <p className="text-muted-foreground">Answered {dateTime.format(new Date(m.answered_at))}</p>}
          </div>
        </div>
      )}
    </li>
  )
}
