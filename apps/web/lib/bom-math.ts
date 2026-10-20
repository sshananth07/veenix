export function calcBomTotal(input: {
  qty: number;
  unitCost: number;
  materials?: { qty: number; unitCost: number }[];
}) {
  const base = Math.round(input.qty * input.unitCost);
  const materials = (input.materials ?? []).reduce((s, m) => s + Math.round(m.qty * m.unitCost), 0);
  return { base, materials, total: base + materials };
}
