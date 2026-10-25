import { allocate, type Sen } from "@veenix/shared";
import type { ProjectDoc } from "../projects/project.model";

/** Turns payment terms into the project's client payment schedule. The first payment is due straight away. */
export function applySchedule(project: ProjectDoc, terms: { name: string; trigger: string; pct: number }[], contractSum: Sen) {
  const amounts = allocate(contractSum, terms);
  project.set("milestones", terms.map((t, i) => ({
    seq: i + 1, name: t.name, trigger: t.trigger, pct: t.pct, amount: amounts[i], status: i === 0 ? "AWAITING_PAYMENT" : "NOT_YET_DUE",
  })));
}
