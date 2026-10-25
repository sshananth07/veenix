import type { InvoiceDto, PaymentMilestoneDto, ProjectCore, VendorDto } from "@veenix/shared";
import { allocate, quotationTotals } from "@veenix/shared";
import { plain } from "../common/plain";
import { loadOrg, type Org } from "../orgs/org.model";
import { UserModel } from "../users/user.model";
import { VendorModel } from "../vendors/vendor.model";
import { RfqModel } from "../procurement/rfq.model";
import { PurchaseOrderModel } from "../procurement/purchase-order.model";
import { QuotationModel } from "../quotations/quotation.model";
import { VariationOrderModel } from "../variations/variation-order.model";
import { InvoiceModel } from "../billing/invoice.model";
import { FileModel } from "../files/file.model";

type Lean = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export function toInvoiceDto(i: Lean): InvoiceDto {
  return {
    id: String(i._id), code: i.code, milestoneId: String(i.milestoneId), invoiceDate: i.invoiceDate, dueDate: i.dueDate,
    amount: i.amount, sstAmount: i.sstAmount, status: i.status,
    eInvoiceStatus: i.einvoice?.status ?? "NOT_SUBMITTED", eInvoiceUuid: i.einvoice?.uuid ?? null, eInvoiceValidatedAt: i.einvoice?.validatedAt ?? null,
  };
}

const byProject = <T extends Lean>(rows: T[], id: string) => rows.filter((r) => String(r.projectId) === id);

/** The project page payload for one or many projects, with every query batched across all of them. */
export async function buildCores(projects: Lean[]): Promise<{ cores: ProjectCore[]; org: Org }> {
  const ids = projects.map((p) => p._id);
  const [rfqs, pos, quotations, vos, invoices, files, org] = await Promise.all([
    RfqModel.find({ projectId: { $in: ids } }).sort({ createdAt: 1 }).lean(),
    PurchaseOrderModel.find({ projectId: { $in: ids } }).sort({ issueDate: 1 }).lean(),
    QuotationModel.find({ projectId: { $in: ids } }).sort({ revision: 1 }).lean(),
    VariationOrderModel.find({ projectId: { $in: ids } }).sort({ raisedAt: 1 }).lean(),
    InvoiceModel.find({ projectId: { $in: ids } }).lean(),
    FileModel.find({ projectId: { $in: ids } }).sort({ createdAt: -1 }).lean(),
    loadOrg(),
  ]);
  const vendorIds = [...pos.map((p) => p.vendorId), ...rfqs.flatMap((r) => r.quotes.map((q) => q.vendorId))];
  const userIds = projects.flatMap((p) => p.assignees.map((a: Lean) => a.userId));
  const [vendors, users] = await Promise.all([VendorModel.find({ _id: { $in: vendorIds } }).lean(), UserModel.find({ _id: { $in: userIds } }).lean()]);
  const vendorById = new Map(vendors.map((v) => [String(v._id), plain<VendorDto>(v)]));
  const userById = new Map(users.map((u) => [String(u._id), u]));
  const invoiceById = new Map(invoices.map((i) => [String(i._id), toInvoiceDto(i)]));

  const cores = projects.map((p): ProjectCore => {
    const base = plain<Lean>(p);
    const id = base.id as string;
    const bomById = new Map((base.bomItems as Lean[]).map((b) => [b.id, b]));
    const rfqDtos = byProject(rfqs, id).map((r) => {
      const d = plain<Lean>(r);
      return { ...d, bomItem: bomById.get(d.bomItemId), quotes: d.quotes.map((q: Lean) => ({ ...q, rfqId: d.id, vendor: vendorById.get(q.vendorId) })) };
    });
    const rfqById = new Map(rfqDtos.map(({ quotes: _q, bomItem: _b, ...r }: Lean) => [r.id, r]));
    return {
      ...base,
      assignees: base.assignees.map((a: Lean) => ({ ...a, name: userById.get(a.userId)?.name ?? "", email: userById.get(a.userId)?.email ?? "" })),
      milestones: base.milestones.map(({ invoiceId, ...m }: Lean) => ({ ...(m as PaymentMilestoneDto), projectId: id, invoice: invoiceId ? invoiceById.get(invoiceId) ?? null : null })),
      rfqs: rfqDtos,
      purchaseOrders: byProject(pos, id).map((po) => {
        const d = plain<Lean>(po);
        return { ...d, vendor: vendorById.get(d.vendorId), rfq: d.rfqId ? rfqById.get(d.rfqId) ?? null : null, milestones: d.milestones.map((m: Lean) => ({ ...m, poId: d.id })) };
      }),
      quotations: byProject(quotations, id).map((q) => {
        const d = plain<Lean>(q);
        const totals = quotationTotals(d.lineItems, org.sstBps);
        return { ...d, totals, termAmounts: allocate(totals.total, d.terms) };
      }),
      variationOrders: byProject(vos, id).map((v) => {
        const d = plain<Lean>(v);
        return { ...d, bomItem: d.bomItemId ? bomById.get(d.bomItemId) ?? null : null };
      }),
      files: byProject(files, id).map((f) => plain(f)),
    } as ProjectCore;
  });
  return { cores, org };
}
