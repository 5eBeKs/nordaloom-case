import { useId, type ReactNode } from "react"
import { cn } from "@/lib/utils"
import { backdropFor, colourway, luminance, shade, tint } from "./colour"

/*
 * Drawn stand-ins for product photography: a flat-lay of the garment in its
 * real colour and knit, a close-up of the stitches, and a cropped detail.
 * Swapped for real photos as soon as a product has images.
 */

export type ArtView = "garment" | "texture" | "detail"

type Props = {
  category: string
  slug: string
  colour: { name: string; hex: string }
  view?: ArtView
  className?: string
  title?: string
}

type Texture = "stockinette" | "rib" | "seed" | "waffle" | "cable" | "pointelle" | "garter"

type Features = {
  texture: Texture
  mohair: boolean
  neck: "crew" | "roll" | "v" | "zip" | "shawl"
  length: "short" | "regular" | "long"
  colourwork: boolean
  stripes: boolean
  fringe: boolean
  pompom: boolean
  earflaps: boolean
  shortHat: boolean
  pockets: boolean
  belt: boolean
  zipFront: boolean
  sockLeg: number
  small: boolean
  strap: boolean
  button: string
}

function featuresFor(slug: string, category: string, twoTone: boolean, stripes: boolean): Features {
  const has = (...words: string[]) => words.some((w) => slug.includes(w))
  let texture: Texture = "stockinette"
  if (has("rib", "fisherman", "boot")) texture = "rib"
  if (has("cable")) texture = "cable"
  if (has("waffle")) texture = "waffle"
  if (has("ezers-half", "baby", "vejs")) texture = "seed"
  if (has("pointelle")) texture = "pointelle"
  if (has("chunky-wrap", "berzs-striped")) texture = "garter"

  let neck: Features["neck"] = "crew"
  if (has("rollneck")) neck = "roll"
  if (has("v-neck", "classic-cardigan")) neck = "v"
  if (has("half-zip", "zip-cardigan")) neck = "zip"
  if (has("shawl-collar", "long-cardigan")) neck = "shawl"

  return {
    texture,
    mohair: has("mohair", "alpaca"),
    neck,
    length: has("cropped", "boxy") ? "short" : has("long") ? "long" : "regular",
    colourwork: twoTone && category !== "blankets" ? true : twoTone,
    stripes: stripes || has("striped"),
    fringe: has("cable-throw", "chunky-wrap", "colourwork-scarf"),
    pompom: has("star-hat", "earflap"),
    earflaps: has("earflap"),
    shortHat: has("watch-cap", "fisherman-beanie"),
    pockets: has("classic-cardigan", "shawl-collar", "long-cardigan"),
    belt: has("long-cardigan"),
    zipFront: has("zip-cardigan"),
    sockLeg: has("boot") ? 236 : has("bed-socks") ? 120 : has("house") ? 220 : 180,
    small: has("baby"),
    strap: has("picnic"),
    button: has("classic-cardigan") ? "#b89a74" : has("shawl", "long") ? "#4a3f36" : "#efe9df",
  }
}

const safeId = (id: string) => id.replace(/[^a-zA-Z0-9_-]/g, "")

