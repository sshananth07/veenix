import { Controller, Get, Param, Query, Res } from "@nestjs/common";
import type { Response } from "express";
import { Can, RateLimit } from "../common/decorators";
import { notFound } from "../common/errors";
import { oid } from "../common/oid";
import { DOC_TYPES, DocumentsService, type DocType } from "./documents.service";

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
}
