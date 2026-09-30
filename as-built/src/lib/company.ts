// The shop's legal details, used on the terms, privacy and contact pages.
// Fields set to null aren't known yet and show as "to be added".
export const COMPANY = {
  name: "Nordaloom SIA",
  address: ["Liela iela 12", "Kuldiga, LV-3301", "Latvia"],
  registrationNumber: null as string | null,
  vatNumber: null as string | null,
  /** Where the shop's data is hosted (for the privacy page). */
  hosting: null as string | null,
}

export const TO_BE_ADDED = "to be added"

/** Date shown as "last updated" on the policy pages. */
export const POLICIES_UPDATED = "30 September 2026"
