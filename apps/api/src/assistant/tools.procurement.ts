import { Types } from "mongoose";
import { z } from "zod";
import {
  acceptQuoteInput, allocate, bomItemInput, formatDate, formatMoney2, formatNumber, lineTotal, PERFORMED_BY, poTermsInput, quoteInput, requestQuotesInput,
  vendorPaymentInput, withMarkup, WORK_UNITS,
} from "@veenix/shared";
import { audit } from "../audit/audit";
import { notFound, rule } from "../common/errors";
import { loadOrg } from "../orgs/org.model";
import { assertCanAccept, assertCanPay, assertTermsEditable, poWithMilestone, ProcurementService, rfqWithQuote } from "../procurement/procurement.service";
import { PurchaseOrderModel } from "../procurement/purchase-order.model";
import { RfqModel } from "../procurement/rfq.model";
import { BomService } from "../projects/bom.service";
import { loadProject, loadProjectBy } from "../projects/project.model";
import { VendorModel } from "../vendors/vendor.model";
import { defineApprovalAction, type Card } from "./pending";
import { defineTool } from "./tools";

const procurement = new ProcurementService();
const bom = new BomService();

const id = z.string().regex(/^[a-f\d]{24}$/i, "Use an id from a tool result");
const days = z.int().min(0).max(3650).nullable();

defineTool({
  name: "record_vendor_quote",
  description:
    "Record the price a vendor quoted for a package. quoteId is the invited vendor's quote row from get_project. If the vendor isn't invited on that package, ask the user instead of picking another row. A second figure from the same vendor is kept as a revision.",
  input: z.strictObject({
    quoteId: id,
    quotedPriceSen: z.int().positive(),
    leadTimeDays: days,
    warrantyMonths: days,
    notes: z.string().trim().max(4000).nullable(),
  }),
  permission: "procurement:write",
  level: "apply",
  run: async ({ quoteId, quotedPriceSen, leadTimeDays, warrantyMonths, notes }) => {
    const qid = new Types.ObjectId(quoteId);
    const rfq = await RfqModel.findOne({ "quotes._id": qid }).lean();
    const row = rfq?.quotes.find((q) => q._id.equals(qid));
    if (!rfq || !row) throw notFound("Quote");
    // Unstated lead time and warranty are 0, the existing "not given" default.
    const body = quoteInput.parse({ quotedPrice: quotedPriceSen, leadTimeDays: leadTimeDays ?? 0, warrantyMonths: warrantyMonths ?? 0, notes });
    const vendor = (await VendorModel.findById(row.vendorId).select("name").lean())?.name ?? "the vendor";
    const price = formatMoney2(quotedPriceSen);

    if (row.receivedAt) {
      await procurement.reviseQuote(qid, body);
      // A revision has no undo: the earlier offer is in the quote's history.
      return { content: `Recorded ${vendor}'s revised quote of ${price}; the earlier offer is kept in its history. To change it, open /projects/${rfq.projectId}?tab=vendors.` };
    }
    await procurement.quoteReceived(qid, body);
    const saved = (await RfqModel.findOne({ "quotes._id": qid }).lean())!.quotes.find((q) => q._id.equals(qid))!;
    return { content: `Recorded ${vendor}'s quote of ${price}.`, undo: { quoteId, receivedAt: saved.receivedAt!.toISOString() } };
  },
  undo: async (data) => {
    const d = data as { quoteId: string; receivedAt: string };
    await procurement.clearReceivedQuote(new Types.ObjectId(d.quoteId), { receivedAt: new Date(d.receivedAt) });
  },
});

// ---- Budget lines ----

const UNIT_ALIASES: Record<string, string[]> = {
  "sq ft": ["sqft", "sf", "ft2", "ft²", "square feet", "square foot", "sq feet"],
  "sq m": ["sqm", "m2", "m²", "square metre", "square metres", "square meter", "square meters"],
  // Bare "ft" or "m" could mean area or length, so they're refused and the assistant asks.
  "ft run": ["running feet", "running foot", "rft"],
  "m run": ["running metre", "running meter", "rm run"],
  point: ["points", "pt", "pts"],
  unit: ["units"],
  set: ["sets"],
  nos: ["no", "pcs", "pc", "piece", "pieces"],
  day: ["days"],
  lot: ["lump sum", "ls"],
};