export function ProductArt({ category, slug, colour, view = "garment", className, title }: Props) {
  const uid = safeId(useId())
  const cw = colourway(colour.name, colour.hex)
  const f = featuresFor(slug, category, cw.twoTone, cw.stripes)
  const main = cw.main
  const dark = shade(main, luminance(main) < 0.08 ? 0.35 : 0.2)
  const light = tint(main, 0.22)
  const bg = backdropFor(main)
  const id = (name: string) => `${uid}-${name}`
  const url = (name: string) => `url(#${id(name)})`

  if (view === "texture") {
    return (
      <svg
        viewBox="0 0 400 500"
        preserveAspectRatio="xMidYMid slice"
        className={cn("block h-full w-full", className)}
        role="img"
        aria-label={title ?? `Close-up of the knit in ${colour.name}`}
      >
        <KnitCloseUp uid={uid} main={main} accent={cw.accent} features={f} />
      </svg>
    )
  }

  const zoom: Record<string, string> = {
    sweaters: "110 40 180 225",
    cardigans: "110 40 180 225",
    hats: "110 150 180 225",
    scarves: "150 160 180 225",
    socks: "70 190 180 225",
    blankets: "170 150 180 225",
  }
  const viewBox = view === "detail" ? zoom[category] ?? "100 100 200 250" : "0 0 400 500"

  const fill = texturePatternId(f, uid)
  const ctx: Ctx = { id, url, main, dark, light, accent: cw.accent, f, fill }

  let garment: ReactNode
  switch (category) {
    case "cardigans":
      garment = <Sweater ctx={ctx} cardigan />
      break
    case "hats":
      garment = <Hat ctx={ctx} />
      break
    case "scarves":
      garment = <Scarf ctx={ctx} />
      break
    case "socks":
      garment = <Socks ctx={ctx} />
      break
    case "blankets":
      garment = <Blanket ctx={ctx} />
      break
    default:
      garment = <Sweater ctx={ctx} />
  }

  return (
    <svg
      viewBox={viewBox}
      preserveAspectRatio="xMidYMid slice"
      className={cn("block h-full w-full", className)}
      role="img"
      aria-label={title ?? `${colour.name}`}
    >
      <defs>
        <linearGradient id={id("bg")} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={bg.top} />
          <stop offset="1" stopColor={bg.bottom} />
        </linearGradient>
        <pattern id={id("linen")} width="4" height="4" patternUnits="userSpaceOnUse">
          <path d="M0 0.5H4M0.5 0V4" stroke="#6b5a45" strokeWidth="0.5" opacity="0.08" />
        </pattern>
        <linearGradient id={id("light")} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity="0.16" />
          <stop offset="0.55" stopColor="#fff" stopOpacity="0" />
          <stop offset="1" stopColor="#000" stopOpacity="0.14" />
        </linearGradient>
        <filter id={id("shadow")} x="-20%" y="-20%" width="140%" height="150%">
          <feDropShadow dx="0" dy="10" stdDeviation="9" floodColor="#3b2f22" floodOpacity="0.2" />
        </filter>
        <filter id={id("fuzz")} x="-10%" y="-10%" width="120%" height="120%">
          <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="3" result="n" />
          <feDisplacementMap in="SourceGraphic" in2="n" scale="6" />
        </filter>
        <TexturePatterns uid={uid} main={main} dark={dark} light={light} accent={cw.accent} f={f} />
      </defs>
      <rect x="-50" y="-50" width="500" height="600" fill={url("bg")} />
      <rect x="-50" y="-50" width="500" height="600" fill={url("linen")} />
      <g filter={url("shadow")}>
        <g filter={f.mohair ? url("fuzz") : undefined}>{garment}</g>
      </g>
    </svg>
  )
}

type Ctx = {
  id: (n: string) => string
  url: (n: string) => string
  main: string
  dark: string
  light: string
  accent: string
  f: Features
  fill: string
}

function texturePatternId(f: Features, uid: string) {
  return `url(#${uid}-tx-${f.texture})`
}

/* ------------------------------------------------------------------------ */
/* Knit texture patterns                                                     */
/* ------------------------------------------------------------------------ */

