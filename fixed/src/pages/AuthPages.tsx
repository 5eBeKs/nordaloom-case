import { useEffect, useState, type FormEvent, type ReactNode } from "react"
import { Link, useNavigate, useSearchParams } from "react-router-dom"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { SitePhoto } from "@/components/art/ProductImage"
import { useAuth } from "@/context/AuthContext"
import { supabase } from "@/lib/supabase"
import { DEMO, DEMO_LOGINS, DEMO_ORDERS_NOTE, type DemoLogin } from "@/lib/demo"
import { useTitle } from "@/hooks/use-title"

/** Only allow redirects to paths inside the shop. */
function useNext() {
  const [params] = useSearchParams()
  const next = params.get("next")
  return next && next.startsWith("/") && !next.startsWith("//") ? next : "/account"
}

function useRedirectIfSignedIn(to: string) {
  const { user, loading } = useAuth()
  const navigate = useNavigate()
  useEffect(() => {
    if (!loading && user) navigate(to, { replace: true })
  }, [user, loading, navigate, to])
}

export function LoginPage() {
  useTitle("Sign in")
  const next = useNext()
  useRedirectIfSignedIn(next)
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError("")
    setBusy(true)
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
    setBusy(false)
    if (error) {
      setError(error.message === "Invalid login credentials" ? "That email and password don't match an account." : error.message)
      return
    }
    toast.success("Welcome back.")
  }

  return (
    <AuthShell
      title="Sign in"
      intro="Welcome back. Sign in to see your account and keep your bag on every device."
      footer={
        <>
          New to Nordaloom?{" "}
          <Link to={`/register${next !== "/account" ? `?next=${encodeURIComponent(next)}` : ""}`} className="text-foreground underline underline-offset-4">
            Create an account
          </Link>
        </>
      }
    >
      {DEMO && (
        <DemoSignInNote
          onUse={(l) => {
            setEmail(l.email)
            setPassword(l.password)
          }}
        />
      )}
      <form onSubmit={submit} className="space-y-5">
        <Field id="email" label="Email">
          <Input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="h-12 rounded-none bg-card" />
        </Field>
        <Field
          id="password"
          label="Password"
          hint={
            <Link to={`/forgot-password${email.trim() ? `?email=${encodeURIComponent(email.trim())}` : ""}`} className="-my-2 inline-block py-2 underline underline-offset-4 hover:text-foreground">
              Forgot your password?
            </Link>
          }
        >
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="h-12 rounded-none bg-card"
          />
        </Field>
        <FormError message={error} />
        <Button type="submit" size="lg" disabled={busy} className="h-12 w-full rounded-none">
          {busy ? "Signing in…" : "Sign in"}
        </Button>
      </form>
    </AuthShell>
  )
}

export function RegisterPage() {
  useTitle("Create an account")
  const next = useNext()
  useRedirectIfSignedIn(next)
  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError("")
    if (password.length < 8) {
      setError("Please choose a password of at least 8 characters.")
      return
    }
    setBusy(true)
    const { data, error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: { data: { full_name: name.trim() } },
    })
    setBusy(false)
    if (error) {
      setError(/already registered/i.test(error.message) ? "There's already an account with that email. Try signing in." : error.message)
      return
    }
    if (!data.session) {
      toast.success("Check your inbox to confirm your email, then sign in.")
      return
    }
    toast.success(`Welcome to Nordaloom${name.trim() ? `, ${name.trim().split(" ")[0]}` : ""}.`)
  }

  if (DEMO) {
    return (
      <AuthShell title="Create an account" intro="Sign-ups are closed in this demo shop. Sign in with one of the demo accounts instead." footer={null}>
        <Button asChild size="lg" className="h-12 w-full rounded-none">
          <Link to={`/login${next !== "/account" ? `?next=${encodeURIComponent(next)}` : ""}`}>Sign in with a demo account</Link>
        </Button>
      </AuthShell>
    )
  }

  return (
    <AuthShell
      title="Create an account"
      intro="Keep your bag across devices and be ready for checkout in a moment."
      footer={
        <>
          Already have an account?{" "}
          <Link to={`/login${next !== "/account" ? `?next=${encodeURIComponent(next)}` : ""}`} className="text-foreground underline underline-offset-4">
            Sign in
          </Link>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-5">
        <Field id="name" label="Full name">
          <Input id="name" autoComplete="name" required value={name} onChange={(e) => setName(e.target.value)} className="h-12 rounded-none bg-card" />
        </Field>
        <Field id="email" label="Email">
          <Input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="h-12 rounded-none bg-card" />
        </Field>
        <Field id="password" label="Password" hint="At least 8 characters">
          <Input
            id="password"
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="h-12 rounded-none bg-card"
          />
        </Field>
        <FormError message={error} />
        <Button type="submit" size="lg" disabled={busy} className="h-12 w-full rounded-none">
          {busy ? "Creating your account…" : "Create account"}
        </Button>
      </form>
    </AuthShell>
  )
}

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

