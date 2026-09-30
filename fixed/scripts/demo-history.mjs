// A made-up six months of trading, so the shop and the admin can be seen as
// they'll look after a season: customers (some with accounts), ~2,000 orders
// (quiet in spring and summer, busier from late August), card and bank
// transfer, unpaid and cancelled orders, some waiting to ship and some on their
// way, returns (some refused), discount codes, reviews (some waiting to be
// read), newsletter sign-ups, contact messages, and stock that reflects it all.
//
//   npm run demo:add       load it (once)
//   npm run demo:remove    take all of it out again, stock put back
//   node scripts/demo-history.mjs --dry   try it without keeping anything
//
// Safe by design:
// - Made-up customers have addresses at reserved ".example" domains, which can
//   never receive mail, and the database never queues an email to them
//   (see migration 20260930238000_demo_history.sql). Nothing is sent to Stripe.
// - Everything is registered, so removal is one call: remove_demo_history().
// - Real customers, orders, accounts and settings are not touched.
// - Order numbers NRD-08xxx…NRD-10000 and return numbers RET-0xxx…RET-1000 sit
//   just below the real ones, so real numbering carries on unchanged.
import pg from "pg"

const db = new pg.Client(process.env.DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:57322/postgres")
await db.connect()

// ---------------------------------------------------------------------------
// Removing
// ---------------------------------------------------------------------------
if (process.argv.includes("--remove")) {
  const loaded = (await db.query("select loaded_at from public.demo_meta")).rows[0]
  if (!loaded) {
    console.log("There's no made-up history in the database.")
    await db.end()
    process.exit(0)
  }
  await db.query("begin")
  const res = (await db.query("select public.remove_demo_history() r")).rows[0].r
  await db.query("commit")
  console.log("Removed the made-up history:", res)
  await db.end()
  process.exit(0)
}

if ((await db.query("select 1 from public.demo_meta")).rowCount) {
  console.log("The made-up history is already loaded. Remove it first (npm run demo:remove) to load it again.")
  await db.end()
  process.exit(1)
}

// ---------------------------------------------------------------------------
// Randomness that comes out the same every time
// ---------------------------------------------------------------------------
let seed = 20260930
const rnd = () => {
  seed |= 0
  seed = (seed + 0x6d2b79f5) | 0
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}
const pick = (a) => a[Math.floor(rnd() * a.length)]
const between = (a, b) => a + rnd() * (b - a)
const int = (a, b) => Math.floor(between(a, b + 1))
function weighted(items, weight) {
  const total = items.reduce((s, x) => s + weight(x), 0)
  let r = rnd() * total
  for (const x of items) if ((r -= weight(x)) <= 0) return x
  return items[items.length - 1]
}
const uuid = () =>
  "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = Math.floor(rnd() * 16)
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16)
  })
const DAY = 86_400_000
const HOUR = 3_600_000