function TexturePatterns({
  uid,
  main,
  dark,
  light,
  accent,
  f,
}: {
  uid: string
  main: string
  dark: string
  light: string
  accent: string
  f: Features
}) {
  const p = (name: string) => `${uid}-tx-${name}`
  return (
    <>
      <pattern id={p("stockinette")} width="9" height="8" patternUnits="userSpaceOnUse">
        <rect width="9" height="8" fill={main} />
        <path d="M0.8 0.8 L4.5 7 L8.2 0.8" fill="none" stroke={dark} strokeWidth="1.1" opacity="0.45" />
      </pattern>
      <pattern id={p("rib")} width="10" height="10" patternUnits="userSpaceOnUse">
        <rect width="10" height="10" fill={main} />
        <rect x="6" width="4" height="10" fill={dark} opacity="0.35" />
        <rect x="1" width="1.4" height="10" fill={light} opacity="0.35" />
      </pattern>
      <pattern id={p("seed")} width="8" height="8" patternUnits="userSpaceOnUse">
        <rect width="8" height="8" fill={main} />
        <circle cx="2" cy="2" r="1.2" fill={dark} opacity="0.45" />
        <circle cx="6" cy="6" r="1.2" fill={dark} opacity="0.45" />
        <circle cx="6" cy="2" r="0.9" fill={light} opacity="0.4" />
      </pattern>
      <pattern id={p("garter")} width="8" height="7" patternUnits="userSpaceOnUse">
        <rect width="8" height="7" fill={main} />
        <path d="M0 5 Q2 3.5 4 5 T8 5" fill="none" stroke={dark} strokeWidth="1.3" opacity="0.4" />
      </pattern>
      <pattern id={p("waffle")} width="16" height="16" patternUnits="userSpaceOnUse">
        <rect width="16" height="16" fill={light} />
        <rect x="3" y="3" width="10" height="10" rx="2.5" fill={dark} opacity="0.3" />
        <rect x="4.5" y="4.5" width="7" height="7" rx="2" fill={main} />
      </pattern>
      <pattern id={p("cable")} width="46" height="40" patternUnits="userSpaceOnUse">
        <rect width="46" height="40" fill={main} />
        <rect x="0" width="4" height="40" fill={dark} opacity="0.35" />
        <rect x="42" width="4" height="40" fill={dark} opacity="0.35" />
        <path d="M14 0 C14 12 32 8 32 20 S14 28 14 40" fill="none" stroke={dark} strokeWidth="7" opacity="0.3" />
        <path d="M32 0 C32 12 14 8 14 20 S32 28 32 40" fill="none" stroke={dark} strokeWidth="7" opacity="0.3" />
        <path d="M14 0 C14 12 32 8 32 20 S14 28 14 40" fill="none" stroke={light} strokeWidth="2" opacity="0.5" />
        <path d="M32 0 C32 12 14 8 14 20 S32 28 32 40" fill="none" stroke={light} strokeWidth="2" opacity="0.5" />
      </pattern>
      <pattern id={p("pointelle")} width="18" height="18" patternUnits="userSpaceOnUse">
        <rect width="18" height="18" fill={main} />
        <path d="M0.8 0.8 L4.5 7 L8.2 0.8 M9.8 9.8 L13.5 16 L17.2 9.8" fill="none" stroke={dark} strokeWidth="1" opacity="0.35" />
        <circle cx="4.5" cy="13" r="1.8" fill={shade(main, 0.45)} opacity="0.6" />
        <circle cx="13.5" cy="4" r="1.8" fill={shade(main, 0.45)} opacity="0.6" />
      </pattern>
      {/* Folk star band used for colourwork yokes, hats and scarves */}
      <pattern id={p("stars")} width="30" height="30" patternUnits="userSpaceOnUse">
        <rect width="30" height="30" fill={main} />
        <path d="M15 4 L26 15 L15 26 L4 15 Z" fill="none" stroke={accent} strokeWidth="3" />
        <rect x="12.5" y="12.5" width="5" height="5" fill={accent} />
        <rect x="0" y="0" width="3" height="3" fill={accent} />
      </pattern>
      <pattern id={p("stripes")} width="60" height="62" patternUnits="userSpaceOnUse">
        <rect width="60" height="62" fill={main} />
        <rect y="4" width="60" height="7" fill={accent} opacity="0.9" />
        <rect y="22" width="60" height="16" fill={f.stripes ? tint(accent, 0.2) : accent} opacity="0.85" />
        <rect y="48" width="60" height="4" fill={accent} opacity="0.9" />
      </pattern>
    </>
  )
}

/* ------------------------------------------------------------------------ */
/* Garments                                                                  */
/* ------------------------------------------------------------------------ */

