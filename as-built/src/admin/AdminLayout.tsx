import { useEffect } from "react"
import { Link, Navigate, NavLink, Outlet, useLocation } from "react-router-dom"
import { useQuery } from "@tanstack/react-query"
import { ArrowUpRight, BarChart3, Boxes, Inbox, LayoutDashboard, Mail, MessageSquareText, Package, RotateCcw, Shirt, Tag, Users } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Logo } from "@/components/layout/Logo"
import { ThemeSwitch } from "@/components/layout/ThemeSwitch"
import { useAuth } from "@/context/AuthContext"
import { supabase } from "@/lib/supabase"
import { cn } from "@/lib/utils"

export function useWaiting(enabled: boolean) {
  return useQuery({
    queryKey: ["admin-waiting"],
    enabled,
    refetchInterval: 60_000,
    queryFn: async () => {
      const [ship, returns, reviews, messages] = await Promise.all([
        supabase.from("orders").select("id", { count: "exact", head: true }).eq("status", "paid"),
        supabase.from("returns").select("id", { count: "exact", head: true }).eq("status", "requested"),
        supabase.from("reviews").select("id", { count: "exact", head: true }).eq("status", "pending"),
        supabase.from("contact_messages").select("id", { count: "exact", head: true }).neq("status", "answered"),
      ])
      return { toShip: ship.count ?? 0, returns: returns.count ?? 0, reviews: reviews.count ?? 0, messages: messages.count ?? 0 }
    },
  })
}

/** The owner's area: its own quiet header and a side menu. */
export function AdminLayout() {
  const { user, profile, loading, isOwner } = useAuth()
  const { pathname } = useLocation()
  const { data: waiting } = useWaiting(isOwner)

  useEffect(() => {
    window.scrollTo(0, 0)
  }, [pathname])

  if (loading || (user && !profile)) return <div className="min-h-svh bg-background" />
  if (!user) return <Navigate to={`/login?next=${encodeURIComponent(pathname)}`} replace />
  if (!isOwner) {
    return (
      <div className="flex min-h-svh flex-col items-start justify-center gap-6 px-8 md:px-20">
        <Logo />
        <h1 className="text-4xl font-light">This area is for the shop owner.</h1>
        <Button asChild className="h-11 rounded-none px-6">
          <Link to="/">Back to the shop</Link>
        </Button>
      </div>
    )
  }

  const nav = [
    { to: "/admin", label: "Dashboard", icon: LayoutDashboard, end: true },
    { to: "/admin/reports", label: "Reports", icon: BarChart3 },
    { to: "/admin/orders", label: "Orders", icon: Package, badge: waiting?.toShip },
    { to: "/admin/returns", label: "Returns", icon: RotateCcw, badge: waiting?.returns },
    { to: "/admin/messages", label: "Messages", icon: Inbox, badge: waiting?.messages },
    { to: "/admin/reviews", label: "Reviews", icon: MessageSquareText, badge: waiting?.reviews },
    { to: "/admin/products", label: "Products", icon: Shirt },
    { to: "/admin/stock", label: "Stock", icon: Boxes },
    { to: "/admin/discounts", label: "Discounts", icon: Tag },
    { to: "/admin/customers", label: "Customers", icon: Users },
    { to: "/admin/emails", label: "Emails", icon: Mail },
  ]

  return (
    <div className="min-h-svh bg-background">
      <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur">
        <div className="flex h-16 items-center gap-4 px-5 md:px-8">
          <Link to="/admin" className="flex items-center gap-3">
            <Logo />
            <span className="eyebrow border-l pl-3">Admin</span>
          </Link>
          <div className="ml-auto flex items-center gap-4 text-sm">
            <span className="hidden text-muted-foreground sm:inline">{profile?.full_name ?? user.email}</span>
            <Link to="/" className="inline-flex items-center gap-1 py-2.5 underline-offset-4 hover:underline">
              View shop <ArrowUpRight className="size-3.5" />
            </Link>
          </div>
        </div>
        {/* Menu as a strip on small screens */}
        <nav className="flex gap-1 overflow-x-auto border-t px-3 py-2 lg:hidden" aria-label="Admin">
          {nav.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.end}
              className={({ isActive }) =>
                cn("flex min-h-10 shrink-0 items-center gap-2 px-3 text-sm", isActive ? "bg-foreground text-background" : "text-muted-foreground")
              }
            >
              {n.label}
              {!!n.badge && <span className="rounded-full bg-clay px-1.5 text-[0.7rem] text-white">{n.badge}</span>}
            </NavLink>
          ))}
        </nav>
      </header>

      <div className="flex min-h-[calc(100svh-4rem)]">
        <aside className="hidden w-60 shrink-0 border-r bg-linen/60 lg:block">
          <div className="sticky top-16 flex max-h-[calc(100svh-4rem)] flex-col justify-between overflow-y-auto">
          <nav className="flex flex-col gap-0.5 p-4" aria-label="Admin">
            {nav.map((n) => (
              <NavLink
                key={n.to}
                to={n.to}
                end={n.end}
                className={({ isActive }) =>
                  cn(
                    "flex items-center gap-3 px-3 py-2.5 text-sm transition-colors",
                    isActive ? "bg-foreground text-background" : "text-foreground/75 hover:bg-sand hover:text-foreground",
                  )
                }
              >
                <n.icon className="size-4" strokeWidth={1.5} />
                <span className="flex-1">{n.label}</span>
                {!!n.badge && <span className="rounded-full bg-clay px-2 py-0.5 text-[0.7rem] font-semibold text-white">{n.badge}</span>}
              </NavLink>
            ))}
          </nav>
          <div className="p-4">
            <ThemeSwitch />
          </div>
          </div>
        </aside>
        <main className="min-w-0 flex-1 px-5 py-10 md:px-10 lg:py-12">
          <div className="mx-auto max-w-7xl">
            <Outlet />
            <div className="mt-16 border-t pt-6 lg:hidden">
              <ThemeSwitch />
            </div>
          </div>
        </main>
      </div>
    </div>
  )
}