/** Maps how people write units onto WORK_UNITS. Null when it isn't one of them. */
export function normalizeUnit(raw: string): string | null {
  const k = raw.toLowerCase().replace(/\./g, " ").replace(/\s+/g, " ").trim();
  if (WORK_UNITS.includes(k)) return k;
  const squashed = k.replace(/ /g, "");
  return Object.entries(UNIT_ALIASES).find(([u, a]) => a.includes(k) || u.replace(/ /g, "") === squashed)?.[0] ?? null;
}

const budgetInput = z.strictObject({
  projectId: id,
  lines: z.array(z.strictObject({
    workItemName: z.string().trim().min(1).max(120),
    workPackage: z.string().trim().min(1).max(200),
    qty: z.number().positive(),
    unit: z.string().trim().min(1).max(30),
    totalSen: z.int().positive().nullable(),
    unitCostSen: z.int().positive().nullable(),
    performedBy: z.enum(PERFORMED_BY),
  })).min(1).max(30),
});
type BudgetInput = z.infer<typeof budgetInput>;

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** Units checked, quantities fixed for lump sums, and a unit cost from the stated rate or the stated total. */
function pricedLines(input: BudgetInput) {
  return input.lines.map((l) => {
    const unit = normalizeUnit(l.unit);
    if (!unit) throw rule(`"${l.unit}" isn't a unit Veenix uses. Use one of: ${WORK_UNITS.join(", ")}`);
    const qty = unit === "lot" ? 1 : l.qty;
    // Never split a total across lines: each line's own total becomes its own unit cost.
    const unitCost = l.unitCostSen ?? (l.totalSen != null ? Math.round(l.totalSen / qty) : null);
    return { ...l, unit, qty, unitCost };
  });
}

defineApprovalAction({
  name: "budget_lines",
  description:
    "Propose budget (BOM) lines for a project. Use only figures the user stated: totalSen for a stated total, unitCostSen for a stated rate per unit, otherwise both null so the user fills the price in. Never split one total across several lines. Amounts are cost in sen; the card shows the client price after markup. workItemName is an existing work item, or a new one.",
  input: budgetInput,
  permission: "bom:write",
  deferred: false,
  validate: async (input) => {
    const [project, org] = await Promise.all([loadProject(input.projectId), loadOrg()]);
    const card: Card = { title: `Add budget lines to ${project.name}`, lines: [], changes: [], missing: [], inputs: [], link: `/projects/${input.projectId}?tab=bom` };
    pricedLines(input).forEach((l, i) => {
      const where = project.workItems.some((w) => sameName(w.name, l.workItemName)) ? l.workItemName : `${l.workItemName} (new work item)`;
      const label = `${i + 1}. ${l.workPackage}`;
      const self = l.performedBy === "SELF" ? ", done in-house" : "";
      if (l.unitCost == null) {
        card.lines.push({ label, value: `${where}: ${formatNumber(l.qty)} ${l.unit}${self}, price needed` });
        card.missing.push(`Price for ${l.workPackage}`);
        card.inputs!.push({ key: `lines.${i}.totalSen`, label: `${l.workPackage}: line total`, kind: "money" });
        return;
      }
      const cost = lineTotal(l.qty, l.unitCost);
      const stated = l.totalSen != null && l.unitCostSen == null && l.totalSen !== cost ? ` (stated ${formatMoney2(l.totalSen)})` : "";
      card.lines.push({
        label,
        value: `${where}: ${formatNumber(l.qty)} ${l.unit} × ${formatMoney2(l.unitCost)} = ${formatMoney2(cost)} cost${stated}, ${formatMoney2(withMarkup(cost, org.defaultMarkupPct))} to the client (${org.defaultMarkupPct}% markup)${self}`,
      });
    });
    return card;
  },
  apply: async (input) => {
    const projectId = new Types.ObjectId(input.projectId);
    const workItemId = async (name: string) => (await loadProject(projectId)).workItems.find((w) => sameName(w.name, name))?._id;
    const lines = pricedLines(input);
    for (const l of lines) {
      if (!(await workItemId(l.workItemName))) await bom.createWorkItem(projectId, { name: l.workItemName, description: null });
      await bom.saveBomItem(projectId, null, bomItemInput.parse({
        workItemId: String(await workItemId(l.workItemName)), workPackage: l.workPackage, description: null,
        unit: l.unit, qty: l.qty, unitCost: l.unitCost, performedBy: l.performedBy,
      }));
    }
    await audit("assistant.budget_lines_applied", "project", projectId, { lines: lines.length }, projectId);
    return { lines: lines.length };
  },
});