function Sweater({ ctx, cardigan = false }: { ctx: Ctx; cardigan?: boolean }) {
  const { f, main, dark, light, url, fill, id } = ctx
  const hem = f.length === "short" ? 352 : f.length === "long" ? 468 : 408
  const body = `M168 96 Q200 116 232 96 L284 110 Q320 124 334 162 L356 322 L320 330 L292 206 L288 ${hem} L112 ${hem} L108 206 L80 330 L44 322 L66 162 Q80 124 116 110 Z`
  const ribFill = `url(#${id("tx-rib")})`
  const bodyFill = f.colourwork ? fill : fill

  return (
    <g>
      <clipPath id={id("body")}>
        <path d={body} />
      </clipPath>
      <path d={body} fill={bodyFill} />
      {/* colourwork yoke */}
      {f.colourwork && (
        <g clipPath={url("body")}>
          <path d="M40 96 L360 96 L360 176 Q200 214 40 176 Z" fill={`url(#${id("tx-stars")})`} />
          <path d="M40 176 Q200 214 360 176" fill="none" stroke={ctx.accent} strokeWidth="4" />
          <path d="M40 184 Q200 222 360 184" fill="none" stroke={ctx.accent} strokeWidth="2" opacity="0.8" />
        </g>
      )}
      {/* sleeve seams and soft folds */}
      <g clipPath={url("body")} fill="none" stroke={dark} strokeLinecap="round">
        <path d="M116 110 Q112 160 108 206" strokeWidth="1.6" opacity="0.35" />
        <path d="M284 110 Q288 160 292 206" strokeWidth="1.6" opacity="0.35" />
        <path d={`M150 ${hem - 60} Q200 ${hem - 80} 250 ${hem - 58}`} strokeWidth="6" opacity="0.08" />
        <path d="M86 240 Q96 270 92 300" strokeWidth="5" opacity="0.1" />
        <path d="M314 240 Q304 270 308 300" strokeWidth="5" opacity="0.1" />
      </g>
      {/* ribbed hem and cuffs */}
      <rect x="112" y={hem - 26} width="176" height="26" fill={ribFill} />
      <path d="M44 322 L80 330 L85 306 L49 298 Z" fill={ribFill} />
      <path d="M356 322 L320 330 L315 306 L351 298 Z" fill={ribFill} />
      <path d={`M112 ${hem - 26} H288`} stroke={dark} strokeWidth="1.2" opacity="0.4" />

      {cardigan ? <CardiganFront ctx={ctx} hem={hem} /> : <Neck ctx={ctx} />}

      {f.pockets && (
        <g>
          <rect x="128" y={hem - 104} width="50" height="56" rx="3" fill={fill} stroke={dark} strokeOpacity="0.35" />
          <rect x="222" y={hem - 104} width="50" height="56" rx="3" fill={fill} stroke={dark} strokeOpacity="0.35" />
          <rect x="128" y={hem - 104} width="50" height="9" fill={ribFill} />
          <rect x="222" y={hem - 104} width="50" height="9" fill={ribFill} />
        </g>
      )}
      {f.belt && (
        <g>
          <rect x="108" y="296" width="184" height="14" fill={ribFill} />
          <path d="M214 304 Q230 350 222 392" stroke={main} strokeWidth="13" fill="none" strokeLinecap="round" />
          <path d="M214 304 Q230 350 222 392" stroke={dark} strokeWidth="13" fill="none" strokeLinecap="round" opacity="0.2" />
          <path d="M210 304 Q196 346 206 380" stroke={main} strokeWidth="13" fill="none" strokeLinecap="round" />
        </g>
      )}
      {/* light across the whole garment */}
      <path d={body} fill={url("light")} />
      <path d={body} fill="none" stroke={light} strokeOpacity="0.25" strokeWidth="1" />
    </g>
  )
}

function Neck({ ctx }: { ctx: Ctx }) {
  const { f, main, dark, id } = ctx
  const rib = `url(#${id("tx-rib")})`
  const inner = shade(main, 0.35)
  switch (f.neck) {
    case "roll":
      return (
        <g>
          <path d="M166 100 L162 52 Q200 42 238 52 L234 100 Q200 116 166 100 Z" fill={rib} />
          <path d="M162 52 Q200 42 238 52 Q200 62 162 52 Z" fill={inner} />
          <path d="M164 76 Q200 68 236 76" stroke={dark} strokeWidth="3" fill="none" opacity="0.35" />
        </g>
      )
    case "v":
      return (
        <g>
          <path d="M168 96 L200 176 L232 96 Q200 104 168 96 Z" fill={inner} />
          <path d="M168 96 L200 176 L232 96" fill="none" stroke={main} strokeWidth="12" strokeLinejoin="round" />
          <path d="M168 96 L200 176 L232 96" fill="none" stroke={dark} strokeWidth="12" strokeDasharray="2 3" opacity="0.35" strokeLinejoin="round" />
        </g>
      )
    case "zip":
      return (
        <g>
          <path d="M166 100 L164 70 Q200 62 236 70 L234 100 Q200 114 166 100 Z" fill={rib} />
          <path d="M164 70 Q200 62 236 70 Q200 78 164 70 Z" fill={inner} />
          <path d="M200 74 V196" stroke="#57524b" strokeWidth="4" />
          <path d="M200 74 V196" stroke="#8d877c" strokeWidth="1.5" strokeDasharray="1.5 1.5" />
          <rect x="196" y="120" width="8" height="18" rx="2" fill="#6f6a61" />
        </g>
      )
    default:
      return (
        <g>
          <path d="M168 96 Q200 104 232 96 Q200 118 168 96 Z" fill={inner} />
          <path d="M166 95 Q200 122 234 95" fill="none" stroke={main} strokeWidth="11" />
          <path d="M166 95 Q200 122 234 95" fill="none" stroke={dark} strokeWidth="11" strokeDasharray="2 3" opacity="0.35" />
        </g>
      )
  }
}

