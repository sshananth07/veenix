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

// Splits a total across the terms. The last term takes the rounding
// remainder so the parts always add up to the total exactly.
export function allocate(total: number, rows: { pct: number }[]) {
  let running = 0;
  return rows.map((r, i) => {
    const amount = i === rows.length - 1 ? total - running : Math.round((total * r.pct) / 100);
    running += amount;
    return amount;
  });
}

// Reads termName / termTrigger / termPct triples from a form.
export function parseTermRows(formData: FormData) {
  const names = formData.getAll("termName").map(String);
  const triggers = formData.getAll("termTrigger").map(String);
  const pcts = formData.getAll("termPct").map(String);

  const rows: TermRow[] = [];
  for (let i = 0; i < names.length; i++) {
    const name = names[i].trim();
    if (!name && !pcts[i]) continue;
    const pct = Number(pcts[i]);
    if (!name) return { ok: false, error: "Every payment term needs a name" } as const;
    if (!Number.isInteger(pct) || pct < 1 || pct > 100) return { ok: false, error: `"${name}" needs a percentage between 1 and 100` } as const;
    rows.push({ name, trigger: (triggers[i] ?? "").trim() || "-", pct });
  }
  if (rows.length === 0) return { ok: false, error: "Add at least one payment term" } as const;
  const sum = rows.reduce((s, r) => s + r.pct, 0);
  if (sum !== 100) return { ok: false, error: `Payment terms add up to ${sum}%. They must total 100%.` } as const;
  return { ok: true, rows } as const;
}
