import { createHash } from "node:crypto";
import { Types } from "mongoose";
import { registerJob } from "../jobs/jobs";
import { newKey, putObject } from "../storage/storage";
import { QuotationModel } from "../quotations/quotation.model";
import { InvoiceModel } from "../billing/invoice.model";
import { DocumentModel } from "./document.model";
import { DocumentsService, type DocType } from "./documents.service";

const docs = new DocumentsService();

/** Renders a document, stores the PDF and records it with its SHA-256. */
export async function storeDocument(type: DocType, id: Types.ObjectId, opts: { vendorId?: string } = {}) {
  const { buffer, filename, projectId } = await docs.render(type, id, opts);
  const key = newKey("documents", ".pdf");
  await putObject(key, buffer, "application/pdf");
  const sha256 = createHash("sha256").update(buffer).digest("hex");
  const [doc] = await DocumentModel.create([{ type, refId: id, projectId, filename, key, sha256 }]);
  return { documentId: doc._id, key, sha256, filename, projectId };
}

/** The frozen copy for sent quotations and invoices (made now if the snapshot job hasn't run yet); a new stored render otherwise. */
export async function storedFor(type: DocType, id: Types.ObjectId, opts: { vendorId?: string } = {}) {
  if (type !== "quotation" && type !== "invoice") return storeDocument(type, id, opts);
  const Model = (type === "quotation" ? QuotationModel : InvoiceModel) as typeof QuotationModel;
  const rec = await Model.findById(id).select("status snapshot").lean();
  // A draft renders fresh each time. Its stored copy must never stand in for the sent version later.
  if (type === "quotation" && rec?.status === "DRAFT") return storeDocument(type, id, opts);
  if (rec?.snapshot?.key) {
    const existing = await DocumentModel.findOne({ key: rec.snapshot.key }).lean();
    if (existing) return { documentId: existing._id, key: existing.key, filename: existing.filename, projectId: existing.projectId };
  }
  const doc = await storeDocument(type, id, opts);
  // Becomes the snapshot unless the job got there first.
  await Model.updateOne({ _id: id, snapshot: null }, { $set: { snapshot: { key: doc.key, sha256: doc.sha256 } } });
  const won = await Model.findById(id).select("snapshot").lean();
  if (won?.snapshot?.key && won.snapshot.key !== doc.key) return storedFor(type, id, opts);
  return doc;
}

registerJob<{ type: "quotation" | "invoice"; id: string }>("document.snapshot", async ({ type, id }) => {
  const refId = new Types.ObjectId(id);
  const Model = type === "quotation" ? QuotationModel : InvoiceModel;
  const current = await (Model as typeof InvoiceModel).findById(refId).select("snapshot").lean();
  if (current?.snapshot?.key) return; // already done (the job may run twice)
  const { key, sha256 } = await storeDocument(type, refId);
  // Only if still empty: a send may have frozen its copy while this job waited.
  await (Model as typeof InvoiceModel).updateOne({ _id: refId, snapshot: null }, { $set: { snapshot: { key, sha256 } } });
});