// ---------------------------------------------------------------------------
// People and places
// ---------------------------------------------------------------------------
const PEOPLE = {
  LV: {
    f: ["Anna", "Līga", "Ilze", "Kristīne", "Laura", "Marta", "Ieva", "Elīna", "Zane", "Agnese", "Inese", "Dace", "Linda", "Santa", "Madara", "Baiba", "Evija", "Sanita", "Rūta", "Alise"],
    m: ["Jānis", "Mārtiņš", "Edgars", "Andris", "Kārlis", "Roberts", "Artūrs", "Toms", "Rihards", "Matīss", "Raimonds", "Gatis"],
    last: [["Ozola", "Ozols"], ["Bērziņa", "Bērziņš"], ["Kalniņa", "Kalniņš"], ["Liepiņa", "Liepiņš"], ["Krūmiņa", "Krūmiņš"], ["Jansone", "Jansons"], ["Vītola", "Vītols"], ["Zariņa", "Zariņš"], ["Lāce", "Lācis"], ["Siliņa", "Siliņš"], ["Eglīte", "Eglītis"], ["Pētersone", "Pētersons"], ["Kļaviņa", "Kļaviņš"], ["Sproģe", "Sproģis"]],
    places: [["Rīga", "LV-10", 0.55], ["Jelgava", "LV-30", 0.06], ["Cēsis", "LV-41", 0.06], ["Liepāja", "LV-34", 0.07], ["Valmiera", "LV-42", 0.06], ["Kuldīga", "LV-33", 0.04], ["Sigulda", "LV-21", 0.05], ["Ventspils", "LV-36", 0.05], ["Daugavpils", "LV-54", 0.06]],
    streets: ["Brīvības iela", "Tērbatas iela", "Lāčplēša iela", "Rīgas iela", "Skolas iela", "Dārza iela", "Liepu iela", "Baznīcas iela", "Krišjāņa Barona iela", "Ezera iela"],
    phone: () => `+371 2${int(1000000, 9999999)}`,
  },
  LT: {
    f: ["Rūta", "Eglė", "Ieva", "Gintarė", "Aistė", "Monika", "Greta", "Justina"],
    m: ["Tomas", "Lukas", "Mantas", "Darius", "Paulius"],
    last: [["Kazlauskienė", "Kazlauskas"], ["Petrauskaitė", "Petrauskas"], ["Jankauskienė", "Jankauskas"], ["Vasiliauskaitė", "Vasiliauskas"], ["Stankevičienė", "Stankevičius"]],
    places: [["Vilnius", "0", 0.6], ["Kaunas", "4", 0.25], ["Klaipėda", "9", 0.15]],
    streets: ["Gedimino pr.", "Pilies g.", "Laisvės al.", "Vilniaus g.", "Didžioji g."],
    phone: () => `+370 6${int(1000000, 9999999)}`,
  },
  EE: {
    f: ["Kadri", "Liis", "Kristiina", "Mari", "Triin", "Kertu", "Merle"],
    m: ["Andres", "Martin", "Rasmus", "Karl"],
    last: [["Tamm", "Tamm"], ["Saar", "Saar"], ["Sepp", "Sepp"], ["Mägi", "Mägi"], ["Kask", "Kask"], ["Rebane", "Rebane"]],
    places: [["Tallinn", "1", 0.65], ["Tartu", "5", 0.25], ["Pärnu", "8", 0.1]],
    streets: ["Narva mnt", "Pikk", "Rüütli", "Tartu mnt", "Vabaduse pst"],
    phone: () => `+372 5${int(100000, 9999999)}`,
  },
  FI: {
    f: ["Aino", "Emilia", "Helmi", "Sanna", "Laura", "Elina", "Veera"],
    m: ["Mikko", "Juha", "Antti", "Ville"],
    last: [["Virtanen", "Virtanen"], ["Korhonen", "Korhonen"], ["Mäkinen", "Mäkinen"], ["Nieminen", "Nieminen"], ["Laine", "Laine"]],
    places: [["Helsinki", "00", 0.55], ["Tampere", "33", 0.25], ["Turku", "20", 0.2]],
    streets: ["Mannerheimintie", "Hämeenkatu", "Aleksanterinkatu", "Yliopistonkatu"],
    phone: () => `+358 40 ${int(1000000, 9999999)}`,
  },
  DE: {
    f: ["Anna", "Katharina", "Julia", "Lena", "Sabine", "Miriam", "Clara"],
    m: ["Lukas", "Jonas", "Felix", "Tobias"],
    last: [["Müller", "Müller"], ["Schmidt", "Schmidt"], ["Weber", "Weber"], ["Becker", "Becker"], ["Hoffmann", "Hoffmann"], ["Fischer", "Fischer"]],
    places: [["Berlin", "10", 0.35], ["Hamburg", "20", 0.25], ["München", "80", 0.2], ["Leipzig", "04", 0.2]],
    streets: ["Hauptstraße", "Lindenstraße", "Gartenstraße", "Schillerstraße"],
    phone: () => `+49 151 ${int(10000000, 99999999)}`,
  },
  SE: {
    f: ["Elsa", "Maja", "Ingrid", "Karin", "Astrid", "Linnea"],
    m: ["Erik", "Johan", "Oskar", "Nils"],
    last: [["Lindqvist", "Lindqvist"], ["Johansson", "Johansson"], ["Andersson", "Andersson"], ["Nilsson", "Nilsson"], ["Berg", "Berg"]],
    places: [["Stockholm", "11", 0.55], ["Göteborg", "41", 0.25], ["Uppsala", "75", 0.2]],
    streets: ["Drottninggatan", "Storgatan", "Kungsgatan", "Vasagatan"],
    phone: () => `+46 70 ${int(1000000, 9999999)}`,
  },
  NL: { f: ["Sanne", "Lotte", "Fleur"], m: ["Daan", "Bram"], last: [["de Vries", "de Vries"], ["Bakker", "Bakker"], ["Visser", "Visser"]], places: [["Utrecht", "35", 0.5], ["Amsterdam", "10", 0.5]], streets: ["Oudegracht", "Prinsengracht", "Kerkstraat"], phone: () => `+31 6 ${int(10000000, 99999999)}` },
  DK: { f: ["Freja", "Ida"], m: ["Mads"], last: [["Nielsen", "Nielsen"], ["Jensen", "Jensen"]], places: [["København", "1", 1]], streets: ["Nørregade", "Vesterbrogade"], phone: () => `+45 ${int(20000000, 99999999)}` },
  PL: { f: ["Zofia", "Maria"], m: ["Jakub"], last: [["Nowak", "Nowak"], ["Kowalska", "Kowalski"]], places: [["Warszawa", "00-", 0.6], ["Kraków", "31-", 0.4]], streets: ["ul. Nowy Świat", "ul. Floriańska"], phone: () => `+48 ${int(500000000, 799999999)}` },
  FR: { f: ["Camille", "Léa"], m: ["Hugo"], last: [["Martin", "Martin"], ["Bernard", "Bernard"]], places: [["Lyon", "6900", 0.5], ["Paris", "750", 0.5]], streets: ["Rue de la République", "Rue Victor Hugo"], phone: () => `+33 6 ${int(10000000, 99999999)}` },
  IE: { f: ["Aoife", "Niamh"], m: ["Ciarán"], last: [["Murphy", "Murphy"], ["Kelly", "Kelly"]], places: [["Dublin", "D0", 1]], streets: ["Grafton Street", "Camden Street"], phone: () => `+353 87 ${int(1000000, 9999999)}` },
  AT: { f: ["Lena", "Johanna"], m: ["Florian"], last: [["Gruber", "Gruber"], ["Huber", "Huber"]], places: [["Wien", "10", 1]], streets: ["Kärntner Straße", "Mariahilfer Straße"], phone: () => `+43 664 ${int(1000000, 9999999)}` },
}
const COUNTRY_WEIGHTS = { LV: 55, LT: 12, EE: 10, FI: 8, DE: 6, SE: 5, NL: 1.2, DK: 0.8, PL: 0.8, FR: 0.5, IE: 0.4, AT: 0.3 }
const LOCKERS = { Rīga: ["Origo", "Galleria Riga", "Spice", "Akropole", "Alfa"], Jelgava: ["Pilsētas pasāža"], Cēsis: ["Rimi Cēsis"], Liepāja: ["Ostmala"], Valmiera: ["Valleta"], Kuldīga: ["Maxima Kuldīga"], Sigulda: ["Rimi Sigulda"], Ventspils: ["Tobago"], Daugavpils: ["Ditton nams"] }
const DOMAINS = ["inbox.example", "pasts.example", "mail.example", "posti.example", "post.example"]
const fold = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ß/g, "ss").replace(/ł/g, "l").toLowerCase().replace(/[^a-z]+/g, "")

function postcode(country, prefix) {
  const n = (d) => String(int(0, 10 ** d - 1)).padStart(d, "0")
  switch (country) {
    case "LV": return `${prefix}${n(2)}`
    case "LT": return `${prefix}${n(4)}`
    case "EE": return `${prefix}${n(4)}`
    case "FI": return `${prefix}${n(3)}`
    case "DE": return `${prefix}${n(3)}`
    case "SE": return `${prefix}${n(1)} ${n(2)}`
    case "NL": return `${prefix}${n(2)} ${String.fromCharCode(65 + int(0, 25))}${String.fromCharCode(65 + int(0, 25))}`
    case "PL": return `${prefix}${n(3)}`
    case "FR": return `${prefix}${n(1)}`
    case "IE": return `${prefix}${int(1, 8)} ${String.fromCharCode(65 + int(0, 25))}${n(2)}`
    case "DK": return `${prefix}${n(3)}`
    case "AT": return `${prefix}${n(2)}`
  }
}