export function ForgotPasswordPage() {
  useTitle("Forgot your password?")
  const [params] = useSearchParams()
  const [email, setEmail] = useState(params.get("email") ?? "")
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const [sentTo, setSentTo] = useState<string | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError("")
    const address = email.trim()
    if (!EMAIL_RE.test(address)) {
      setError("Please enter the email address you signed up with.")
      return
    }
    setBusy(true)
    const { error } = await supabase.functions.invoke("password-reset", { body: { email: address } })
    setBusy(false)
    if (error) {
      setError("We couldn't send the email just now. Please try again in a moment.")
      return
    }
    setSentTo(address)
  }

  if (sentTo) {
    return (
      <AuthShell
        title="Check your inbox"
        intro={`If there's a Nordaloom account for ${sentTo}, we've sent it a link to choose a new password. It works once, for an hour.`}
        footer={
          <>
            Nothing arrived after a few minutes? Check your spam folder, or{" "}
            <button type="button" onClick={() => setSentTo(null)} className="text-foreground underline underline-offset-4">
              try again
            </button>
            .
          </>
        }
      >
        <Button asChild size="lg" variant="outline" className="h-12 w-full rounded-none bg-transparent">
          <Link to="/login">Back to sign in</Link>
        </Button>
      </AuthShell>
    )
  }

  return (
    <AuthShell
      title="Forgot your password?"
      intro="Tell us the email you signed up with, and we'll send you a link to choose a new one."
      footer={
        <>
          Remembered it?{" "}
          <Link to="/login" className="text-foreground underline underline-offset-4">
            Sign in
          </Link>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-5" noValidate>
        <Field id="email" label="Email">
          <Input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="h-12 rounded-none bg-card" />
        </Field>
        <FormError message={error} />
        <Button type="submit" size="lg" disabled={busy} className="h-12 w-full rounded-none">
          {busy ? "Sending…" : "Send me a link"}
        </Button>
      </form>
    </AuthShell>
  )
}