function CardiganFront({ ctx, hem }: { ctx: Ctx; hem: number }) {
  const { f, main, dark, id } = ctx
  const rib = `url(#${id("tx-rib")})`
  const inner = shade(main, 0.35)
  const vBottom = f.neck === "shawl" ? 250 : f.neck === "v" ? 200 : 104
  const buttons: number[] = []
  if (!f.zipFront) {
    const start = f.neck === "crew" ? 118 : vBottom + 12
    const end = hem - 34
    const count = f.neck === "shawl" ? 3 : f.length === "short" ? 7 : 5
    for (let i = 0; i < count; i++) buttons.push(start + ((end - start) * i) / (count - 1))
  }

  return (
    <g>
      {f.neck === "crew" ? (
        <>
          <path d="M168 96 Q200 104 232 96 Q200 118 168 96 Z" fill={inner} />
          <path d="M166 95 Q200 122 234 95" fill="none" stroke={main} strokeWidth="10" />
          <path d="M166 95 Q200 122 234 95" fill="none" stroke={dark} strokeWidth="10" strokeDasharray="2 3" opacity="0.35" />
        </>
      ) : f.neck === "zip" ? (
        <>
          <path d="M166 100 L164 70 Q200 62 236 70 L234 100 Q200 114 166 100 Z" fill={rib} />
          <path d="M164 70 Q200 62 236 70 Q200 78 164 70 Z" fill={inner} />
        </>
      ) : (
        <path d={`M168 96 L200 ${vBottom} L232 96 Q200 104 168 96 Z`} fill={inner} />
      )}
      {/* button band */}
      {f.neck === "shawl" ? (
        <>
          <path d={`M160 92 Q170 190 196 ${vBottom} L196 ${hem}`} fill="none" stroke={main} strokeWidth="30" />
          <path d={`M160 92 Q170 190 196 ${vBottom} L196 ${hem}`} fill="none" stroke={rib} strokeWidth="30" />
          <path d={`M240 92 Q230 190 204 ${vBottom} L204 ${hem}`} fill="none" stroke={rib} strokeWidth="30" />
          <path d={`M240 92 Q230 190 204 ${vBottom} L204 ${hem}`} fill="none" stroke={dark} strokeWidth="1.5" opacity="0.4" transform="translate(-14 0)" />
        </>
      ) : (
        <>
          {f.neck !== "crew" && f.neck !== "zip" && (
            <path d={`M168 96 L200 ${vBottom} L232 96`} fill="none" stroke={rib} strokeWidth="12" strokeLinejoin="round" />
          )}
          <rect x="193" y={f.neck === "zip" ? 72 : vBottom - 4} width="14" height={hem - (f.neck === "zip" ? 72 : vBottom - 4)} fill={rib} />
          <path d={`M200 ${f.neck === "zip" ? 72 : vBottom} V${hem}`} stroke={dark} strokeWidth="1.4" opacity="0.5" />
        </>
      )}
      {f.zipFront && (
        <>
          <path d={`M200 72 V${hem}`} stroke="#57524b" strokeWidth="4" />
          <path d={`M200 72 V${hem}`} stroke="#8d877c" strokeWidth="1.5" strokeDasharray="1.5 1.5" />
          <rect x="196" y="150" width="8" height="18" rx="2" fill="#6f6a61" />
        </>
      )}
      {buttons.map((y) => (
        <g key={y}>
          <circle cx="200" cy={y} r={f.neck === "shawl" ? 7.5 : 5} fill={f.button} />
          <circle cx="200" cy={y} r={f.neck === "shawl" ? 7.5 : 5} fill="none" stroke="#000" strokeOpacity="0.2" />
          <circle cx="198.5" cy={y - 1} r="1" fill="#000" opacity="0.25" />
          <circle cx="201.5" cy={y + 1} r="1" fill="#000" opacity="0.25" />
        </g>
      ))}
    </g>
  )
}