const usedEmails = new Set(["owner@nordaloom.example"])
function makePerson(country) {
  const P = PEOPLE[country]
  const woman = rnd() < 0.78 // most of a knitwear shop's customers
  const first = pick(woman ? P.f : P.m)
  const last = pick(P.last)[woman ? 0 : 1]
  const [city, prefix] = weighted(P.places, (p) => p[2])
  let email
  for (let i = 0; ; i++) {
    const base = rnd() < 0.7 ? `${fold(first)}.${fold(last)}` : `${fold(first)}${fold(last).slice(0, 1)}`
    email = `${base}${i || rnd() < 0.3 ? int(1, 99) : ""}@${pick(DOMAINS)}`
    if (!usedEmails.has(email)) break
  }
  usedEmails.add(email)
  return {
    name: `${first} ${last}`,
    first,
    email,
    country,
    city,
    postal: postcode(country, prefix),
    line1: `${pick(P.streets)} ${int(1, 88)}${rnd() < 0.3 ? `-${int(1, 40)}` : ""}`,
    phone: P.phone(),
  }
}

// ---------------------------------------------------------------------------
// The catalogue as it is
// ---------------------------------------------------------------------------
const variants = (await db.query(`
  select v.id, v.product_id, v.colour, v.size, v.stock, coalesce(v.price_cents, p.price_cents) as price,
         p.slug, p.name, p.images[1] as image, p.category_slug, p.sizes, p.colours
  from public.product_variants v join public.products p on p.id = v.product_id
  where p.is_published`)).rows
const byProduct = new Map()
for (const v of variants) (byProduct.get(v.product_id) ?? byProduct.set(v.product_id, []).get(v.product_id)).push(v)
const products = [...byProduct.values()].map((vs) => ({ id: vs[0].product_id, slug: vs[0].slug, name: vs[0].name, category: vs[0].category_slug, colours: vs[0].colours.map((c) => c.name), sizes: vs[0].sizes, variants: vs }))
// Some pieces sell much better than others.
for (const p of products) p.pop = /kapa-crewneck|priede-fisherman|egle-chunky|sniegs|ezers-rib|liepa-classic|gauja-cable|kapa-rib-beanie/.test(p.slug) ? between(3, 5) : between(0.4, 1.8)
const SIZE_W = { XS: 0.5, S: 1.2, M: 1.4, L: 1, XL: 0.5 }
function seasonFactor(category, month) {
  const autumn = month >= 8 // September (0-based 8) onwards
  const late = month === 7
  switch (category) {
    case "sweaters": return autumn ? 1.6 : late ? 1.1 : 0.7
    case "cardigans": return autumn ? 1.3 : 1
    case "hats": case "mittens": return autumn ? 1.8 : late ? 0.9 : 0.35
    case "socks": return autumn ? 1.5 : 0.8
    case "scarves": return autumn ? 1.4 : 0.9
    case "blankets": return autumn ? 1.3 : 0.9
    default: return 1
  }
}
function pickVariant(month) {
  const p = weighted(products, (x) => x.pop * seasonFactor(x.category, month))
  const colour = weighted(p.colours, (c) => (c === p.colours[0] ? 2 : 1))
  const size = weighted(p.sizes, (s) => SIZE_W[s] ?? 1)
  return p.variants.find((v) => v.colour === colour && v.size === size) ?? pick(p.variants)
}

const rates = { LV_locker: ["omniva_lv", "Omniva parcel locker", 399], LV: ["courier_lv", "Courier", 599], LT: ["courier_baltic", "Courier", 699], EE: ["courier_baltic", "Courier", 699] }
const rateFor = (c, locker) => (c === "LV" ? (locker ? rates.LV_locker : rates.LV) : rates[c] ?? ["courier_eu", "Courier", 1290])

// ---------------------------------------------------------------------------
// Time: six months, quiet in spring and summer, busier from late August
// ---------------------------------------------------------------------------
const NOW = Date.now()
// From the first of the month five months back (e.g. 1 April, when it's September now).
const START = (() => {
  const d = new Date(NOW)
  return new Date(d.getFullYear(), d.getMonth() - 5, 1).getTime()
})()
function ordersPerDay(t) {
  const d = new Date(t)
  const daysToEnd = (NOW - t) / DAY
  let base
  if (daysToEnd > 45) base = 6.6 + 1.1 * Math.sin((t - START) / (40 * DAY)) // spring and summer
  else if (daysToEnd > 32) base = 8.5 + (45 - daysToEnd) * 0.75 // the end of August
  else base = 17 + (32 - daysToEnd) * 0.42 // September
  const weekend = [0, 6].includes(d.getDay()) ? 1.25 : 1
  return Math.max(0, base * weekend * between(0.7, 1.3))
}
/** How many orders a day with this average gets (Knuth's method). */
function poisson(l) {
  const limit = Math.exp(-l)
  let k = 0
  let p = 1
  do {
    k++
    p *= rnd()
  } while (p > limit)
  return k - 1
}
const orderTimes = []
for (let day = START; day < NOW; day += DAY) {
  const n = poisson(ordersPerDay(day))
  for (let i = 0; i < n; i++) {
    // Evenings are busiest.
    const hour = weighted([7, 9, 11, 13, 15, 17, 19, 20, 21, 22, 23], (h) => (h >= 19 ? 3 : h >= 12 ? 1.6 : 0.8))
    const t = new Date(day)
    t.setHours(hour, int(0, 59), int(0, 59))
    if (t.getTime() < NOW - 20 * 60_000) orderTimes.push(t.getTime())
  }
}
orderTimes.sort((a, b) => a - b)

// ---------------------------------------------------------------------------
// Customers and their orders
// ---------------------------------------------------------------------------
const TARGET_CUSTOMERS = 410
const customers = []
const orders = []
// Campaigns, placed relative to today: a summer letter (mid-June to July),
// a wool week two weeks ago, and a thank-you code for loyal customers.
const CODES = [
  { code: "SUMMER10", kind: "percent", value: 10, from: NOW - 107 * DAY, to: NOW - 61 * DAY, note: "Summer letter" },
  { code: "WOOLWEEK", kind: "fixed", value: 1500, min: 12000, from: NOW - 16 * DAY, to: NOW - 8 * DAY, note: "Wool week — €15 off orders over €120" },
  { code: "THANKYOU20", kind: "percent", value: 20, from: NOW - 60 * DAY, to: NOW + 365 * DAY, once: true, note: "For customers on their third order", open: true },
].map((k) => ({ ...k, ends_at: k.open ? null : new Date(k.to).toISOString() }))