// ---- Accepting a quote and paying a vendor ----

const vendorName = async (vendorId: Types.ObjectId) => (await VendorModel.findById(vendorId).select("name").lean())?.name ?? "Unknown vendor";
const terms = z.array(z.strictObject({ label: z.string().trim().min(1).max(120), pct: z.int().min(1).max(100) })).min(1).max(20);
const termsText = (amount: number, rows: { label: string; pct: number }[]) => {
  const amounts = allocate(amount, rows);
  return rows.map((t, i) => `${t.label} ${t.pct}% (${formatMoney2(amounts[i])})`).join(", ");
};

defineApprovalAction({
  name: "accept_quote",
  description:
    "Accept a vendor's received quote, which creates the purchase order. terms are the vendor payment terms the user stated, totalling 100%; null if not stated, and the user fills them in on the card.",
  input: z.strictObject({ quoteId: id, terms: terms.nullable(), deliveryBy: z.iso.date().nullable(), remarks: z.string().trim().max(2000).nullable() }),
  permission: "procurement:write",
  deferred: false,
  validate: async ({ quoteId, terms, deliveryBy, remarks }) => {
    const { rfq, quote } = await rfqWithQuote(new Types.ObjectId(quoteId));
    await assertCanAccept(rfq._id, quote);
    if (terms) {
      const checked = acceptQuoteInput.safeParse({ terms, deliveryBy, remarks });
      if (!checked.success) throw rule(checked.error.issues[0].message);
    }
    const [vendor, project] = await Promise.all([vendorName(quote.vendorId), loadProject(rfq.projectId)]);
    const pkg = project.bomItems.find((b) => b._id.equals(rfq.bomItemId))?.workPackage ?? "the package";
    return {
      title: `Accept ${vendor}'s quote for ${pkg}`,
      lines: [
        { label: "Vendor", value: vendor },
        { label: "Package", value: `${pkg} (${project.name})` },
        { label: "Amount", value: formatMoney2(quote.quotedPrice) },
        ...(terms ? [{ label: "Terms", value: termsText(quote.quotedPrice, terms) }] : []),
        ...(deliveryBy ? [{ label: "Delivery by", value: formatDate(deliveryBy) }] : []),
        ...(remarks ? [{ label: "Remarks", value: remarks }] : []),
        { label: "Creates", value: "A purchase order to this vendor" },
      ],
      changes: [],
      missing: terms ? [] : ["Payment terms"],
      inputs: terms ? [] : [{ key: "terms", label: "Payment terms", kind: "terms" }],
      link: `/projects/${rfq.projectId}?tab=vendors`,
    };
  },
  apply: async ({ quoteId, terms, deliveryBy, remarks }) => procurement.acceptQuote(new Types.ObjectId(quoteId), acceptQuoteInput.parse({ terms, deliveryBy, remarks })),
});

const paymentInput = z.strictObject({
  milestoneId: id,
  paidAmountSen: z.int().positive(),
  paidDate: z.iso.date().nullable(),
  method: z.string().trim().min(1).max(40).nullable(),
  bankRef: z.string().trim().max(80).nullable(),
});

defineApprovalAction({
  name: "vendor_payment",
  description: "Record a payment made to a vendor against an invoiced PO payment milestone (milestoneId from get_project). Use the amount the user stated.",
  input: paymentInput,
  permission: "vendor_payment:write",
  deferred: false,
  validate: async ({ milestoneId, paidAmountSen, paidDate, method, bankRef }) => {
    const { po, milestone } = await poWithMilestone(new Types.ObjectId(milestoneId));
    assertCanPay(milestone, paidAmountSen);
    const vendor = await vendorName(po.vendorId);
    return {
      title: `Record a payment to ${vendor}`,
      lines: [
        { label: "PO", value: `${po.code} · ${po.description}` },
        { label: "Milestone", value: `${milestone.label} (${formatMoney2(milestone.amount)})` },
        { label: "Paying", value: formatMoney2(paidAmountSen) },
        { label: "Paid on", value: paidDate ? formatDate(paidDate) : "Today" },
        { label: "Method", value: method ?? "Bank Transfer" },
        ...(bankRef ? [{ label: "Bank ref", value: bankRef }] : []),
      ],
      changes: [],
      missing: [],
      link: `/projects/${po.projectId}?tab=vendors`,
    };
  },
  apply: async ({ milestoneId, paidAmountSen, paidDate, method, bankRef }) => {
    await procurement.recordPayment(new Types.ObjectId(milestoneId), vendorPaymentInput.parse({ paidAmount: paidAmountSen, paidDate, method: method ?? undefined, bankRef, paidFrom: null }));
    return { paid: paidAmountSen };
  },
});

