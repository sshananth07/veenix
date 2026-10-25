import { Controller, Delete, Patch, Post, Put } from "@nestjs/common";
import { Types } from "mongoose";
import { buildQuotationInput, clientQuestionInput, clientSignedInput, markupInput, replyInput, termsInput } from "@veenix/shared";
import { Can } from "../common/decorators";
import { OidParam } from "../common/oid";
import { ZBody } from "../common/zod";
import { QuotationsService } from "./quotations.service";

type Id = Types.ObjectId;
type Svc = QuotationsService;

@Controller()
export class QuotationsController {
  constructor(private readonly q: QuotationsService) {}

  @Can("quotation:write") @Post("projects/:id/quotations") build(@OidParam("id") id: Id, @ZBody(buildQuotationInput) b: Parameters<Svc["build"]>[1]) { return this.q.build(id, b); }
  @Can("quotation:write") @Post("quotations/:id/revisions") revise(@OidParam("id") id: Id) { return this.q.revise(id); }
  @Can("quotation:write") @Delete("quotations/:id") discard(@OidParam("id") id: Id) { return this.q.discard(id); }
  @Can("quotation:write") @Patch("quotation-lines/:lineId") line(@OidParam("lineId") id: Id, @ZBody(markupInput) b: Parameters<Svc["setLineMarkup"]>[1]) { return this.q.setLineMarkup(id, b); }
  @Can("quotation:write") @Post("quotations/:id/markup") markup(@OidParam("id") id: Id, @ZBody(markupInput) b: Parameters<Svc["applyMarkup"]>[1]) { return this.q.applyMarkup(id, b); }
  @Can("quotation:write") @Put("quotations/:id/terms") terms(@OidParam("id") id: Id, @ZBody(termsInput) b: Parameters<Svc["setTerms"]>[1]) { return this.q.setTerms(id, b); }
  @Can("quotation:send") @Post("quotations/:id/send") send(@OidParam("id") id: Id) { return this.q.send(id); }
  @Can("quotation:record") @Post("quotations/:id/viewed") viewed(@OidParam("id") id: Id) { return this.q.viewed(id); }
  @Can("quotation:record") @Post("quotations/:id/questions") question(@OidParam("id") id: Id, @ZBody(clientQuestionInput) b: Parameters<Svc["question"]>[1]) { return this.q.question(id, b); }
  @Can("quotation:record") @Post("quotations/:id/replies") reply(@OidParam("id") id: Id, @ZBody(replyInput) b: Parameters<Svc["reply"]>[1]) { return this.q.reply(id, b); }
  @Can("quotation:record") @Post("quotations/:id/accept") accept(@OidParam("id") id: Id, @ZBody(clientSignedInput) b: Parameters<Svc["accept"]>[1]) { return this.q.accept(id, b); }
}