for (let i = 0; i < orderTimes.length; i++) {
  const t = orderTimes[i]
  const wantNew = Math.round(TARGET_CUSTOMERS * Math.pow((i + 1) / orderTimes.length, 0.75))
  let c
  const eligible = customers.filter((x) => t - x.lastAt > 8 * DAY)
  if (customers.length < wantNew || eligible.length === 0) {
    const country = weighted(Object.keys(COUNTRY_WEIGHTS), (k) => COUNTRY_WEIGHTS[k])
    c = { ...makePerson(country), id: null, account: rnd() < 0.62, newsletter: rnd() < 0.42, loyalty: Math.pow(rnd(), 2.2) * 6 + 0.3, orders: 0, firstAt: t, lastAt: t, lockerFan: rnd() < 0.62, usedCodes: new Set() }
    if (c.account) c.id = uuid()
    customers.push(c)
  } else {
    c = weighted(eligible, (x) => x.loyalty)
  }

  const month = new Date(t).getMonth()
  const lines = []
  const nLines = weighted([1, 2, 3], (n) => [0, 0.62, 0.29, 0.09][n])
  for (let k = 0; k < nLines; k++) {
    const v = pickVariant(month)
    const same = lines.find((l) => l.v.id === v.id)
    if (same) same.q++
    else lines.push({ v, q: rnd() < 0.08 ? 2 : 1 })
  }
  const subtotal = lines.reduce((s, l) => s + l.v.price * l.q, 0)

  // Discount codes, following each code's rules.
  let code = null
  if (c.orders === 0 && c.newsletter && rnd() < 0.4) code = { code: "WELCOME10", cut: Math.round(subtotal * 0.1) }
  else {
    const live = CODES.filter((k) => t >= k.from && t < k.to && (!k.min || subtotal >= k.min) && !(k.once && c.usedCodes.has(k.code)))
    const k = live.find((k) => (k.code === "THANKYOU20" ? c.orders >= 2 && rnd() < 0.12 : rnd() < (k.code === "WOOLWEEK" ? 0.45 : 0.2)))
    if (k) code = { code: k.code, cut: k.kind === "percent" ? Math.round(subtotal * k.value / 100) : Math.min(k.value, subtotal) }
  }
  if (code) c.usedCodes.add(code.code)
  const discount = code?.cut ?? 0
  const locker = c.country === "LV" && (c.lockerFan ? rnd() < 0.85 : rnd() < 0.15)
  const [shipCode, shipLabel, shipPrice] = rateFor(c.country, locker)
  const shipping = subtotal - discount >= 15000 ? 0 : shipPrice
  const total = subtotal - discount + shipping

  // What happened to it.
  const card = rnd() < 0.61
  const o = {
    id: uuid(), c, t, lines, subtotal, discount, code: code?.code ?? null, shipCode, shipLabel, shipping, total,
    method: card ? "card" : "bank_transfer", locker: locker ? `${c.city}, ${pick(LOCKERS[c.city] ?? ["Rimi"])}` : "",
    status: "delivered", paidAt: null, shippedAt: null, deliveredAt: null, cancelledAt: null, cancelReason: null, dueAt: null, tracking: "", refunded: 0,
  }
  if (rnd() < 0.068) {
    // Never paid: a card payment left unfinished, or a transfer that never came.
    if (card && rnd() < 0.5) {
      o.status = "cancelled"; o.cancelReason = "not_paid"; o.cancelledAt = t + 36 * 60_000; o.dueAt = t + 40 * 60_000
    } else {
      o.method = "bank_transfer"; o.dueAt = t + 5 * DAY
      if (o.dueAt > NOW) o.status = "awaiting_payment"
      else { o.status = "cancelled"; o.cancelReason = "not_paid"; o.cancelledAt = o.dueAt + int(1, 5) * 60_000 }
    }
  } else {
    o.paidAt = card ? t + int(40, 180) * 1000 : t + between(5 * HOUR, 3 * DAY)
    o.dueAt = card ? t + 40 * 60_000 : t + 5 * DAY
    if (o.paidAt > NOW) {
      o.status = "awaiting_payment"; o.paidAt = null
    } else {
      o.shippedAt = o.paidAt + between(0.3 * DAY, 1.6 * DAY)
      const transit = c.country === "LV" ? between(0.8, 2) : ["LT", "EE"].includes(c.country) ? between(1.5, 3.5) : between(3, 6.5)
      o.deliveredAt = o.shippedAt + transit * DAY
      if (o.shippedAt > NOW) { o.status = "paid"; o.shippedAt = null; o.deliveredAt = null }
      else if (o.deliveredAt > NOW) { o.status = "shipped"; o.deliveredAt = null }
      if (o.shippedAt) o.tracking = `CE${int(100000000, 999999999)}LV`
      // Now and then the shop cancels a paid order (a flaw found while packing) and refunds it.
      if (o.status === "delivered" && rnd() < 0.004) {
        o.status = "cancelled"; o.cancelReason = "by_shop"; o.cancelledAt = o.paidAt + 0.5 * DAY
        o.shippedAt = null; o.deliveredAt = null; o.tracking = ""; o.refunded = total
      }
    }
  }
  if (o.status !== "cancelled" || o.cancelReason === "by_shop") {
    c.orders++
    c.lastAt = t
  }
  orders.push(o)
}
// Order numbers just below the real ones, in date order.
orders.forEach((o, i) => (o.number = `NRD-${String(10001 - orders.length + i).padStart(5, "0")}`))
for (const c of customers) {
  c.createdAt = c.firstAt - between(0, 3) * HOUR
  if (c.account) for (const o of orders) if (o.c === c) o.userId = c.id
}

