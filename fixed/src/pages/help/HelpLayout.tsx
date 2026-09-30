import { useEffect, useRef, type ReactNode } from "react"
import { NavLink, useLocation } from "react-router-dom"
import { cn } from "@/lib/utils"

export const HELP_PAGES = [
  { to: "/shipping", label: "Shipping & delivery" },
  { to: "/returns", label: "Returns" },
  { to: "/size-guide", label: "Size guide" },
  { to: "/faq", label: "Questions & answers" },
  { to: "/contact", label: "Contact us" },
  { to: "/terms", label: "Terms of sale" },
  { to: "/privacy", label: "Privacy" },
]

/** The frame shared by the help and policy pages: heading, a side menu, and the text. */
export function HelpPage({ eyebrow = "Help", title, intro, updated, children }: { eyebrow?: string; title: string; intro?: ReactNode; updated?: string; children: ReactNode }) {
  const menu = useRef<HTMLUListElement>(null)
  const { pathname } = useLocation()
  // On phones the menu is a scrolling strip: bring the current page into view.
  useEffect(() => {
    const ul = menu.current
    const active = ul?.querySelector<HTMLElement>("[aria-current=page]")
    if (ul && active && ul.scrollWidth > ul.clientWidth) ul.scrollLeft = active.offsetLeft - ul.clientWidth / 2 + active.offsetWidth / 2
  }, [pathname])

  return (
    <div className="container-shop pt-14 md:pt-20">
      <p className="eyebrow">{eyebrow}</p>
      <h1 className="mt-4 max-w-3xl text-5xl leading-[1.05] font-light md:text-6xl">{title}</h1>
      {intro && <div className="mt-6 max-w-2xl text-lg leading-relaxed text-muted-foreground">{intro}</div>}
      {updated && <p className="mt-4 text-sm text-muted-foreground">Last updated {updated}</p>}

      <div className="mt-14 grid gap-12 lg:grid-cols-12 lg:gap-16">
        <nav aria-label="Help" className="min-w-0 lg:col-span-3">
          <ul ref={menu} className="relative -mx-4 flex gap-1 overflow-x-auto px-4 lg:mx-0 lg:block lg:space-y-0.5 lg:overflow-visible lg:border-l lg:px-0">
            {HELP_PAGES.map((p) => (
              <li key={p.to} className="shrink-0">
                <NavLink
                  to={p.to}
                  className={({ isActive }) =>
                    cn(
                      "block border px-3 py-2.5 text-sm whitespace-nowrap transition-colors lg:-ml-px lg:border-0 lg:border-l lg:px-4",
                      isActive ? "border-foreground text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
                    )
                  }
                >
                  {p.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
        <div className="min-w-0 lg:col-span-9 xl:col-span-8">{children}</div>
      </div>
    </div>
  )
}

/** A titled part of a help page. */
export function Section({ id, title, children, className }: { id?: string; title: string; children: ReactNode; className?: string }) {
  return (
    <section id={id} className={cn("scroll-mt-28 border-t py-10 first:border-t-0 first:pt-0", className)}>
      <h2 className="text-2xl md:text-3xl">{title}</h2>
      <div className="prose-shop mt-5">{children}</div>
    </section>
  )
}
