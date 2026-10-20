export const SST_RATE = 0.08;

type Line = {
  workItemName: string | null;
  bomCost: number;
  clientPrice: number;
  seq: number;
};

export function quotationTotals(lines: { bomCost: number; clientPrice: number }[]) {
  const cost = lines.reduce((s, l) => s + l.bomCost, 0);
  const subtotal = lines.reduce((s, l) => s + l.clientPrice, 0);
  const sst = Math.round(subtotal * SST_RATE);
  const profit = subtotal - cost;
  return {
    cost,
    subtotal,
    sst,
    total: subtotal + sst,
    profit,
    marginPct: subtotal > 0 ? (profit / subtotal) * 100 : 0,
  };
}

// Groups quotation lines under their work item, keeping the order in which
// each work item first appears so the client sees Kitchen, then Bathroom...
export function groupByWorkItem<T extends Line>(lines: T[]) {
  const groups: { name: string; lines: T[]; subtotal: number; cost: number }[] = [];
  for (const line of [...lines].sort((a, b) => a.seq - b.seq)) {
    const name = line.workItemName ?? "Other work";
    let group = groups.find((g) => g.name === name);
    if (!group) {
      group = { name, lines: [], subtotal: 0, cost: 0 };
      groups.push(group);
    }
    group.lines.push(line);
    group.subtotal += line.clientPrice;
    group.cost += line.bomCost;
  }
  return groups;
}

export function unitPrice(clientPrice: number, qty: number) {
  return qty > 0 ? clientPrice / qty : clientPrice;
}

export function markupToMarginPct(markupPct: number) {
  return (markupPct / (100 + markupPct)) * 100;
}