// ---------------------------------------------------------------------------
// Returns (account orders; within 14 days of delivery)
// ---------------------------------------------------------------------------
const REASONS = [["too_small", 30], ["too_big", 24], ["changed_mind", 20], ["not_as_expected", 15], ["faulty", 6], ["other", 5]]
const DETAILS = {
  too_small: ["Tight across the shoulders.", "The sleeves are too short for me.", "Lovely, but I need a size up.", ""],
  too_big: ["Much roomier than I expected.", "The body is too long on me.", ""],
  changed_mind: ["The colour doesn't suit me after all.", "I ordered two colours to compare and am keeping the other one.", ""],
  not_as_expected: ["Thicker than I imagined — too warm for the office.", "The colour is darker than on my screen."],
  faulty: ["A small hole near the cuff.", "One seam is coming undone at the side."],
  other: ["Bought as a gift and it didn't fit.", "Ordered by mistake."],
}
const REFUSALS = [
  "The sweater came back worn and washed, so we can't resell it — we're sorry.",
  "The piece has clearly been worn for a while and has started to felt, so we can't take it back. We're sorry.",
  "It arrived back with a strong smell of perfume and can't be sold again. We're sorry we can't help this time.",
]
const returns = []
for (const o of orders) {
  if (o.status !== "delivered" || !o.userId || rnd() > 0.125) continue
  const created = o.deliveredAt + between(1.5, 12) * DAY
  if (created > NOW - 2 * HOUR) continue
  const age = (NOW - created) / DAY
  // Returns still open are on bank transfer orders, so they can be finished in the admin without Stripe.
  if (age < 10 && o.method === "card") continue
  const reason = weighted(REASONS, (r) => r[1])[0]
  const takeAll = o.lines.length > 1 && rnd() < 0.2
  const lines = takeAll ? o.lines : [pick(o.lines)]
  const items = lines.map((l) => ({ line: l, q: l.q }))
  let status = age < 2.5 ? "requested" : age < 8 ? "approved" : rnd() < 0.12 && reason !== "faulty" ? "refused" : "refunded"
  const r = { id: uuid(), o, created, reason, details: pick(DETAILS[reason]), items, status, note: "", decided: null, refundedAt: null, refund: null, restocked: false }
  if (status !== "requested") r.decided = created + between(4 * HOUR, 30 * HOUR)
  if (status === "refused") r.note = pick(REFUSALS)
  if (status === "approved" && rnd() < 0.3) r.note = "Thank you — please put a note with the return number in the parcel."
  if (status === "refunded") {
    const value = items.reduce((s, x) => s + x.line.v.price * x.q, 0)
    const share = o.subtotal ? Math.round((value * o.discount) / o.subtotal) : 0
    const whole = items.length === o.lines.length && items.every((x) => x.q === x.line.q)
    r.refund = value - share + (whole ? o.shipping : 0)
    r.refundedAt = r.decided + between(4, 9) * DAY
    if (r.refundedAt > NOW) { r.status = "approved"; r.refund = null; r.refundedAt = null }
    else { r.restocked = reason !== "faulty"; o.refunded += r.refund }
  }
  returns.push(r)
}
returns.sort((a, b) => a.created - b.created)
returns.forEach((r, i) => (r.number = `RET-${String(1001 - returns.length + i).padStart(4, "0")}`))

// ---------------------------------------------------------------------------
// Reviews (account customers, delivered pieces)
// ---------------------------------------------------------------------------
const PIECE = { sweaters: "sweater", cardigans: "cardigan", hats: "hat", mittens: "mittens", socks: "socks", scarves: "scarf", blankets: "blanket" }
const ASKS_FIT = (cat) => !["scarves", "blankets"].includes(cat)
const TEXT = {
  open5: ["Beautiful {p}.", "Exactly what I hoped for.", "Lovely, warm and soft.", "My new favourite {p}.", "Worth every euro.", "Wonderful quality, you can feel it straight away.", "I love it."],
  open4: ["Really nice {p}.", "Very happy with it.", "Good, honest knitwear.", "Warm and well made."],
  body: {
    sweaters: ["Soft enough to wear over a thin T-shirt.", "It keeps me warm on the walk to work, even on windy days.", "The colour is even nicer than in the photos.", "No pilling so far after a month of wearing it almost daily.", "You can tell it's made with care — the seams are perfect.", "Heavier than shop-bought sweaters, in the best way."],
    cardigans: ["I wear it over everything.", "The buttons are lovely and feel solid.", "Light enough for the office, warm enough for the evening.", "The pockets are deep enough for a phone."],
    hats: ["Warm without being itchy.", "Covers my ears properly.", "Keeps its shape after a wash."],
    mittens: ["My hands stay warm even at minus ten.", "The pattern is lovely, everyone asks about them.", "Thick and cosy, the cuffs stay up."],
    socks: ["The most comfortable socks I own.", "Perfect for the cottage and the sauna evenings.", "Warm feet all winter, finally."],
    scarves: ["Long enough to wrap twice.", "Soft against the neck, not scratchy at all.", "Beautiful colour, goes with both my coats."],
    blankets: ["It lives on our sofa now.", "Heavy, soft and big enough for two.", "The whole family fights over it."],
  },
  fit: { small: "It runs a little small — I'd take a size up.", large: "It's roomy; next time I'd go a size down.", true: "True to size for me." },
  close: ["I'll be back for another colour.", "Already thinking about a second one.", "Thank you, Nordaloom!", "Beautifully wrapped, too.", "", ""],
  three: ["Nice, but the colour is a little darker than on my screen.", "Good quality, though a bit itchy for me against the skin.", "Lovely knit, but it took longer to arrive than I hoped.", "Warm, but heavier than I expected for everyday wear."],
  low: ["Not for me — too scratchy to wear, even over a shirt.", "It stretched after the first wash, although I followed the care instructions.", "The size was completely off for me, and the return postage was expensive.", "Pilled badly within two weeks."],
}
const REPLIES = {
  low: [
    "We're sorry it wasn't right for you, and thank you for telling us. Our Nordic wool is the more rustic one — if you write to us, we'll gladly suggest a softer lambswool piece.",
    "Thank you for the honest review. Wool can relax if it's dried hanging; please dry it flat and reshape it while damp. If it hasn't recovered, write to us and we'll help.",
    "We're sorry to hear that. A little pilling is normal in the first weeks, but not this much — please write to us with your order number and we'll put it right.",
  ],
  high: ["Thank you so much — we're glad it's keeping you warm!", "Thank you! This made our day in the workshop.", "Thank you for the kind words, and for wearing it so well."],
}
const reviews = []
const reviewed = new Set()
for (const o of orders) {
  if (o.status !== "delivered" || !o.userId) continue
  for (const l of o.lines) {
    const key = `${o.userId}|${l.v.product_id}`
    if (reviewed.has(key) || rnd() > 0.2) continue
    const created = o.deliveredAt + between(3, 25) * DAY
    if (created > NOW - HOUR) continue
    const returned = returns.some((r) => r.o === o && r.items.some((x) => x.line === l) && r.status !== "refused")
    let rating = weighted([5, 4, 3, 2, 1], (s) => ({ 5: 60, 4: 25, 3: 8, 2: 4, 1: 3 })[s])
    if (returned && rating > 3) rating = rnd() < 0.5 ? 3 : 4
    const cat = l.v.category_slug
    const fit = ASKS_FIT(cat) ? weighted(["true", "small", "large"], (f) => ({ true: 65, small: 20, large: 15 })[f]) : null
    const p = PIECE[cat] ?? "piece"
    const parts =
      rating >= 4
        ? [pick(rating === 5 ? TEXT.open5 : TEXT.open4).replace("{p}", p), pick(TEXT.body[cat] ?? TEXT.body.sweaters), fit ? TEXT.fit[fit] : "", pick(TEXT.close)]
        : rating === 3
          ? [pick(TEXT.three), fit && fit !== "true" ? TEXT.fit[fit] : ""]
          : [pick(TEXT.low)]
    const age = (NOW - created) / DAY
    const status = age < 2.2 ? "pending" : rnd() < 0.05 ? "rejected" : "published"
    let reply = null
    if (status === "published" && (rating <= 2 ? rnd() < 0.8 : rating === 3 ? rnd() < 0.3 : rnd() < 0.07)) reply = pick(rating <= 3 ? REPLIES.low : REPLIES.high)
    reviewed.add(key)
    const c = o.c
    const [firstName, ...rest] = c.name.split(" ")
    reviews.push({
      id: uuid(), product_id: l.v.product_id, user_id: o.userId, rating, fit, created, status, reply,
      body: parts.filter(Boolean).join(" "), author: `${firstName} ${rest.join(" ").replace(/^(de |van )/, "").charAt(0).toUpperCase()}.`,
    })
  }
}

