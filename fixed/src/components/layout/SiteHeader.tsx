import { useEffect, useState } from "react"
import { Link, NavLink } from "react-router-dom"
import { Heart, Menu, Search, ShoppingBag, User } from "lucide-react"
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet"
import { useCart } from "@/context/CartContext"
import { useAuth } from "@/context/AuthContext"
import { useWishlist } from "@/context/WishlistContext"
import { useCategories } from "@/lib/catalogue"
import { cn } from "@/lib/utils"
import { Logo } from "./Logo"
import { SearchPanel } from "@/components/shop/SearchPanel"
import { InstallApp } from "./InstallApp"

export function SiteHeader() {
  const { count, setOpen } = useCart()
  const { user, isOwner } = useAuth()
  const { count: saved } = useWishlist()
  const { data: categories = [] } = useCategories()
  const [menuOpen, setMenuOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)

  // "/" opens search from anywhere (unless you're typing in a field).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (e.key === "/" && !["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName) && !t.isContentEditable) {
        e.preventDefault()
        setSearchOpen(true)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  const navClass = ({ isActive }: { isActive: boolean }) =>
    cn(
      "relative py-2 text-[0.8rem] tracking-wide text-foreground/75 transition-colors hover:text-foreground",
      isActive && "text-foreground after:absolute after:inset-x-0 after:-bottom-0.5 after:h-px after:bg-foreground",
    )

  return (
    <header className="sticky top-0 z-40 border-b border-border/70 bg-background/90 backdrop-blur-md">
      <div className="container-shop flex h-16 items-center gap-6 md:h-20">
        <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
          <SheetTrigger asChild>
            <button className="-ml-3 flex size-11 items-center justify-center xl:hidden" aria-label="Open menu">
              <Menu className="size-5" strokeWidth={1.5} />
            </button>
          </SheetTrigger>
          <SheetContent side="left" className="w-80 bg-background">
            <SheetHeader className="border-b px-6 py-5">
              <SheetTitle asChild>
                <div>
                  <Logo />
                </div>
              </SheetTitle>
            </SheetHeader>
            <nav className="flex flex-col px-6 pb-8">
              <Link to="/shop" onClick={() => setMenuOpen(false)} className="py-3 font-serif text-2xl">
                Shop all
              </Link>
              {categories.map((c) => (
                <Link key={c.slug} to={`/shop/${c.slug}`} onClick={() => setMenuOpen(false)} className="py-3 font-serif text-2xl">
                  {c.name}
                </Link>
              ))}
              <div className="my-4 h-px bg-border" />
              <Link to="/about" onClick={() => setMenuOpen(false)} className="py-2 text-sm">
                Our craft
              </Link>
              <Link to="/care" onClick={() => setMenuOpen(false)} className="py-2 text-sm">
                Caring for wool
              </Link>
              <Link to="/wishlist" onClick={() => setMenuOpen(false)} className="py-2 text-sm">
                Wish list{saved > 0 && <span className="text-muted-foreground"> · {saved}</span>}
              </Link>
              <Link to={user ? "/account" : "/login"} onClick={() => setMenuOpen(false)} className="py-2 text-sm">
                {user ? "My account" : "Sign in"}
              </Link>
              <InstallApp className="py-2 text-left text-sm" onDone={() => setMenuOpen(false)} />
            </nav>
          </SheetContent>
        </Sheet>

        {/* On small screens search sits next to the menu, leaving room for the logo */}
        <button type="button" onClick={() => setSearchOpen(true)} className="-ml-3 flex size-11 items-center justify-center xl:hidden" aria-label="Search">
          <Search className="size-5" strokeWidth={1.5} />
        </button>

        <Link to="/" className="shrink-0 max-xl:absolute max-xl:left-1/2 max-xl:-translate-x-1/2" aria-label="Nordaloom home">
          <Logo />
        </Link>

        <nav className="ml-8 hidden items-center gap-6 xl:flex" aria-label="Main">
          <NavLink to="/shop" end className={navClass}>
            Shop all
          </NavLink>
          {categories.map((c) => (
            <NavLink key={c.slug} to={`/shop/${c.slug}`} className={navClass}>
              {c.name}
            </NavLink>
          ))}
          <span className="h-4 w-px bg-border" aria-hidden />
          <NavLink to="/about" className={navClass}>
            Our craft
          </NavLink>
        </nav>

        <div className="ml-auto flex items-center gap-1">
          {isOwner && (
            <Link to="/admin" className="mr-2 hidden border border-foreground/20 px-2.5 py-1 text-xs tracking-wide hover:border-foreground sm:inline-block">
              Admin
            </Link>
          )}
          <button
            type="button"
            onClick={() => setSearchOpen(true)}
            className="hidden size-11 items-center justify-center text-foreground/80 transition-colors hover:text-foreground xl:flex"
            aria-label="Search"
            title="Search ( / )"
          >
            <Search className="size-5" strokeWidth={1.5} />
          </button>
          <Link
            to="/wishlist"
            className="relative flex size-11 items-center justify-center text-foreground/80 transition-colors hover:text-foreground"
            aria-label={`Wish list, ${saved} ${saved === 1 ? "piece" : "pieces"}`}
          >
            <Heart className="size-5" strokeWidth={1.5} />
            {saved > 0 && <span className="absolute top-2.5 right-2.5 size-2 rounded-full bg-clay" aria-hidden />}
          </Link>
          <Link
            to={user ? "/account" : "/login"}
            className="hidden size-11 items-center justify-center text-foreground/80 transition-colors hover:text-foreground sm:flex"
            aria-label={user ? "My account" : "Sign in"}
          >
            <User className="size-5" strokeWidth={1.5} />
          </Link>
          <button
            onClick={() => setOpen(true)}
            className="relative -mr-3 flex size-11 items-center justify-center text-foreground/80 transition-colors hover:text-foreground"
            aria-label={`Open bag, ${count} ${count === 1 ? "item" : "items"}`}
          >
            <ShoppingBag className="size-5" strokeWidth={1.5} />
            {count > 0 && (
              <span className="absolute top-1 right-0.5 flex size-4 items-center justify-center rounded-full bg-foreground text-[0.7rem] font-semibold text-background">
                {count > 9 ? "9+" : count}
              </span>
            )}
          </button>
        </div>
      </div>
      <SearchPanel open={searchOpen} onOpenChange={setSearchOpen} />
    </header>
  )
}
