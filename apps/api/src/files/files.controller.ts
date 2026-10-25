import { Controller, Delete, Get, Param, Post } from "@nestjs/common";
import { Types } from "mongoose";
import { projectFilesInput } from "@veenix/shared";
import { Can } from "../common/decorators";
import { notFound } from "../common/errors";
import { OidParam, oid } from "../common/oid";
import { ZBody } from "../common/zod";
import { FilesService, type DownloadKind } from "./files.service";

const KINDS: DownloadKind[] = ["file", "photo", "quote", "quoterev", "invoice", "vo"];

@Controller()
export class FilesController {
  constructor(private readonly files: FilesService) {}

  @Can("file:write") @Post("projects/:id/files") upload(@OidParam("id") id: Types.ObjectId, @ZBody(projectFilesInput) b: { files: { key: string; name: string }[] }) { return this.files.upload(id, b); }
  @Can("file:write") @Delete("files/:id") remove(@OidParam("id") id: Types.ObjectId) { return this.files.remove(id); }
  @Can() @Get("downloads/logo") logo() { return this.files.download("logo"); }
  @Can("project:read") @Get("downloads/:kind/:id")
  download(@Param("kind") kind: string, @Param("id") id: string) {
    if (!KINDS.includes(kind as DownloadKind)) throw notFound("File");
    return this.files.download(kind as DownloadKind, oid(id));
  }
}
