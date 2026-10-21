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