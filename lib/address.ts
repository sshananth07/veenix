// Malaysian postal address: up to three street lines, then "postcode city",
// then the state. Postcodes are always five digits.

export const MY_STATES = [
  "Johor",
  "Kedah",
  "Kelantan",
  "Melaka",
  "Negeri Sembilan",
  "Pahang",
  "Perak",
  "Perlis",
  "Pulau Pinang",
  "Sabah",
  "Sarawak",
  "Selangor",
  "Terengganu",
  "W.P. Kuala Lumpur",
  "W.P. Labuan",
  "W.P. Putrajaya",
] as const;

export type AddressParts = {
  addressLine1?: string | null;
  addressLine2?: string | null;
  addressLine3?: string | null;
  postcode?: string | null;
  city?: string | null;
  state?: string | null;
};

const clean = (v: string | null | undefined) => (v ?? "").trim();

// The printed lines, e.g.
//   No. 12, Jalan SS 2/24
//   Taman Bahagia
//   47300 Petaling Jaya
//   Selangor
export function addressLines(a: AddressParts) {
  const lines = [a.addressLine1, a.addressLine2, a.addressLine3].map(clean).filter(Boolean);
  const cityLine = [clean(a.postcode), clean(a.city)].filter(Boolean).join(" ");
  if (cityLine) lines.push(cityLine);
  if (clean(a.state)) lines.push(clean(a.state));
  return lines;
}

export function composeAddress(a: AddressParts) {
  return addressLines(a).join(", ");
}

export function hasStructuredAddress(a: AddressParts) {
  return !!(clean(a.addressLine1) && clean(a.postcode) && clean(a.city) && clean(a.state));
}

export const isPostcode = (v: string) => /^\d{5}$/.test(v);

// Reads the address fields out of a form. A lead can be saved with a partial
// address (only what is known so far); a project needs the full set.
export function parseAddress(formData: FormData, required: boolean) {
  const get = (k: string) => String(formData.get(k) ?? "").trim();
  const parts = {
    addressLine1: get("addressLine1") || null,
    addressLine2: get("addressLine2") || null,
    addressLine3: get("addressLine3") || null,
    postcode: get("postcode") || null,
    city: get("city") || null,
    state: get("state") || null,
  };

  if (required) {
    if (!parts.addressLine1) return { ok: false, error: "Address line 1 is required (unit or house number, building)" } as const;
    if (!parts.postcode) return { ok: false, error: "Postcode is required" } as const;
    if (!parts.city) return { ok: false, error: "City is required" } as const;
    if (!parts.state) return { ok: false, error: "Choose a state" } as const;
  }
  if (parts.postcode && !isPostcode(parts.postcode)) return { ok: false, error: "Postcode must be 5 digits, e.g. 47300" } as const;
  if (parts.state && !(MY_STATES as readonly string[]).includes(parts.state)) return { ok: false, error: "Choose a valid state" } as const;

  return { ok: true, parts, siteAddress: composeAddress(parts) || null } as const;
}