function Hat({ ctx }: { ctx: Ctx }) {
  const { f, main, dark, light, url, id, fill } = ctx
  const rib = `url(#${id("tx-rib")})`
  const top = f.shortHat ? 208 : 168
  const cuffH = f.shortHat ? 46 : 64
  const dome = `M114 300 C114 ${top - 10} 286 ${top - 10} 286 300 Z`
  return (
    <g transform={`translate(200 ${f.earflaps ? 290 : 280}) scale(${f.shortHat ? 1.45 : f.earflaps ? 1.1 : 1.3}) translate(-200 -280)`}>
      {f.earflaps && (
        <g>
          <path d="M122 340 L126 398 Q140 420 158 398 L170 340 Z" fill={fill} />
          <path d="M278 340 L274 398 Q260 420 242 398 L230 340 Z" fill={fill} />
          <path d="M142 410 Q140 440 134 470" stroke={main} strokeWidth="8" fill="none" strokeLinecap="round" />
          <path d="M142 410 Q140 440 134 470" stroke={dark} strokeWidth="8" fill="none" strokeDasharray="3 3" opacity="0.4" />
          <path d="M258 410 Q260 440 266 470" stroke={main} strokeWidth="8" fill="none" strokeLinecap="round" />
          <path d="M258 410 Q260 440 266 470" stroke={dark} strokeWidth="8" fill="none" strokeDasharray="3 3" opacity="0.4" />
        </g>
      )}
      <clipPath id={id("dome")}>
        <path d={dome} />
      </clipPath>
      <path d={dome} fill={f.shortHat ? rib : f.texture === "rib" ? rib : fill} />
      {f.colourwork && (
        <g clipPath={url("dome")}>
          <rect x="100" y="238" width="200" height="54" fill={`url(#${id("tx-stars")})`} />
          <rect x="100" y="236" width="200" height="4" fill={ctx.accent} />
        </g>
      )}
      <g clipPath={url("dome")} fill="none" stroke={dark} opacity="0.18" strokeWidth="2">
        <path d={`M200 ${top + 10} Q160 230 146 300`} />
        <path d={`M200 ${top + 10} Q240 230 254 300`} />
        <path d={`M200 ${top + 10} V300`} />
      </g>
      <path d={dome} fill={url("light")} />
      <rect x="108" y="292" width="184" height={cuffH} rx="8" fill={rib} />
      <rect x="108" y="292" width="184" height={cuffH} rx="8" fill={url("light")} />
      <path d={`M110 296 H290`} stroke={light} strokeOpacity="0.4" strokeWidth="1.5" />
      {f.pompom && (
        <g>
          <circle cx="200" cy={top - 4} r="34" fill={f.colourwork ? ctx.accent : main} />
          {Array.from({ length: 18 }, (_, i) => {
            const a = (i / 18) * Math.PI * 2
            return (
              <path
                key={i}
                d={`M${200 + Math.cos(a) * 8} ${top - 4 + Math.sin(a) * 8} L${200 + Math.cos(a) * 36} ${top - 4 + Math.sin(a) * 36}`}
                stroke={shade(f.colourwork ? ctx.accent : main, 0.25)}
                strokeWidth="2"
                opacity="0.5"
              />
            )
          })}
          <circle cx="200" cy={top - 4} r="34" fill={url("light")} />
        </g>
      )}
    </g>
  )
}

function Scarf({ ctx }: { ctx: Ctx }) {
  const { f, dark, light, url, id, main } = ctx
  const wide = f.texture === "garter" && !f.stripes
  const w = wide ? 104 : 78
  const pat = f.colourwork ? `url(#${id("tx-stars")})` : f.stripes ? `url(#${id("tx-stripes")})` : ctx.fill
  // Folded in half and hung: two tails joined by a rounded fold at the top.
  const lx = 200 - w + 8
  const rx = 200 - 8
  const fringe = (x: number, y: number) =>
    f.fringe &&
    Array.from({ length: Math.floor(w / 7) }, (_, i) => (
      <path
        key={`${x}-${i}`}
        d={`M${x + 4 + i * 7} ${y} q${i % 2 ? 2 : -2} 14 ${i % 3 ? 1 : -1} 26`}
        stroke={main}
        strokeWidth="3"
        strokeLinecap="round"
        fill="none"
      />
    ))
  return (
    <g transform="rotate(-3 200 260)">
      {/* back tail */}
      <rect x={lx} y="120" width={w} height="300" fill={pat} />
      <rect x={lx} y="120" width={w} height="300" fill={dark} opacity="0.12" />
      {fringe(lx, 420)}
      {/* fold */}
      <path d={`M${lx} 130 Q${lx} 70 200 70 Q${rx + w} 70 ${rx + w} 130 Z`} fill={pat} />
      <path d={`M${lx} 130 Q${lx} 70 200 70 Q${rx + w} 70 ${rx + w} 130 Z`} fill={light} opacity="0.12" />
      {/* front tail */}
      <rect x={rx} y="118" width={w} height="332" fill={pat} />
      <rect x={rx} y="118" width={w} height="332" fill={url("light")} />
      <path d={`M${rx} 120 V450`} stroke={dark} strokeWidth="6" opacity="0.15" />
      <path d={`M${rx + 10} 200 Q${rx + w / 2} 214 ${rx + w - 6} 196`} stroke={dark} strokeWidth="5" opacity="0.08" fill="none" />
      {fringe(rx, 450)}
    </g>
  )
}

