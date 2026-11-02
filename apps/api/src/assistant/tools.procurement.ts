import { Types } from "mongoose";
import { z } from "zod";
import { formatMoney2, quoteInput } from "@veenix/shared";
import { notFound } from "../common/errors";
import { ProcurementService } from "../procurement/procurement.service";
import { RfqModel } from "../procurement/rfq.model";
import { VendorModel } from "../vendors/vendor.model";
import { defineTool } from "./tools";

const procurement = new ProcurementService();

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