// ---------------------------------------------------------------------------
// Newsletter and contact form
// ---------------------------------------------------------------------------
const newsletter = []
for (const c of customers) if (c.newsletter) newsletter.push({ email: c.email, t: c.firstAt - between(0, 2) * DAY })
const extraSubscribers = 230
for (let i = 0; i < extraSubscribers; i++) {
  const country = weighted(Object.keys(COUNTRY_WEIGHTS), (k) => COUNTRY_WEIGHTS[k])
  const person = makePerson(country)
  // More sign-ups as autumn comes.
  const t = NOW - Math.pow(rnd(), 1.8) * 183 * DAY
  newsletter.push({ email: person.email, t, extra: true })
}

const accountCustomers = customers.filter((c) => c.account)
const MESSAGES = [
  ["order", (c, o) => `Hello! I paid for order ${o.number} by bank transfer yesterday — could you let me know when it will be sent? Thank you.`],
  ["order", (c, o) => `Could I still change the delivery for ${o.number} to a parcel locker? I won't be home this week.`],
  ["order", (c, o) => `My parcel for ${o.number} hasn't moved in the tracking for three days. Is everything all right?`],
  ["sizing", () => "I usually wear M in most brands, chest about 96 cm. Would you recommend M or L in the Gauja Cable Crew? I like a bit of room for a shirt."],
  ["sizing", () => "Are the Sniegs mittens roomy enough for large hands? My palm is about 21 cm around."],
  ["sizing", () => "Do the socks run small? I'm between 39 and 40."],
  ["care", () => "Can the lambswool sweaters go in the washing machine on the wool programme, or only by hand?"],
  ["care", () => "What's the best way to get rid of pilling on the Egle wrap? It's my favourite and I don't want to damage it."],
  ["care", () => "Do you sell the cedar blocks you mention in the care guide?"],
  ["returns", (c, o) => `I've sent my return for ${o.number} back today with Omniva. Just letting you know!`],
  ["wholesale", () => "We run a small design shop in Tallinn's old town and would love to stock your hats and mittens this winter. Do you sell wholesale?"],
  ["wholesale", () => "Hello from Helsinki — I write for a Nordic interiors magazine and would like to feature your blankets in our winter issue. Could we borrow two for a photo shoot?"],
  ["other", () => "Will the Kāpa Crewneck come back in Chestnut in size S? I missed it last time."],
  ["other", () => "Do you make children's sizes? My daughter wants a sweater like mine."],
  ["other", () => "Is it possible to visit the workshop in Kuldīga? We'll be passing through in October."],
  ["other", () => "I'd love a gift card for my sister's birthday — do you have them?"],
]
const messages = []
for (let i = 0; i < 34; i++) {
  const [topic, text] = pick(MESSAGES)
  const needsOrder = text.length === 2
  const pool = needsOrder ? orders.filter((o) => o.status !== "cancelled") : null
  const o = needsOrder ? pick(pool.slice(-Math.min(pool.length, 600))) : null
  const c = o ? o.c : rnd() < 0.5 ? pick(customers) : makePerson(weighted(Object.keys(COUNTRY_WEIGHTS), (k) => COUNTRY_WEIGHTS[k]))
  const t = o ? Math.min(NOW - HOUR, o.t + between(0.5, 6) * DAY) : NOW - Math.pow(rnd(), 1.5) * 170 * DAY
  const age = (NOW - t) / DAY
  const status = age < 1 ? "new" : age < 3 ? (rnd() < 0.5 ? "read" : "answered") : "answered"
  messages.push({ id: uuid(), name: c.name, email: c.email, topic, order: o?.number ?? null, message: text(c, o), t, status, answered: status === "answered" ? t + between(2 * HOUR, 30 * HOUR) : null, userId: c.account ? c.id ?? null : null })
}

// ---------------------------------------------------------------------------
// Stock: what's on the shelf after a season like this
// ---------------------------------------------------------------------------
// Pieces that sold best lately are the ones now sold out or running low;
// everything else keeps the stock it has now.
const recent = new Map()
for (const o of orders) {
  if (o.t < NOW - 35 * DAY || (o.status === "cancelled" && o.cancelReason === "not_paid")) continue
  for (const l of o.lines) recent.set(l.v.id, (recent.get(l.v.id) ?? 0) + l.q)
}
const ranked = [...recent.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => variants.find((v) => v.id === id))
const stockAfter = new Map(variants.map((v) => [v.id, v.stock]))
ranked.slice(0, 13).forEach((v) => stockAfter.set(v.id, 0))
ranked.slice(13, 38).forEach((v) => stockAfter.set(v.id, int(1, 2)))
// Everything else: a believable shelf after a season of small batches and
// restocks (the catalogue's starting numbers had many empty or near-empty
// variants). All of this is recorded and undone on removal.
const soldOutOrLow = new Set(ranked.slice(0, 38).map((v) => v.id))
for (const v of variants) {
  if (soldOutOrLow.has(v.id)) continue
  if (v.stock <= 3) stockAfter.set(v.id, int(4, 14))
}