function Socks({ ctx }: { ctx: Ctx }) {
  const { f, main, dark, url, id } = ctx
  const leg = f.sockLeg
  const y0 = Math.max(40, 330 - leg)
  const pat = f.colourwork ? `url(#${id("tx-stars")})` : ctx.fill
  const sock = (x: number, y: number) =>
    `M${x} ${y} L${x + 72} ${y} L${x + 72} ${y + leg} Q${x + 74} ${y + leg + 20} ${x + 98} ${y + leg + 28} L${x + 150} ${y + leg + 40} Q${x + 180} ${y + leg + 50} ${x + 170} ${y + leg + 76} Q${x + 160} ${y + leg + 96} ${x + 126} ${y + leg + 90} L${x + 44} ${y + leg + 76} Q${x} ${y + leg + 66} ${x} ${y + leg + 28} Z`
  const one = (x: number, y: number, key: string, back: boolean) => (
    <g key={key}>
      <clipPath id={id(`sock-${key}`)}>
        <path d={sock(x, y)} />
      </clipPath>
      <path d={sock(x, y)} fill={pat} />
      <g clipPath={url(`sock-${key}`)}>
        <rect x={x - 5} y={y} width="82" height="40" fill={`url(#${id("tx-rib")})`} />
        <circle cx={x + 16} cy={y + leg + 60} r="46" fill={dark} opacity="0.28" />
        <rect x={x + 142} y={y + leg} width="60" height="120" fill={dark} opacity="0.28" />
        {back && <rect x={x - 10} y={y - 10} width="260" height={leg + 120} fill="#000" opacity="0.06" />}
      </g>
      <path d={sock(x, y)} fill={url("light")} />
    </g>
  )
  return (
    <g>
      {one(150, y0 - 18, "b", true)}
      {one(96, y0 + 22, "f", false)}
      <path d={`M96 ${y0 + 22} H168`} stroke={tint(main, 0.3)} strokeWidth="2" opacity="0.5" />
    </g>
  )
}

function Blanket({ ctx }: { ctx: Ctx }) {
  const { f, main, dark, light, url, id } = ctx
  const w = f.small ? 210 : 270
  const x = 200 - w / 2
  const pat = f.stripes || f.strap ? `url(#${id("tx-stripes")})` : f.colourwork ? `url(#${id("tx-stars")})` : ctx.fill
  const top = 150
  const faceH = f.small ? 160 : 190
  const layers = f.small ? 3 : 4
  return (
    <g>
      {/* folded layers seen from the front */}
      {Array.from({ length: layers }, (_, i) => (
        <g key={i}>
          <rect x={x + (i % 2 ? 2 : -2)} y={top + faceH - 8 + i * 22} width={w} height="30" rx="14" fill={pat} />
          <rect x={x + (i % 2 ? 2 : -2)} y={top + faceH - 8 + i * 22} width={w} height="30" rx="14" fill={dark} opacity={0.1 + i * 0.04} />
        </g>
      ))}
      {f.fringe &&
        Array.from({ length: layers * 2 }, (_, i) => (
          <path
            key={i}
            d={`M${x + 4} ${top + faceH + 6 + i * 11} q-14 2 -26 ${i % 2 ? 6 : -2}`}
            stroke={main}
            strokeWidth="3"
            strokeLinecap="round"
            fill="none"
          />
        ))}
      <rect x={x} y={top} width={w} height={faceH} rx="10" fill={pat} />
      {f.texture === "waffle" && (
        <rect x={x + 10} y={top + 10} width={w - 20} height={faceH - 20} rx="6" fill="none" stroke={dark} strokeOpacity="0.3" strokeWidth="2" />
      )}
      <rect x={x} y={top} width={w} height={faceH} rx="10" fill={url("light")} />
      <path d={`M${x + 8} ${top + 3} H${x + w - 8}`} stroke={light} strokeOpacity="0.45" strokeWidth="2" />
      {f.strap && (
        <g>
          <rect x={x + w - 70} y={top - 6} width="26" height={faceH + layers * 22 + 30} rx="3" fill="#cdbb9c" />
          <rect x={x + w - 70} y={top - 6} width="26" height={faceH + layers * 22 + 30} rx="3" fill={url("light")} />
          <rect x={x + w - 74} y={top + 70} width="34" height="22" rx="3" fill="none" stroke="#8a7a5e" strokeWidth="3" />
        </g>
      )}
    </g>
  )
}

