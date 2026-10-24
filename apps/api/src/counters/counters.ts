import { Schema, Types, model } from "mongoose";
import { mytYear } from "@veenix/shared";
import { ctx } from "../common/context";

// Not tenant-scoped through the plugin: the org is part of the _id.
const counterSchema = new Schema({ _id: { type: String, required: true }, seq: { type: Number, required: true } }, { collection: "counters", versionKey: false });
export const CounterModel = model("Counter", counterSchema);

const YEARLY = { L: true, PRJ: true, QT: true, INV: true, RFQ: false, PO: false, VO: false } as const;
export type CodeKind = keyof typeof YEARLY;

/** L-2026-0001, PRJ-2026-0001, QT-2026-0001, INV-2026-0001, RFQ-0001, PO-0001, VO-0001: per organization, atomic. */
export async function nextCode(kind: CodeKind, now = new Date()): Promise<string> {
  const year = YEARLY[kind] ? mytYear(now) : 0;
  const doc = await CounterModel.findOneAndUpdate(
    { _id: `${ctx().orgId}:${kind}:${year}` },
    { $inc: { seq: 1 } },
    { upsert: true, new: true, lean: true },
  );
  const n = String(doc!.seq).padStart(4, "0");
  return year ? `${kind}-${year}-${n}` : `${kind}-${n}`;
}

/** Makes the next code follow on from codes that already exist (used by the migration). */
export async function raiseCounter(orgId: Types.ObjectId, kind: CodeKind, year: number, atLeast: number) {
  await CounterModel.updateOne({ _id: `${orgId}:${kind}:${YEARLY[kind] ? year : 0}` }, { $max: { seq: atLeast } }, { upsert: true });
}
