import { useEffect, useRef } from "react"
import { Outlet, useLocation } from "react-router-dom"
import { CartSheet } from "@/components/cart/CartSheet"
import { SiteFooter } from "./SiteFooter"
import { SiteHeader } from "./SiteHeader"
import { CookieNotice } from "./CookieNotice"

export function Layout() {
  const { pathname, hash } = useLocation()
  const lastPath = useRef<string | null>(null)
  useEffect(() => {
    const samePage = lastPath.current === pathname
    lastPath.current = pathname
    const target = () => (hash ? document.getElementById(decodeURIComponent(hash.slice(1))) : null)
    if (samePage) {
      // e.g. "4.0 · 3 reviews" → #reviews on the same page
      target()?.scrollIntoView({ behavior: "smooth" })
      return
    }
    window.scrollTo(0, 0)
    if (!hash) return
    // Links like /privacy#browser: wait for the page to draw, then go to the part.
    const t = setTimeout(() => target()?.scrollIntoView(), 300)
    return () => clearTimeout(t)
  }, [pathname, hash])

  return (
    <div className="flex min-h-svh flex-col">
      <div className="bg-foreground py-2 text-center text-[0.72rem] tracking-[0.08em] text-background/85 dark:border-b dark:bg-card dark:text-foreground/75">
        Knitted in small batches in Latvia · All prices include VAT
      </div>
      <SiteHeader />
      <main className="flex-1">
        <Outlet />
      </main>
      <SiteFooter />
      <CartSheet />
      <CookieNotice />
    </div>
  )
}
