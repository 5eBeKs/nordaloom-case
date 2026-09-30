// The size guide. Measurements in centimetres. Garment measurements are taken
// flat and doubled, on our regular fit; each product's "Fit & details" says
// when a piece is cut larger or longer.

export type SizeTable = {
  key: string
  title: string
  intro: string
  columns: string[]
  rows: (string | number)[][]
  note?: string
}

export const SIZE_TABLES: Record<string, SizeTable> = {
  sweaters: {
    key: "sweaters",
    title: "Sweaters",
    intro: "Our regular fit leaves a little room to layer a shirt underneath. Relaxed and oversized pieces say so on their page.",
    columns: ["Size", "To fit chest", "Chest of the sweater", "Length", "Sleeve"],
    rows: [
      ["XS", "80–86", 96, 64, 58],
      ["S", "86–92", 102, 66, 60],
      ["M", "92–100", 110, 68, 62],
      ["L", "100–108", 118, 70, 64],
      ["XL", "108–116", 126, 72, 65],
    ],
    note: "Chest of the sweater is measured all the way round, just under the arms. Length is from the highest point of the shoulder to the hem.",
  },
  cardigans: {
    key: "cardigans",
    title: "Cardigans",
    intro: "Cardigans are cut a touch roomier than our sweaters, to wear open or over a knit. Cropped and oversized styles say so on their page.",
    columns: ["Size", "To fit chest", "Chest of the cardigan", "Length", "Sleeve"],
    rows: [
      ["XS", "80–86", 98, 60, 58],
      ["S", "86–92", 104, 62, 60],
      ["M", "92–100", 112, 64, 62],
      ["L", "100–108", 120, 66, 64],
      ["XL", "108–116", 128, 68, 65],
    ],
    note: "Chest is measured buttoned, all the way round, just under the arms.",
  },
  hats: {
    key: "hats",
    title: "Hats",
    intro: "Our hats come in one size. The rib stretches comfortably, and a turn-up lets you wear them deeper or shallower.",
    columns: ["Size", "Fits head circumference"],
    rows: [["One size", "54–60"]],
    note: "Measure around your head, just above the eyebrows and ears.",
  },
  mittens: {
    key: "mittens",
    title: "Mittens",
    intro: "Two sizes. If you're between them, take the larger — mittens should leave a little air around the fingers to stay warm.",
    columns: ["Size", "Hand circumference", "Length of the mitten"],
    rows: [
      ["S/M", "17–19", 24],
      ["M/L", "19–22", 26],
    ],
    note: "Measure around your hand at the knuckles, without the thumb.",
  },
  socks: {
    key: "socks",
    title: "Socks",
    intro: "Sized by European shoe size. Wool relaxes a little with wear, so if you're between sizes, take the smaller.",
    columns: ["Size (EU shoe)", "Foot length"],
    rows: [
      ["36–38", "22.5–24"],
      ["39–41", "24.5–26"],
      ["42–44", "26.5–28"],
      ["45–47", "28.5–30"],
    ],
    note: "Stand on a sheet of paper and measure from your heel to the tip of your longest toe.",
  },
}

/** Which size table belongs to a category (none for scarves and blankets). */
export const sizeTableFor = (categorySlug: string): SizeTable | undefined => SIZE_TABLES[categorySlug]

export const HOW_TO_MEASURE = [
  { title: "Chest", text: "Around the fullest part of your chest, under the arms, with the tape level and not too tight." },
  { title: "Length", text: "From the highest point of the shoulder, next to the collar, straight down to the hem." },
  { title: "Sleeve", text: "From the shoulder seam to the end of the cuff, with the arm hanging relaxed." },
  { title: "Head", text: "Around your head, just above the eyebrows and ears." },
  { title: "Hand", text: "Around your hand at the knuckles, leaving the thumb out." },
  { title: "Foot", text: "From the back of the heel to the tip of your longest toe, standing up." },
]