// ---------------------------------------------------------------------------
// Writing it all, in one go
// ---------------------------------------------------------------------------
const iso = (t) => (t == null ? null : new Date(t).toISOString())
async function insert(table, columns, rows, casts = {}) {
  for (let i = 0; i < rows.length; i += 400) {
    const chunk = rows.slice(i, i + 400)
    const cols = columns.map((c) => `"${c}"`).join(", ")
    const sel = columns.map((c) => (casts[c] ? `(r->>'${c}')::${casts[c]}` : `r->>'${c}'`)).join(", ")
    await db.query(`insert into ${table} (${cols}) select ${sel} from jsonb_array_elements($1::jsonb) r`, [JSON.stringify(chunk)])
  }
}

try {
  await db.query("begin")
  // No triggers while loading: no emails, no automatic stock changes; everything is set explicitly.
  await db.query("set local session_replication_role = replica")
  await db.query("insert into public.demo_meta (loaded_at) values (now())")

  const everyone = new Set([...customers.map((c) => c.email), ...newsletter.map((n) => n.email), ...messages.map((m) => m.email)])
  await insert("public.demo_people", ["email"], [...everyone].map((email) => ({ email: email.toLowerCase() })))

  for (const k of CODES) {
    await db.query(
      // Paused: these codes only exist so the history's orders have something to point at. Left active, a code
      // with no end date would give its discount to real customers (and then couldn't be removed with the history).
      `insert into public.discount_codes (code, kind, value, min_order_cents, ends_at, once_per_customer, note, created_at, is_active) values ($1,$2,$3,$4,$5,$6,$7,$8,false)`,
      [k.code, k.kind, k.value, k.min ?? null, k.ends_at, !!k.once, k.note, iso(k.from - 3 * DAY)],
    )
    await db.query("insert into public.demo_codes (code) values ($1)", [k.code])
  }
  const codeIds = Object.fromEntries((await db.query("select code, id from public.discount_codes")).rows.map((r) => [r.code, r.id]))

  // Accounts: a login that can never be used (no password), a profile, a saved address.
  await insert(
    "auth.users",
    ["instance_id", "id", "aud", "role", "email", "encrypted_password", "email_confirmed_at", "raw_app_meta_data", "raw_user_meta_data", "created_at", "updated_at", "confirmation_token", "recovery_token", "email_change_token_new", "email_change", "email_change_token_current", "phone_change", "phone_change_token", "reauthentication_token", "is_sso_user", "is_anonymous"],
    accountCustomers.map((c) => ({
      instance_id: "00000000-0000-0000-0000-000000000000", id: c.id, aud: "authenticated", role: "authenticated", email: c.email, encrypted_password: "",
      email_confirmed_at: iso(c.createdAt), raw_app_meta_data: { provider: "email", providers: ["email"] }, raw_user_meta_data: { full_name: c.name },
      created_at: iso(c.createdAt), updated_at: iso(c.createdAt), confirmation_token: "", recovery_token: "", email_change_token_new: "", email_change: "",
      email_change_token_current: "", phone_change: "", phone_change_token: "", reauthentication_token: "", is_sso_user: false, is_anonymous: false,
    })),
    { instance_id: "uuid", id: "uuid", email_confirmed_at: "timestamptz", raw_app_meta_data: "jsonb", raw_user_meta_data: "jsonb", created_at: "timestamptz", updated_at: "timestamptz", is_sso_user: "boolean", is_anonymous: "boolean" },
  )
  await insert("public.profiles", ["id", "full_name", "role", "created_at"], accountCustomers.map((c) => ({ id: c.id, full_name: c.name, role: "customer", created_at: iso(c.createdAt) })), { id: "uuid", created_at: "timestamptz" })
  await insert(
    "public.customer_addresses",
    ["user_id", "label", "full_name", "phone", "country", "address_line1", "city", "postal_code", "is_default", "created_at"],
    accountCustomers.map((c) => ({ user_id: c.id, label: "Home", full_name: c.name, phone: c.phone, country: c.country, address_line1: c.line1, city: c.city, postal_code: c.postal, is_default: true, created_at: iso(c.createdAt) })),
    { user_id: "uuid", is_default: "boolean", created_at: "timestamptz" },
  )

  const cardOf = () => ({ brand: weighted(["visa", "mastercard", "amex"], (b) => ({ visa: 60, mastercard: 35, amex: 5 })[b]), last4: String(int(0, 9999)).padStart(4, "0") })
  await insert(
    "public.orders",
    ["id", "order_number", "user_id", "email", "full_name", "phone", "country", "address_line1", "city", "postal_code", "shipping_code", "shipping_label", "parcel_locker",
      "subtotal_cents", "shipping_cents", "total_cents", "vat_cents", "payment_reference", "discount_code_id", "discount_code", "discount_cents", "status", "created_at",
      "paid_at", "shipped_at", "delivered_at", "cancelled_at", "cancel_reason", "payment_due_at", "tracking_number", "payment_method", "card_brand", "card_last4", "refunded_cents"],
    orders.map((o) => {
      const card = o.method === "card" && o.paidAt ? cardOf() : { brand: null, last4: null }
      return {
        id: o.id, order_number: o.number, user_id: o.userId ?? null, email: o.c.email, full_name: o.c.name, phone: o.c.phone, country: o.c.country, address_line1: o.c.line1,
        city: o.c.city, postal_code: o.c.postal, shipping_code: o.shipCode, shipping_label: o.shipLabel, parcel_locker: o.locker, subtotal_cents: o.subtotal,
        shipping_cents: o.shipping, total_cents: o.total, vat_cents: Math.round(o.total - o.total / 1.21), payment_reference: o.number,
        discount_code_id: o.code ? codeIds[o.code] : null, discount_code: o.code, discount_cents: o.discount, status: o.status, created_at: iso(o.t),
        paid_at: iso(o.paidAt), shipped_at: iso(o.shippedAt), delivered_at: iso(o.deliveredAt), cancelled_at: iso(o.cancelledAt), cancel_reason: o.cancelReason,
        payment_due_at: iso(o.dueAt), tracking_number: o.tracking, payment_method: o.method, card_brand: card.brand, card_last4: card.last4, refunded_cents: o.refunded,
      }
    }),
    { id: "uuid", user_id: "uuid", discount_code_id: "uuid", subtotal_cents: "int", shipping_cents: "int", total_cents: "int", vat_cents: "int", discount_cents: "int", created_at: "timestamptz", paid_at: "timestamptz", shipped_at: "timestamptz", delivered_at: "timestamptz", cancelled_at: "timestamptz", payment_due_at: "timestamptz", refunded_cents: "int" },
  )
  const itemRows = []
  for (const o of orders) for (const l of o.lines) {
    l.id = uuid()
    itemRows.push({ id: l.id, order_id: o.id, variant_id: l.v.id, product_id: l.v.product_id, product_slug: l.v.slug, product_name: l.v.name, product_image: l.v.image, colour: l.v.colour, size: l.v.size, unit_price_cents: l.v.price, quantity: l.q, line_total_cents: l.v.price * l.q })
  }
  await insert("public.order_items", Object.keys(itemRows[0]), itemRows, { id: "uuid", order_id: "uuid", variant_id: "uuid", product_id: "uuid", unit_price_cents: "int", quantity: "int", line_total_cents: "int" })

  await insert(
    "public.returns",
    ["id", "return_number", "order_id", "user_id", "status", "reason", "details", "shop_note", "refund_cents", "restocked", "created_at", "decided_at", "refunded_at", "refund_method"],
    returns.map((r) => ({ id: r.id, return_number: r.number, order_id: r.o.id, user_id: r.o.userId, status: r.status, reason: r.reason, details: r.details, shop_note: r.note, refund_cents: r.refund, restocked: r.restocked, created_at: iso(r.created), decided_at: iso(r.decided), refunded_at: iso(r.refundedAt), refund_method: r.status === "refunded" ? r.o.method : null })),
    { id: "uuid", order_id: "uuid", user_id: "uuid", refund_cents: "int", restocked: "boolean", created_at: "timestamptz", decided_at: "timestamptz", refunded_at: "timestamptz" },
  )
  await insert("public.return_items", ["return_id", "order_item_id", "quantity"], returns.flatMap((r) => r.items.map((x) => ({ return_id: r.id, order_item_id: x.line.id, quantity: x.q }))), { return_id: "uuid", order_item_id: "uuid", quantity: "int" })

  await insert(
    "public.reviews",
    ["id", "product_id", "user_id", "rating", "fit", "body", "author_name", "status", "shop_reply", "shop_reply_at", "decided_at", "created_at", "updated_at"],
    reviews.map((r) => ({ id: r.id, product_id: r.product_id, user_id: r.user_id, rating: r.rating, fit: r.fit, body: r.body, author_name: r.author, status: r.status, shop_reply: r.reply, shop_reply_at: r.reply ? iso(r.created + DAY) : null, decided_at: r.status === "pending" ? null : iso(r.created + 0.8 * DAY), created_at: iso(r.created), updated_at: iso(r.created) })),
    { id: "uuid", product_id: "uuid", user_id: "uuid", rating: "int", shop_reply_at: "timestamptz", decided_at: "timestamptz", created_at: "timestamptz", updated_at: "timestamptz" },
  )
  await insert("public.newsletter_subscribers", ["email", "created_at"], newsletter.map((n) => ({ email: n.email, created_at: iso(n.t) })), { created_at: "timestamptz" })
  await insert(
    "public.contact_messages",
    ["id", "name", "email", "topic", "order_number", "message", "user_id", "status", "created_at", "answered_at"],
    messages.map((m) => ({ id: m.id, name: m.name, email: m.email, topic: m.topic, order_number: m.order, message: m.message, user_id: m.userId, status: m.status, created_at: iso(m.t), answered_at: iso(m.answered) })),
    { id: "uuid", user_id: "uuid", created_at: "timestamptz", answered_at: "timestamptz" },
  )

  // Stock, and a note of exactly what changed so it can be put back.
  const changes = variants.map((v) => ({ variant_id: v.id, change: stockAfter.get(v.id) - v.stock })).filter((x) => x.change !== 0)
  await insert("public.demo_stock_change", ["variant_id", "change"], changes, { variant_id: "uuid", change: "int" })
  await db.query("update public.product_variants v set stock = v.stock + c.change from public.demo_stock_change c where c.variant_id = v.id")

  await db.query("set local session_replication_role = origin")
  // Star ratings on the catalogue, from the published reviews.
  await db.query("select public.refresh_product_rating(id) from public.products")
  // --dry: build everything, check it fits, then undo it.
  await db.query(process.argv.includes("--dry") ? "rollback" : "commit")
  if (process.argv.includes("--dry")) console.log("(dry run: everything was checked and then undone)")
} catch (e) {
  await db.query("rollback")
  console.error("Nothing was loaded:", e.message)
  await db.end()
  process.exit(1)
}

