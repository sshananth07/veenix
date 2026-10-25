import { Controller, Delete, Post, Put } from "@nestjs/common";
import { Types } from "mongoose";
import { acceptQuoteInput, poTermsInput, quoteInput, requestQuotesInput, vendorInvoiceInput, vendorPaymentInput } from "@veenix/shared";
import { Can } from "../common/decorators";
import { OidParam } from "../common/oid";
import { ZBody } from "../common/zod";
import { ProcurementService } from "./procurement.service";

type Id = Types.ObjectId;
type Svc = ProcurementService;

@Controller()
export class ProcurementController {
  constructor(private readonly p: ProcurementService) {}

  @Can("procurement:write") @Post("bom-items/:bomItemId/rfq/invites") invite(@OidParam("bomItemId") id: Id, @ZBody(requestQuotesInput) b: Parameters<Svc["requestQuotes"]>[1]) { return this.p.requestQuotes(id, b); }
  @Can("procurement:write") @Delete("rfq-quotes/:quoteId") remove(@OidParam("quoteId") id: Id) { return this.p.removeRequest(id); }
  @Can("procurement:write") @Post("rfq-quotes/:quoteId/received") received(@OidParam("quoteId") id: Id, @ZBody(quoteInput) b: Parameters<Svc["quoteReceived"]>[1]) { return this.p.quoteReceived(id, b); }
  @Can("procurement:write") @Post("rfq-quotes/:quoteId/revisions") revise(@OidParam("quoteId") id: Id, @ZBody(quoteInput) b: Parameters<Svc["reviseQuote"]>[1]) { return this.p.reviseQuote(id, b); }
  @Can("procurement:write") @Post("rfq-quotes/:quoteId/accept") accept(@OidParam("quoteId") id: Id, @ZBody(acceptQuoteInput) b: Parameters<Svc["acceptQuote"]>[1]) { return this.p.acceptQuote(id, b); }
  @Can("procurement:write") @Put("purchase-orders/:poId/terms") terms(@OidParam("poId") id: Id, @ZBody(poTermsInput) b: Parameters<Svc["setPoTerms"]>[1]) { return this.p.setPoTerms(id, b); }
  @Can("vendor_payment:write") @Post("po-milestones/:milestoneId/invoice") invoice(@OidParam("milestoneId") id: Id, @ZBody(vendorInvoiceInput) b: Parameters<Svc["attachVendorInvoice"]>[1]) { return this.p.attachVendorInvoice(id, b); }
  @Can("vendor_payment:write") @Post("po-milestones/:milestoneId/payment") payment(@OidParam("milestoneId") id: Id, @ZBody(vendorPaymentInput) b: Parameters<Svc["recordPayment"]>[1]) { return this.p.recordPayment(id, b); }
}