// ---- Action catalogue: procurement entries, found through tool search ----

defineApprovalAction({
  name: "set_po_terms",
  description: "Change a purchase order's vendor payment terms (poId from get_project). Give the full new list, totalling 100%.",
  input: z.strictObject({ poId: id, terms }),
  permission: "procurement:write",
  validate: async ({ poId, terms }) => {
    const po = await PurchaseOrderModel.findById(poId).lean();
    if (!po) throw notFound("Purchase order");
    assertTermsEditable(po);
    const checked = poTermsInput.safeParse({ terms });
    if (!checked.success) throw rule(checked.error.issues[0].message);
    return {
      title: `Change ${po.code}'s payment terms`,
      lines: [{ label: "PO", value: `${po.code} · ${po.description} · ${await vendorName(po.vendorId)} · ${formatMoney2(po.amount)}` }],
      changes: [{ label: "Payment terms", before: po.milestones.map((m) => `${m.label} ${m.pct}% (${formatMoney2(m.amount)})`).join(", ") || "None", after: termsText(po.amount, terms) }],
      missing: [],
      link: `/projects/${po.projectId}?tab=vendors`,
    };
  },
  apply: async ({ poId, terms }) => {
    await procurement.setPoTerms(new Types.ObjectId(poId), poTermsInput.parse({ terms }));
    return { terms: terms.length };
  },
});

defineApprovalAction({
  name: "request_quotes",
  description: "Ask vendors to quote a procurement package (bomItemId from get_project, vendor ids from search_records).",
  input: z.strictObject({ bomItemId: id, vendorIds: z.array(id).min(1).max(20), respondBy: z.iso.date().nullable(), note: z.string().trim().max(1000).nullable() }),
  permission: "procurement:write",
  validate: async ({ bomItemId, vendorIds, respondBy, note }) => {
    const project = await loadProjectBy({ "bomItems._id": new Types.ObjectId(bomItemId) }, "Package");
    const pkg = project.bomItems.find((b) => b._id.equals(bomItemId))!;
    const rfq = await RfqModel.findOne({ bomItemId }).lean();
    const ids = [...(rfq?.quotes.map((q) => q.vendorId) ?? []), ...vendorIds.map((v) => new Types.ObjectId(v))];
    const vendors = await VendorModel.find({ _id: { $in: ids } }).select("name active").lean();
    if (vendorIds.some((v) => !vendors.some((x) => x._id.equals(v) && x.active))) throw rule("Pick active vendors from your list");
    const names = (list: Types.ObjectId[]) => [...new Set(list.map((v) => vendors.find((x) => x._id.equals(v))?.name ?? "Unknown vendor"))].join(", ") || "Nobody";
    const invited = rfq?.quotes.map((q) => q.vendorId) ?? [];
    return {
      title: `Ask for quotes on ${pkg.workPackage}`,
      lines: [
        { label: "Package", value: `${pkg.workPackage} (${project.name})` },
        ...(respondBy ? [{ label: "Respond by", value: formatDate(respondBy) }] : []),
        ...(note ? [{ label: "Note", value: note }] : []),
      ],
      changes: [{ label: "Invited", before: names(invited), after: names([...invited, ...vendorIds.map((v) => new Types.ObjectId(v))]) }],
      missing: [],
      link: `/projects/${project._id}?tab=vendors`,
    };
  },
  apply: async ({ bomItemId, vendorIds, respondBy, note }) => {
    await procurement.requestQuotes(new Types.ObjectId(bomItemId), requestQuotesInput.parse({ vendorIds, respondBy, note }));
    return { invited: vendorIds.length };
  },
});
