import { Injectable } from "@nestjs/common";
import { Types } from "mongoose";
import type { PurchaseOrderDto, VendorDetailDto, VendorDto, VendorInput, VendorListDto } from "@veenix/shared";
import { notFound, rule } from "../common/errors";
import { plain } from "../common/plain";
import { contains } from "../common/regex";
import { changed } from "../live/live";
import { indexEntry } from "../search/search";
import { VENDOR_COLLATION, VendorModel } from "./vendor.model";
import { PurchaseOrderModel } from "../procurement/purchase-order.model";
import { RfqModel } from "../procurement/rfq.model";
import { ProjectModel } from "../projects/project.model";

type VendorDoc = { _id: Types.ObjectId; name: string; type?: string | null; location?: string | null };

function index(v: VendorDoc) {
  indexEntry({ kind: "vendor", refId: v._id, projectId: null, title: v.name, subtitle: [v.type, v.location].filter(Boolean).join(" · ") });
  changed({ kind: "vendor", id: String(v._id) });
}

@Injectable()
export class VendorsService {
  async list(q: { q: string; trade?: string; status?: "active" | "inactive" }): Promise<VendorListDto> {
    const filter: Record<string, unknown> = {};
    if (q.trade) filter.type = contains(q.trade);
    if (q.status) filter.active = q.status === "active";
    if (q.q) filter.$or = [{ name: contains(q.q) }, { type: contains(q.q) }, { location: contains(q.q) }];
    const [vendors, all] = await Promise.all([VendorModel.find(filter).sort({ name: 1 }).lean(), VendorModel.find().select("type").lean()]);
    const pos = await PurchaseOrderModel.find({ vendorId: { $in: vendors.map((v) => v._id) } }).lean();
    const trades = [...new Set(all.flatMap((v) => (v.type ?? "").split(",").map((t) => t.trim()).filter(Boolean)))].sort();
    return {
      vendors: vendors.map((v) => ({ ...plain<VendorDto>(v), purchaseOrders: pos.filter((p) => p.vendorId.equals(v._id)).map((p) => plain<PurchaseOrderDto>(p)) })),
      trades,
    };
  }

  /** Mirrors the vendor page's old include: POs with project, RFQ and BOM line; every quote with its RFQ, project and BOM line. */
  async get(id: Types.ObjectId): Promise<VendorDetailDto> {
    const vendor = await VendorModel.findById(id).lean();
    if (!vendor) throw notFound("Vendor");
    const [pos, rfqs] = await Promise.all([
      PurchaseOrderModel.find({ vendorId: id }).sort({ issueDate: -1 }).lean(),
      RfqModel.find({ "quotes.vendorId": id }).lean(),
    ]);
    const projectIds = [...new Set([...pos, ...rfqs].map((x) => String(x.projectId)))];
    const projects = await ProjectModel.find({ _id: { $in: projectIds } }).select("-workItems -milestones").lean();
    const projectById = new Map(projects.map((p) => {
      const { bomItems, ...rest } = plain<Record<string, unknown> & { id: string; bomItems: { id: string }[] }>(p);
      return [rest.id, { project: rest, bom: new Map(bomItems.map((b) => [b.id, b])) }];
    }));
    const rfqById = new Map(rfqs.map((r) => [String(r._id), plain<Record<string, unknown> & { id: string; projectId: string; bomItemId: string }>(r)]));
    const rfqWithBom = (rfqId: string | null) => {
      const r = rfqId ? rfqById.get(rfqId) : undefined;
      if (!r) return null;
      const { quotes: _q, ...rest } = r as Record<string, unknown>;
      return { ...rest, bomItem: projectById.get(r.projectId)?.bom.get(r.bomItemId) ?? null };
    };
    return {
      ...plain<VendorDto>(vendor),
      purchaseOrders: pos.map((po) => {
        const d = plain<Record<string, unknown> & { id: string; projectId: string; rfqId: string | null; milestones: object[] }>(po);
        return { ...d, project: projectById.get(d.projectId)?.project, rfq: rfqWithBom(d.rfqId), milestones: d.milestones.map((m) => ({ ...m, poId: d.id })) };
      }),
      rfqQuotes: rfqs.flatMap((r) =>
        plain<{ id: string; quotes: { vendorId: string }[] }>(r).quotes
          .filter((q) => q.vendorId === String(id))
          .map((q) => ({ ...q, rfqId: String(r._id), rfq: { ...rfqWithBom(String(r._id))!, project: projectById.get(String(r.projectId))?.project } })),
      ),
    } as unknown as VendorDetailDto;
  }

  private async assertUniqueName(name: string, exceptId?: Types.ObjectId) {
    const dup = await VendorModel.findOne(exceptId ? { name, _id: { $ne: exceptId } } : { name }).collation(VENDOR_COLLATION).lean();
    if (dup) throw rule(`"${name}" is already in your vendor list`);
  }

  async create(input: VendorInput) {
    await this.assertUniqueName(input.name);
    const [v] = await VendorModel.create([input]);
    index(v);
    return { id: String(v._id) };
  }

  async update(id: Types.ObjectId, input: VendorInput) {
    await this.assertUniqueName(input.name, id);
    const v = await VendorModel.findOneAndUpdate({ _id: id }, { $set: input }, { new: true, lean: true });
    if (!v) throw notFound("Vendor");
    index(v);
  }

  async setActive(id: Types.ObjectId, active: boolean) {
    const r = await VendorModel.updateOne({ _id: id }, { $set: { active } });
    if (r.matchedCount === 0) throw notFound("Vendor");
    changed({ kind: "vendor", id: String(id) });
  }
}
