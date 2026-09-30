import { Link } from "react-router-dom"
import { useCategories } from "@/lib/catalogue"
import { useAuth } from "@/context/AuthContext"
import { Logo } from "./Logo"
import { InstallApp } from "./InstallApp"
import { ThemeSwitch } from "./ThemeSwitch"

export function SiteFooter() {
  const { data: categories = [] } = useCategories()
  const { user } = useAuth()

  return (
    <footer className="mt-24 border-t bg-linen">
      <div className="container-shop grid gap-12 py-16 md:grid-cols-12">
        <div className="md:col-span-4">
          <Logo />
          <p className="mt-5 max-w-sm text-sm leading-relaxed text-muted-foreground">
            Wool sweaters, cardigans, hats, scarves, socks and blankets, knitted in small batches in Latvia and made to
            be worn for a very long time.
          </p>
        </div>
        <FooterColumn title="Shop" className="md:col-span-2">
          <FooterLink to="/shop">All knitwear</FooterLink>
          {categories.map((c) => (
            <FooterLink key={c.slug} to={`/shop/${c.slug}`}>
              {c.name}
            </FooterLink>
          ))}
        </FooterColumn>
        <FooterColumn title="Nordaloom" className="md:col-span-2">
          <FooterLink to="/about">Our craft</FooterLink>
          <FooterLink to="/care">Caring for wool</FooterLink>
          <FooterLink to="/contact">Contact us</FooterLink>
        </FooterColumn>
        <FooterColumn title="Help" className="md:col-span-2">
          <FooterLink to="/shipping">Shipping & delivery</FooterLink>
          <FooterLink to="/returns">Returns</FooterLink>
          <FooterLink to="/size-guide">Size guide</FooterLink>
          <FooterLink to="/faq">Questions & answers</FooterLink>
        </FooterColumn>
        <FooterColumn title="Account" className="md:col-span-2">
          {user ? (
            <FooterLink to="/account">My account</FooterLink>
          ) : (
            <>
              <FooterLink to="/login">Sign in</FooterLink>
              <FooterLink to="/register">Create an account</FooterLink>
            </>
          )}
          <FooterLink to="/cart">Your bag</FooterLink>
          <li>
            <InstallApp className="inline-block py-2 text-foreground/80 transition-colors hover:text-foreground sm:py-1" />
          </li>
        </FooterColumn>
      </div>
      <div className="border-t">
        <div className="container-shop flex flex-col gap-4 py-6 text-xs text-muted-foreground lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
            <p>© {new Date().getFullYear()} Nordaloom SIA. Knitted in Latvia.</p>
            <ThemeSwitch />
          </div>
          <p className="flex flex-wrap items-center gap-x-5">
            <span className="w-full py-1 sm:w-auto">All prices in euros and include 21% VAT.</span>
            <Link to="/terms" className="py-2 hover:text-foreground">Terms of sale</Link>
            <Link to="/privacy" className="py-2 hover:text-foreground">Privacy</Link>
          </p>
        </div>
      </div>
    </footer>
  )
}

function FooterColumn({ title, className, children }: { title: string; className?: string; children: React.ReactNode }) {
  return (
    <div className={className}>
      <h2 className="eyebrow font-sans">{title}</h2>
      <ul className="mt-3 space-y-0.5 text-sm sm:mt-4 sm:space-y-1.5">{children}</ul>
    </div>
  )
}

function FooterLink({ to, children }: { to: string; children: React.ReactNode }) {
  return (
    <li>
      <Link to={to} className="inline-block py-2 text-foreground/80 transition-colors hover:text-foreground sm:py-1">
        {children}
      </Link>
    </li>
  )
}
