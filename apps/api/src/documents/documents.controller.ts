import { Controller, Get, Param, Post, Query, Res } from "@nestjs/common";
import type { Response } from "express";
import { documentEmailInput, documentShareInput } from "@veenix/shared";
import { Can, RateLimit } from "../common/decorators";
import { ctx } from "../common/context";
import { notFound } from "../common/errors";
import { oid } from "../common/oid";
import { tx } from "../common/tx";
import { ZBody } from "../common/zod";
import { loadOrg } from "../orgs/org.model";
import { queueMail } from "../mail/mail";
import { shareUrl } from "../storage/storage";
import { DocumentModel } from "./document.model";
import { DOC_TYPES, DocumentsService, type DocType } from "./documents.service";
import { storedFor } from "./stored";
import { whatsappLink } from "./whatsapp";

export function docType(t: string): DocType {
  if (!DOC_TYPES.includes(t as DocType)) throw notFound("Document");
  return t as DocType;
}

@Controller("documents")
export class DocumentsController {
  constructor(private readonly docs: DocumentsService) {}

  @Can("project:read") @RateLimit(30) @Get(":type/:id/pdf")
  async pdf(@Param("type") type: string, @Param("id") id: string, @Query("vendorId") vendorId: string | undefined, @Query("download") download: string | undefined, @Res() res: Response) {
    const { buffer, filename } = await this.docs.pdf(docType(type), oid(id), { vendorId });
    res.set({ "Content-Type": "application/pdf", "Content-Disposition": `${download === "1" ? "attachment" : "inline"}; filename="${filename}"` }).send(buffer);
  }

  @Can("document:send") @RateLimit(30) @Post(":type/:id/email")
  async email(@Param("type") type: string, @Param("id") id: string, @ZBody(documentEmailInput) body: { to: string; message: string | null }) {
    const stored = await storedFor(docType(type), oid(id));
    const org = await loadOrg();
    await tx(() => queueMail({
      to: body.to,
      subject: `${stored.filename.replace(/\.pdf$/, "")} from ${org.companyName}`,
      text: `${body.message ?? "Please find the document attached."}\n\n${org.companyName}\n${org.companyPhone}`,
      attachments: [{ filename: stored.filename, key: stored.key, contentType: "application/pdf" }],
      documentId: String(stored.documentId),
    }));
    return { queued: true };
  }

  @Can("document:send") @RateLimit(30) @Post(":type/:id/share")
  async share(@Param("type") type: string, @Param("id") id: string, @ZBody(documentShareInput) body: { phone: string | null }) {
    const stored = await storedFor(docType(type), oid(id));
    const url = await shareUrl(stored.key, stored.filename);
    const org = await loadOrg();
    await DocumentModel.updateOne({ _id: stored.documentId }, { $push: { sends: { channel: "whatsapp", to: body.phone, by: ctx().userId } } });
    return { url, whatsappUrl: whatsappLink(body.phone, `${stored.filename.replace(/\.pdf$/, "")} from ${org.companyName}: ${url}`) };
  }
}
