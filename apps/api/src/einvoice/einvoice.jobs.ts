import { createHash } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { Types } from "mongoose";
import { findSub } from "../common/fields";
import { notFound, rule } from "../common/errors";
import { redis } from "../common/redis";
import { afterCommit, tx } from "../common/tx";
import { audit } from "../audit/audit";
import { enqueue, registerJob } from "../jobs/jobs";
import { changed } from "../live/live";
import { loadOrg } from "../orgs/org.model";
import { ProjectModel } from "../projects/project.model";
import { InvoiceModel } from "../billing/invoice.model";
import { einvoiceSecrets, einvoiceSettings } from "./einvoice.settings";
import { documentDetails, errorLines, getSubmission, statusIs, submit, token } from "./myinvois";
import { buildInvoiceDocument, missingData } from "./ubl";
import { signDocument } from "./sign";

// The SDK asks for 3-5 s between Get Submission calls. A few checks in-process cover the usual
// validation time; after that the job throws and the runner's backoff takes over.
const POLL_MS = process.env.VITEST ? 0 : 4_000;
const POLLS = 5;

type InvoiceDoc = InstanceType<typeof InvoiceModel>;

async function record(invoice: InvoiceDoc, einvoice: object) {
  invoice.set("einvoice", { ...invoice.toObject().einvoice, ...einvoice });
  await invoice.save();
  changed({ kind: "project", projectId: String(invoice.projectId) });
}

registerJob<{ invoiceId: string }>("einvoice.submit", async ({ invoiceId }) => {
  const settings = await einvoiceSettings();
  if (!settings?.enabled) return;
  // Two runs of this job must never both reach LHDN (each signature differs, so LHDN wouldn't see a duplicate).
  if (!(await redis.set(`myinvois:submit:${invoiceId}`, "1", "EX", 120, "NX"))) return;
  try {
    const invoice = await InvoiceModel.findById(invoiceId);
    if (invoice?.einvoice.status !== "NOT_SUBMITTED") return; // sent already (jobs can run twice)
    const [org, project] = await Promise.all([loadOrg(), ProjectModel.findById(invoice.projectId).lean()]);
    if (!project) throw notFound("Project");
    // A minute back so clock drift never makes LHDN see the issue time as in the future.
    const input = { invoice, org, settings, project, milestoneName: findSub(project.milestones, invoice.milestoneId)?.name ?? "", issuedAt: new Date(Date.now() - 60_000) };
    const problems = missingData(input);
    if (problems.length > 0) return record(invoice, { status: "INVALID", errors: problems });

    const secrets = await einvoiceSecrets();
    const json = JSON.stringify(signDocument(buildInvoiceDocument(input), secrets));
    // ponytail: a crash between LHDN accepting and the save below leaves NOT_SUBMITTED, and the retry sends a second copy. Check Search Documents by codeNumber first if that ever happens.
    const result = await submit(settings, await token(settings, secrets), { json, hash: createHash("sha256").update(json, "utf8").digest("hex"), codeNumber: invoice.code });
    if (result.rejected || !result.uuid) return record(invoice, { status: "INVALID", errors: errorLines(result.rejected).concat(result.rejected ? [] : ["LHDN did not accept the document"]) });

    await tx(async () => {
      invoice.set("einvoice", { status: "SUBMITTED", environment: settings.environment, submissionUid: result.submissionUid, uuid: result.uuid, longId: null, validatedAt: null, errors: null });
      await invoice.save();
      await enqueue("einvoice.poll", { invoiceId });
      afterCommit(() => changed({ kind: "project", projectId: String(invoice.projectId) }));
    });
  } finally {
    await redis.del(`myinvois:submit:${invoiceId}`);
  }
});

registerJob<{ invoiceId: string }>("einvoice.poll", async ({ invoiceId }) => {
  const invoice = await InvoiceModel.findById(invoiceId);
  const settings = await einvoiceSettings();
  if (!settings || invoice?.einvoice.status !== "SUBMITTED" || !invoice.einvoice.submissionUid) return;
  // Poll the environment it was submitted to, even if the settings have since moved to production.
  const s = { ...settings, environment: (invoice.einvoice.environment as "preprod" | "prod" | null) ?? settings.environment };
  const accessToken = await token(s, await einvoiceSecrets());

  let sub = { status: "in progress", documents: [] as Awaited<ReturnType<typeof getSubmission>>["documents"] };
  for (let i = 0; i < POLLS && statusIs(sub.status, "inprogress"); i++) {
    await sleep(POLL_MS);
    sub = await getSubmission(s, accessToken, invoice.einvoice.submissionUid);
  }
  if (statusIs(sub.status, "inprogress")) throw new Error("MyInvois is still validating"); // retried with backoff

  const doc = sub.documents.find((d) => d.uuid === invoice.einvoice.uuid) ?? sub.documents[0];
  if (doc && statusIs(doc.status, "valid")) {
    await tx(async () => {
      invoice.set("einvoice", { ...invoice.toObject().einvoice, status: "VALID", uuid: doc.uuid, longId: doc.longId ?? null, validatedAt: doc.dateTimeValidated ? new Date(doc.dateTimeValidated) : new Date(), errors: null });
      // The stored PDF predates validation; re-render it so the copy clients get carries LHDN's QR code.
      invoice.set("snapshot", null);
      await invoice.save();
      await enqueue("document.snapshot", { type: "invoice", id: invoiceId });
      afterCommit(() => changed({ kind: "project", projectId: String(invoice.projectId) }));
    });
    return;
  }
  const details = doc ? await documentDetails(s, accessToken, doc.uuid) : null;
  const errors = (details?.validationResults?.validationSteps ?? []).filter((x) => statusIs(x.status, "invalid")).flatMap((x) => errorLines(x.error, x.name));
  await record(invoice, { status: "INVALID", errors: errors.length > 0 ? errors : [`LHDN marked the submission ${sub.status}`] });
});

/** Called when an invoice is generated. Without e-invoicing turned on, the invoice stays NOT_SUBMITTED. */
export async function requestSubmission(invoiceId: Types.ObjectId) {
  const settings = await einvoiceSettings();
  if (settings?.enabled) await enqueue("einvoice.submit", { invoiceId: String(invoiceId) });
}

/** Sends an invoice (again) after staff fix what LHDN rejected, or one generated before e-invoicing was on. */
export async function resubmitEinvoice(invoiceId: Types.ObjectId) {
  if (!(await einvoiceSettings())?.enabled) throw rule("Turn on e-invoicing in Settings first");
  await tx(async () => {
    const invoice = await InvoiceModel.findById(invoiceId);
    if (!invoice) throw notFound("Invoice");
    if (!["INVALID", "NOT_SUBMITTED"].includes(invoice.einvoice.status)) throw rule("This invoice is already with LHDN");
    invoice.set("einvoice", { status: "NOT_SUBMITTED" });
    await invoice.save();
    await audit("invoice.einvoice_requested", "invoice", invoice._id, {}, invoice.projectId);
    await enqueue("einvoice.submit", { invoiceId: String(invoiceId) });
    afterCommit(() => changed({ kind: "project", projectId: String(invoice.projectId) }));
  });
}
