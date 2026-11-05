import { Controller, Post } from "@nestjs/common";
import { Types } from "mongoose";
import { clientPaymentInput, scheduleInput } from "@veenix/shared";
import { Can } from "../common/decorators";
import { OidParam } from "../common/oid";
import { ZBody } from "../common/zod";
import { resubmitEinvoice } from "../einvoice/einvoice.jobs";
import { BillingService } from "./billing.service";

type Id = Types.ObjectId;

@Controller()
export class BillingController {
  constructor(private readonly billing: BillingService) {}

  @Can("billing:write") @Post("projects/:id/payment-schedule") schedule(@OidParam("id") id: Id, @ZBody(scheduleInput) b: Parameters<BillingService["createSchedule"]>[1]) { return this.billing.createSchedule(id, b); }
  @Can("billing:write") @Post("milestones/:milestoneId/invoice") invoice(@OidParam("milestoneId") id: Id) { return this.billing.generateInvoice(id); }
  @Can("billing:mark_paid") @Post("invoices/:id/payments") pay(@OidParam("id") id: Id, @ZBody(clientPaymentInput) b: Parameters<BillingService["recordPayment"]>[1]) { return this.billing.recordPayment(id, b); }
  @Can("billing:mark_paid") @Post("invoices/:id/payments/:paymentId/reverse") reverse(@OidParam("id") id: Id, @OidParam("paymentId") paymentId: Id) { return this.billing.reversePayment(id, paymentId); }
  @Can("einvoice:submit") @Post("invoices/:id/einvoice") einvoice(@OidParam("id") id: Id) { return resubmitEinvoice(id); }
}
