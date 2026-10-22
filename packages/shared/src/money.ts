import Big from "big.js";

/** A whole number of sen (RM 1 = 100 sen). Every money value in Veenix is a Sen. */
export type Sen = number;

export function isSen(v: unknown): v is Sen {
  return typeof v === "number" && Number.isSafeInteger(v);
}

function roundHalfUp(b: Big): Sen {
  return Number(b.round(0, Big.roundHalfUp));
}

/** "1,234.50", "1234.5" or "RM 12" → sen. Null for blanks, negatives, text, or more than 2 decimals. */
export function parseRinggit(input: string): Sen | null {
  const s = input.replace(/^RM\s*/i, "").replace(/,/g, "").trim();
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const sen = Number(new Big(s).times(100).toFixed(0));
  return Number.isSafeInteger(sen) ? sen : null;
}

/** Form default value: 123450 → "1234.50", 120000 → "1200", null → "". */
export function senToInput(sen: Sen | null | undefined): string {
  if (sen == null) return "";
  const ringgit = new Big(sen).div(100);
  return sen % 100 === 0 ? ringgit.toFixed(0) : ringgit.toFixed(2);
}

/** qty × unit price, rounded half-up to the sen. qty may have decimals (12.5 sq ft). */
export function lineTotal(qty: number, unitSen: Sen): Sen {
  return roundHalfUp(new Big(qty).times(unitSen));
}

/** Cost marked up by a whole-number percentage: 10000 at 40% → 14000. */
export function withMarkup(costSen: Sen, markupPct: number): Sen {
  return roundHalfUp(new Big(costSen).times(100 + markupPct).div(100));
}

/** SST on a subtotal. The rate is in basis points: 800 = 8%. */
export function sstOn(subtotalSen: Sen, sstBps: number): Sen {
  return roundHalfUp(new Big(subtotalSen).times(sstBps).div(10_000));
}

/** Splits an SST-inclusive amount into the amount before SST and the SST. The two always add back up. */
export function splitSstInclusive(totalSen: Sen, sstBps: number): { exSst: Sen; sst: Sen } {
  const exSst = roundHalfUp(new Big(totalSen).times(10_000).div(10_000 + sstBps));
  return { exSst, sst: totalSen - exSst };
}

/** Splits a total across percentage rows. The last row takes the rounding remainder so the parts add up exactly. */
export function allocate(totalSen: Sen, rows: { pct: number }[]): Sen[] {
  let running = 0;
  return rows.map((r, i) => {
    const amount = i === rows.length - 1 ? totalSen - running : roundHalfUp(new Big(totalSen).times(r.pct).div(100));
    running += amount;
    return amount;
  });
}
