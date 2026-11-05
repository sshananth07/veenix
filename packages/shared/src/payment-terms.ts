// Client payment terms: what triggers each payment and its share of the
// contract sum. Shared by the quotation (terms) and the project schedule
// (milestones) so both are built and validated the same way.

export type TermRow = { name: string; trigger: string; pct: number };

export const TERM_TEMPLATES: { key: string; label: string; hint: string; rows: TermRow[] }[] = [
  {
    key: "simple",
    label: "Deposit + completion",
    hint: "Small jobs",
    rows: [
      { name: "Deposit", trigger: "On acceptance of quotation", pct: 30 },
      { name: "Completion", trigger: "On completion and handover", pct: 70 },
    ],
  },
  {
    key: "three",
    label: "3 stages",
    hint: "Most residential jobs",
    rows: [
      { name: "Deposit", trigger: "On acceptance of quotation", pct: 30 },
      { name: "Progress payment", trigger: "On completion of major works", pct: 50 },
      { name: "Completion", trigger: "On completion and handover", pct: 20 },
    ],
  },
  {
    key: "five",
    label: "5 stages with retention",
    hint: "Full fit-out",
    rows: [
      { name: "Deposit", trigger: "On acceptance of quotation", pct: 30 },
      { name: "M&E complete", trigger: "M&E works done", pct: 30 },
      { name: "Ceiling & tiling done", trigger: "Ceiling and tiling complete", pct: 25 },
      { name: "Handover & keys", trigger: "Handover", pct: 10 },
      { name: "Retention release", trigger: "6 months after handover (DLP)", pct: 5 },
    ],
  },
];
/** What an invoice has collected (SST included). Invoices marked paid before payments were itemised count in full. */
export function invoicePaid(i: { status: string; amount: number; sstAmount: number; payments?: { amount: number; reversedAt?: Date | null }[] | null }): number {
  const payments = i.payments ?? [];
  if (payments.length === 0 && i.status === "PAID") return i.amount + i.sstAmount;
  return payments.filter((p) => !p.reversedAt).reduce((s, p) => s + p.amount, 0);
}

/** What a client milestone has collected. Milestones paid before part payments existed have no paidAmount. */
export function milestoneCollected(m: { status: string; amount: number; paidAmount?: number | null }): number {
  return m.paidAmount ?? (m.status === "PAID" ? m.amount : 0);
}
