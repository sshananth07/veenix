/** Digits only, with country code: `012-345 6789`, `+60123456789` and the WhatsApp ID `60123456789` all give `60123456789`. */
export function normalizePhone(raw: string): string | null {
  let d = raw.replace(/\D/g, "");
  if (d.startsWith("00")) d = d.slice(2); // international dialling prefix
  else if (d.startsWith("0")) d = `6${d}`; // a Malaysian local number
  return d.length >= 8 && d.length <= 15 ? d : null;
}
