import { useEffect, useState, type FormEvent } from "react"
import { Link, useSearchParams } from "react-router-dom"
import { Check } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { DemoDetailsNote } from "@/components/DemoNote"
import { useAuth } from "@/context/AuthContext"
import { useShopSettings } from "@/lib/checkout"
import { CONTACT_TOPICS, sendContactMessage, type ContactTopic } from "@/lib/contact"
import { COMPANY } from "@/lib/company"
import { useTitle } from "@/hooks/use-title"
import { HelpPage } from "./HelpLayout"

const MAX = 5000

export function ContactPage() {
  useTitle("Contact us")
  const [params] = useSearchParams()
  const { user, profile } = useAuth()
  const { data: settings } = useShopSettings()
  const initialTopic = CONTACT_TOPICS.find((t) => t.value === params.get("topic"))?.value ?? "order"

  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [topic, setTopic] = useState<ContactTopic>(initialTopic)
  const [orderNumber, setOrderNumber] = useState(params.get("order") ?? "")
  const [message, setMessage] = useState("")
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)

  // Signed-in customers don't have to type their name and email again.
  useEffect(() => {
    if (user?.email) setEmail((e) => e || user.email!)
    if (profile?.full_name) setName((n) => n || profile.full_name!)
  }, [user?.email, profile?.full_name])

  async function submit(e: FormEvent) {
    e.preventDefault()
    const next: Record<string, string> = {}
    if (!name.trim()) next.name = "Please tell us your name."
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) next.email = "Please enter an email address we can reply to."
    if (!message.trim()) next.message = "Please write your message."
    setErrors(next)
    if (Object.keys(next).length) {
      document.getElementById(Object.keys(next)[0] === "name" ? "contact-name" : Object.keys(next)[0] === "email" ? "contact-email" : "contact-message")?.focus()
      return
    }
    setSending(true)
    setFailure(null)
    const res = await sendContactMessage({ name, email, topic, orderNumber, message })
    setSending(false)
    if (!res.ok) {
      setFailure(
        res.code.includes("too_many")
          ? "You've sent us several messages in the last hour — we'll read them all. Please wait a little before sending another."
          : "Your message didn't go through. Please try again, or write to us by email.",
      )
      return
    }
    setSent(true)
    window.scrollTo({ top: 0, behavior: "smooth" })
  }

  const showOrder = topic === "order" || topic === "returns"
  const contactEmail = settings?.contact_email ?? "owner@nordaloom.example"

  return (
    <HelpPage
      title="Contact us"
      intro={
        <p>
          Questions about an order, a size, or how to look after a piece — we're a small workshop, and your message
          comes straight to us.
        </p>
      }
    >
      <div className="grid gap-12 xl:grid-cols-8">
        <div className="xl:col-span-5">
          {sent ? (
            <div className="border bg-card p-8" role="status">
              <Check className="size-6 text-moss" strokeWidth={1.5} />
              <h2 className="mt-4 text-3xl font-light">Thank you — we have your message.</h2>
              <p className="mt-3 leading-relaxed text-muted-foreground">
                We'll reply to <span className="text-foreground">{email.trim()}</span>, usually within two working days.
              </p>
              <Button
                variant="outline"
                className="mt-8 h-11 rounded-none bg-transparent px-6"
                onClick={() => {
                  setSent(false)
                  setMessage("")
                }}
              >
                Send another message
              </Button>
            </div>
          ) : (
            <form onSubmit={submit} noValidate className="space-y-6">
              <DemoDetailsNote />
              <div className="grid gap-6 sm:grid-cols-2">
                <Field id="contact-name" label="Your name" error={errors.name}>
                  <Input id="contact-name" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} maxLength={200} aria-invalid={!!errors.name} className="h-12 rounded-none bg-card" />
                </Field>
                <Field id="contact-email" label="Email" error={errors.email}>
                  <Input id="contact-email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={320} aria-invalid={!!errors.email} className="h-12 rounded-none bg-card" />
                </Field>
              </div>
              <div className="grid gap-6 sm:grid-cols-2">
                <Field id="contact-topic" label="What it's about">
                  <select id="contact-topic" value={topic} onChange={(e) => setTopic(e.target.value as ContactTopic)} className="h-12 w-full border border-input bg-card px-3 text-sm">
                    {CONTACT_TOPICS.map((t) => (
                      <option key={t.value} value={t.value}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                </Field>
                {showOrder && (
                  <Field id="contact-order" label="Order number" hint="If you have one, e.g. NRD-10001">
                    <Input id="contact-order" value={orderNumber} onChange={(e) => setOrderNumber(e.target.value)} maxLength={40} className="h-12 rounded-none bg-card uppercase placeholder:normal-case" />
                  </Field>
                )}
              </div>
              <Field id="contact-message" label="Your message" error={errors.message}>
                <textarea
                  id="contact-message"
                  rows={8}
                  maxLength={MAX}
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  aria-invalid={!!errors.message}
                  className="w-full border border-input bg-card p-3 text-sm leading-relaxed outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                />
              </Field>
              {failure && (
                <p className="text-sm text-destructive" role="alert">
                  {failure}
                </p>
              )}
              <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
                <Button type="submit" disabled={sending} className="h-12 rounded-none px-10 text-[0.8rem] tracking-[0.12em] uppercase">
                  {sending ? "Sending…" : "Send message"}
                </Button>
                <p className="text-xs text-muted-foreground">
                  We use your details only to answer you. See our <Link to="/privacy" className="underline underline-offset-4">privacy page</Link>.
                </p>
              </div>
            </form>
          )}
        </div>

        <aside className="space-y-8 text-sm xl:col-span-3">
          <div>
            <p className="eyebrow">Email</p>
            <a href={`mailto:${contactEmail}`} className="mt-2 block text-base underline underline-offset-4">
              {contactEmail}
            </a>
          </div>
          <div>
            <p className="eyebrow">The workshop</p>
            <p className="mt-2 leading-relaxed">
              {COMPANY.name}
              {COMPANY.address.map((l) => (
                <span key={l} className="block">
                  {l}
                </span>
              ))}
            </p>
          </div>
          <div>
            <p className="eyebrow">Before you write</p>
            <ul className="mt-2 space-y-1.5">
              <li>
                <Link to="/shipping" className="underline underline-offset-4">Shipping & delivery</Link>
              </li>
              <li>
                <Link to="/returns" className="underline underline-offset-4">Returns</Link>
              </li>
              <li>
                <Link to="/size-guide" className="underline underline-offset-4">Size guide</Link>
              </li>
              <li>
                <Link to="/faq" className="underline underline-offset-4">Questions & answers</Link>
              </li>
            </ul>
          </div>
        </aside>
      </div>
    </HelpPage>
  )
}

function Field({ id, label, hint, error, children }: { id: string; label: string; hint?: string; error?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id} className="font-normal">
        {label}
      </Label>
      {children}
      {error ? (
        <p className="text-xs text-destructive">{error}</p>
      ) : (
        hint && <p className="text-xs text-muted-foreground">{hint}</p>
      )}
    </div>
  )
}