export function ResetPasswordPage() {
  useTitle("Choose a new password")
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const tokenHash = params.get("token_hash")
  const [password, setPassword] = useState("")
  const [confirm, setConfirm] = useState("")
  const [error, setError] = useState("")
  const [expired, setExpired] = useState(false)
  const [verified, setVerified] = useState(false)
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError("")
    if (password.length < 8) {
      setError("Please choose a password of at least 8 characters.")
      return
    }
    if (password !== confirm) {
      setError("The two passwords don't match.")
      return
    }
    setBusy(true)
    // The link is only used now, when the new password is chosen, so opening it twice does no harm.
    if (!verified) {
      const { error: verifyError } = await supabase.auth.verifyOtp({ token_hash: tokenHash!, type: "recovery" })
      if (verifyError) {
        setBusy(false)
        setExpired(true)
        return
      }
      setVerified(true)
    }
    const { error: updateError } = await supabase.auth.updateUser({ password })
    setBusy(false)
    if (updateError) {
      setError(/different from the old/i.test(updateError.message) ? "That's your current password — please choose a new one." : "We couldn't save your new password. Please try again.")
      return
    }
    toast.success("Your new password is saved. You're signed in.")
    navigate("/account", { replace: true })
  }

  if (!tokenHash || expired) {
    return (
      <AuthShell
        title="This link has expired"
        intro="Reset links work once, for an hour, and only the newest one you asked for. Ask for a new one and use it from the latest email."
        footer={
          <>
            Remembered your password?{" "}
            <Link to="/login" className="text-foreground underline underline-offset-4">
              Sign in
            </Link>
          </>
        }
      >
        <Button asChild size="lg" className="h-12 w-full rounded-none">
          <Link to="/forgot-password">Send me a new link</Link>
        </Button>
      </AuthShell>
    )
  }

  return (
    <AuthShell
      title="Choose a new password"
      intro="Pick something you haven't used here before. You'll be signed in straight away."
      footer={
        <>
          Changed your mind?{" "}
          <Link to="/login" className="text-foreground underline underline-offset-4">
            Back to sign in
          </Link>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-5" noValidate>
        <Field id="password" label="New password" hint="At least 8 characters">
          <Input id="password" type="password" autoComplete="new-password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} className="h-12 rounded-none bg-card" />
        </Field>
        <Field id="confirm" label="The same again">
          <Input id="confirm" type="password" autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} className="h-12 rounded-none bg-card" />
        </Field>
        <FormError message={error} />
        <Button type="submit" size="lg" disabled={busy} className="h-12 w-full rounded-none">
          {busy ? "Saving…" : "Save new password"}
        </Button>
      </form>
    </AuthShell>
  )
}

function AuthShell({ title, intro, children, footer }: { title: string; intro: string; children: ReactNode; footer: ReactNode }) {
  return (
    <div className="container-shop grid gap-12 pt-14 md:pt-20 lg:grid-cols-2 lg:gap-20">
      <div className="mx-auto w-full max-w-md lg:mx-0 lg:py-10">
        <h1 className="text-5xl font-light">{title}</h1>
        <p className="mt-4 text-muted-foreground">{intro}</p>
        <div className="mt-10">{children}</div>
        <p className="mt-8 text-sm text-muted-foreground">{footer}</p>
      </div>
      <div className="hidden aspect-[4/5] max-h-[640px] overflow-hidden lg:block">
        <SitePhoto path="products/sweater-12.webp" alt="A stack of folded wool sweaters" />
      </div>
    </div>
  )
}

function Field({ id, label, hint, children }: { id: string; label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between">
        <Label htmlFor={id} className="font-normal">
          {label}
        </Label>
        {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
      </div>
      {children}
    </div>
  )
}

/** VITE_DEMO only: the published demo logins, closed sign-ups and Stripe's test card. */
function DemoSignInNote({ onUse }: { onUse: (login: DemoLogin) => void }) {
  return (
    <div className="mb-8 space-y-3 border border-moss/30 bg-moss/5 p-5 text-sm leading-relaxed">
      <p>
        <span className="font-medium">This is a demo shop.</span> Sign-ups are closed; sign in with one of these:
      </p>
      <ul className="space-y-3">
        {DEMO_LOGINS.map((l) => (
          <li key={l.email} className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="font-medium">{l.label}</p>
              <p className="break-all">{l.email}</p>
              <p>
                <span className="text-muted-foreground">Password</span> {l.password}
              </p>
            </div>
            <button type="button" onClick={() => onUse(l)} className="shrink-0 px-1 py-2 underline underline-offset-4">
              Use
            </button>
          </li>
        ))}
      </ul>
      <p>
        Payments are Stripe test mode: card <span className="whitespace-nowrap">4242 4242 4242 4242</span>, any future date, any CVC.
      </p>
      <p>{DEMO_ORDERS_NOTE}</p>
      <p className="text-muted-foreground">Anyone can sign in as the owner and see every order, so please don't enter your real name or address.</p>
    </div>
  )
}

function FormError({ message }: { message: string }) {
  if (!message) return null
  return (
    <p className="text-sm text-destructive" role="alert">
      {message}
    </p>
  )
}
