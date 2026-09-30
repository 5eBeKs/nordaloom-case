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
    const { error } = await supabase.from("newsletter_subscribers").insert({ email: value })
    if (error && error.code !== "23505") {
      setStatus("error")
      setMessage("Something went wrong. Please try again in a moment.")
      return
    }
    setStatus("done")
    setMessage(error ? "You're already on the list — thank you." : "Thank you. The next letter is on its way to you.")
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
