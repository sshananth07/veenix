/** Digits only; a leading 0 becomes Malaysia's 60. */
export function waNumber(phone: string | null): string {
  const digits = (phone ?? "").replace(/\D/g, "");
  return digits.startsWith("0") ? `60${digits.slice(1)}` : digits;
}

export function whatsappLink(phone: string | null, text: string): string {
  return `https://wa.me/${waNumber(phone)}?text=${encodeURIComponent(text)}`;
}
