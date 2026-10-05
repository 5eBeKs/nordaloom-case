import { useState, type FormEvent } from "react"
import { Check } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { supabase } from "@/lib/supabase"

export function Newsletter() {
  const [email, setEmail] = useState("")
  const [status, setStatus] = useState<"idle" | "sending" | "done" | "error">("idle")
  const [message, setMessage] = useState("")

  async function submit(e: FormEvent) {
    e.preventDefault()
    const value = email.trim()
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value)) {
      setStatus("error")
      setMessage("Please enter a valid email address.")
      return
    }
    setStatus("sending")
    // Answers "subscribed" or "already_subscribed"; the shop limits how many new sign-ups it takes at a time.
    const { data, error } = await supabase.rpc("subscribe_newsletter", { p_email: value })
    if (error) {
      setStatus("error")
      // The shop's limit counts the last hour; the one per visitor counts the last day.
      const busy = error.message === "too_many_signups"
      setMessage(
        busy && error.details === "visitor"
          ? "We've had a lot of sign-ups from your connection today. Please try again tomorrow."
          : busy
            ? "We're getting a lot of sign-ups right now. Please try again in an hour."
            : error.message === "invalid_email"
              ? "Please enter a valid email address."
              : "Something went wrong. Please try again in a moment.",
      )
      return
    }
    setStatus("done")
    setMessage(data === "already_subscribed" ? "You're already on the list — thank you." : "Thank you. The next letter is on its way to you.")
    setEmail("")
  }

  return (
    <section className="container-shop">
      <div className="grid items-center gap-10 bg-sand px-6 py-14 sm:px-12 md:grid-cols-2 md:py-20 lg:px-20">
        <div>
          <p className="eyebrow">Newsletter</p>
          <h2 className="mt-4 text-3xl leading-tight md:text-4xl">Letters from the workshop</h2>
          <p className="mt-4 max-w-md text-muted-foreground">
            A few times a season: new pieces, small-batch restocks and notes from Latvia. No noise, and you can leave
            whenever you like.
          </p>
        </div>
        <div>
          {status === "done" ? (
            <p className="flex items-center gap-3 font-serif text-xl" role="status">
              <Check className="size-5 text-moss" /> {message}
            </p>
          ) : (
            <form onSubmit={submit} noValidate>
              <label htmlFor="newsletter-email" className="sr-only">
                Email address
              </label>
              <div className="flex flex-col gap-3 sm:flex-row">
                <Input
                  id="newsletter-email"
                  type="email"
                  autoComplete="email"
                  placeholder="Your email address"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value)
                    if (status === "error") setStatus("idle")
                  }}
                  aria-invalid={status === "error"}
                  aria-describedby="newsletter-message"
                  className="h-12 flex-1 rounded-none border-foreground/25 bg-background px-4 shadow-none"
                />
                <Button type="submit" size="lg" disabled={status === "sending"} className="h-12 rounded-none px-8">
                  {status === "sending" ? "Subscribing…" : "Subscribe"}
                </Button>
              </div>
              <p id="newsletter-message" className="mt-3 min-h-5 text-sm text-destructive" role="alert">
                {status === "error" ? message : ""}
              </p>
            </form>
          )}
        </div>
      </div>
    </section>
  )
}
