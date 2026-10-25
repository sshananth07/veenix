import type { TermRow } from "@veenix/shared";

export { TERM_TEMPLATES, allocate, type TermRow } from "@veenix/shared";

// Reads termName / termTrigger / termPct triples from a form. The API checks the rows.
export function parseTermRows(formData: FormData) {
  const names = formData.getAll("termName").map(String);
  const triggers = formData.getAll("termTrigger").map(String);
  const pcts = formData.getAll("termPct").map(String);

  const rows: TermRow[] = [];
  for (let i = 0; i < names.length; i++) {
    const name = names[i].trim();
    if (!name && !pcts[i]) continue;
    rows.push({ name, trigger: (triggers[i] ?? "").trim(), pct: Number(pcts[i]) });
  }
  return { ok: true, rows } as const;
}