// ---------------------------------------------------------------------------
// What went in
// ---------------------------------------------------------------------------
const count = (f) => orders.filter(f).length
console.log(`Loaded a made-up history from ${new Date(START).toDateString()} to today:`)
console.log(`  ${customers.length} customers (${accountCustomers.length} with accounts), ${orders.length} orders (${orders[0].number} … ${orders.at(-1).number})`)
console.log(`  delivered ${count((o) => o.status === "delivered")}, on their way ${count((o) => o.status === "shipped")}, waiting to ship ${count((o) => o.status === "paid")}, waiting for payment ${count((o) => o.status === "awaiting_payment")}, never paid ${count((o) => o.cancelReason === "not_paid")}, cancelled by the shop ${count((o) => o.cancelReason === "by_shop")}`)
console.log(`  card ${count((o) => o.method === "card")}, bank transfer ${count((o) => o.method === "bank_transfer")}; with a code ${count((o) => o.code)}`)
console.log(`  returns ${returns.length} (${["requested", "approved", "refunded", "refused"].map((s) => `${s} ${returns.filter((r) => r.status === s).length}`).join(", ")})`)
console.log(`  reviews ${reviews.length} (waiting ${reviews.filter((r) => r.status === "pending").length}, not published ${reviews.filter((r) => r.status === "rejected").length}), newsletter ${newsletter.length}, messages ${messages.length}`)
console.log(`  stock: ${ranked.slice(0, 13).length} variants sold out, ${ranked.slice(13, 38).length} running low, ${variants.filter((v) => !soldOutOrLow.has(v.id) && v.stock <= 3).length} restocked to look like a real shelf`)
await db.end()
