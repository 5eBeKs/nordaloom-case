import { useEffect, useState, type FormEvent } from "react"
import { Link, Navigate, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom"
import { useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useAuth } from "@/context/AuthContext"
import { supabase } from "@/lib/supabase"
import { useTitle } from "@/hooks/use-title"
import { cn } from "@/lib/utils"

const TABS = [
  { to: "/account", label: "Orders", end: true },
  { to: "/account/reviews", label: "Reviews", end: false },
  { to: "/wishlist", label: "Wish list", end: false },
  { to: "/account/addresses", label: "Addresses", end: false },
  { to: "/account/details", label: "Your details", end: false },
]

/** Signed-in area: greeting, owner shortcut and the account tabs. */
export function AccountLayout() {
  const { user, profile, loading, isOwner } = useAuth()
  const { pathname } = useLocation()

  if (loading) return <div className="container-shop min-h-[50vh]" />
  if (!user) return <Navigate to={`/login?next=${encodeURIComponent(pathname)}`} replace />

  const firstName = profile?.full_name?.split(" ")[0]

  return (
    <div className="container-shop pt-14 md:pt-20">
      <p className="eyebrow">My account</p>
      <h1 className="mt-4 text-5xl font-light md:text-6xl">{firstName ? `Hello, ${firstName}` : "Hello"}</h1>

      {isOwner && (
        <div className="mt-8 flex max-w-3xl flex-wrap items-center justify-between gap-4 border border-clay/30 bg-clay/5 p-5">
          <p className="text-sm">
            <span className="eyebrow mr-2 text-clay">Shop owner</span> Orders, products, stock and customers.
          </p>
          <Button asChild size="sm" className="rounded-none">
            <Link to="/admin">Open the admin</Link>
          </Button>
        </div>
      )}

      <nav className="mt-10 flex gap-1 overflow-x-auto border-b" aria-label="Account">
        {TABS.map((t) => (
          <NavLink
            key={t.to}
            to={t.to}
            end={t.end}
            className={({ isActive }) => {
              // Return requests live under /account/orders/… and belong to the Orders tab.
              const active = isActive || (t.to === "/account" && pathname.startsWith("/account/orders/"))
              return cn(
                "-mb-px shrink-0 border-b-2 px-4 py-3 text-sm whitespace-nowrap",
                active ? "border-foreground text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
              )
            }}
          >
            {t.label}
          </NavLink>
        ))}
      </nav>

      <div className="pt-10">
        <Outlet />
      </div>
    </div>
  )
}

export function AccountDetailsPage() {
  useTitle("Your details")
  const { user, profile, signOut } = useAuth()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [name, setName] = useState("")
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setName(profile?.full_name ?? "")
  }, [profile?.full_name])

  if (!user) return null

  async function save(e: FormEvent) {
    e.preventDefault()
    setSaving(true)
    const { error } = await supabase.from("profiles").update({ full_name: name.trim() || null }).eq("id", user!.id)
    setSaving(false)
    if (error) {
      toast.error("We couldn't save your details. Please try again.")
      return
    }
    await queryClient.invalidateQueries({ queryKey: ["profile", user!.id] })
    toast.success("Your details are saved.")
  }

  return (
    <div className="grid gap-12 lg:grid-cols-12 lg:gap-16">
      <section className="lg:col-span-7">
        <form onSubmit={save} className="max-w-md space-y-5">
          <div className="space-y-2">
            <Label htmlFor="name" className="font-normal">
              Full name
            </Label>
            <Input id="name" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} className="h-12 rounded-none bg-card" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="email" className="font-normal">
              Email
            </Label>
            <Input id="email" value={user.email ?? ""} disabled className="h-12 rounded-none bg-muted" />
          </div>
          <Button type="submit" disabled={saving || name.trim() === (profile?.full_name ?? "")} className="h-11 rounded-none px-8">
            {saving ? "Saving…" : "Save changes"}
          </Button>
        </form>
      </section>
      <aside className="lg:col-span-5">
        <Button
          variant="outline"
          onClick={() => {
            navigate("/")
            void signOut().then(() => toast("You're signed out."))
          }}
          className="h-11 rounded-none border-foreground/30 bg-transparent px-8"
        >
          Sign out
        </Button>
      </aside>
    </div>
  )
}