/* ------------------------------------------------------------------------ */
/* Close-up of the knit                                                      */
/* ------------------------------------------------------------------------ */

const STAR = [
  "....#....",
  "#..###..#",
  "##.#.#.##",
  ".##...##.",
  "###.#.###",
  ".##...##.",
  "##.#.#.##",
  "#..###..#",
  "....#....",
]

function KnitCloseUp({ uid, main, accent, features: f }: { uid: string; main: string; accent: string; features: Features }) {
  const sw = 34
  const sh = 28
  const cols = Math.ceil(400 / sw) + 1
  const rows = Math.ceil(500 / sh) + 1
  const ribbed = f.texture === "rib"
  const stitches: ReactNode[] = []

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      let colour = main
      if (f.colourwork) {
        const mr = (r + 2) % 12
        const mc = (c + 1) % 12
        if (mr < 9 && mc < 9 && STAR[mr][mc] === "#") colour = accent
      } else if (f.stripes && [2, 3, 7, 12, 13, 14].includes(r % 16)) {
        colour = accent
      }
      if (ribbed && c % 3 === 2) {
        // recessed purl column
        stitches.push(
          <g key={`${r}-${c}`} transform={`translate(${c * sw - 6} ${r * sh})`}>
            <ellipse cx={sw / 2} cy={sh / 2} rx={sw / 2.4} ry={sh / 4} fill={shade(colour, 0.32)} />
            <ellipse cx={sw / 2} cy={sh / 2 - 2} rx={sw / 3} ry={sh / 7} fill={shade(colour, 0.18)} />
          </g>,
        )
        continue
      }
      const x = c * sw - 6 + (r % 2 ? 0.8 : 0)
      const y = r * sh - 8
      stitches.push(
        <g key={`${r}-${c}`} transform={`translate(${x} ${y})`}>
          <ellipse cx={sw * 0.3} cy={sh * 0.62} rx={sw * 0.2} ry={sh * 0.56} transform={`rotate(-30 ${sw * 0.3} ${sh * 0.62})`} fill={colour} stroke={shade(colour, 0.3)} strokeWidth="1.2" />
          <ellipse cx={sw * 0.7} cy={sh * 0.62} rx={sw * 0.2} ry={sh * 0.56} transform={`rotate(30 ${sw * 0.7} ${sh * 0.62})`} fill={colour} stroke={shade(colour, 0.3)} strokeWidth="1.2" />
          <path d={`M${sw * 0.24} ${sh * 0.2} q2 12 5 22`} stroke={tint(colour, 0.35)} strokeWidth="1.6" fill="none" opacity="0.7" />
          <path d={`M${sw * 0.64} ${sh * 0.2} q2 12 5 22`} stroke={tint(colour, 0.35)} strokeWidth="1.6" fill="none" opacity="0.7" />
        </g>,
      )
    }
  }

  return (
    <>
      <defs>
        <radialGradient id={`${uid}-glow`} cx="0.3" cy="0.25" r="0.9">
          <stop offset="0" stopColor="#fff" stopOpacity="0.18" />
          <stop offset="0.6" stopColor="#fff" stopOpacity="0" />
          <stop offset="1" stopColor="#000" stopOpacity="0.28" />
        </radialGradient>
        <filter id={`${uid}-halo`}>
          <feTurbulence type="fractalNoise" baseFrequency="0.6" numOctaves="2" seed="7" result="n" />
          <feDisplacementMap in="SourceGraphic" in2="n" scale="5" result="d" />
          <feGaussianBlur in="d" stdDeviation="0.6" />
        </filter>
      </defs>
      <rect x="0" y="0" width="400" height="500" fill={shade(main, 0.42)} />
      <g filter={f.mohair ? `url(#${uid}-halo)` : undefined}>{stitches}</g>
      <rect x="0" y="0" width="400" height="500" fill={`url(#${uid}-glow)`} />
    </>
  )
}
