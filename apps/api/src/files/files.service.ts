import { Injectable } from "@nestjs/common";
import { Types } from "mongoose";
import { ctx } from "../common/context";
import { notFound } from "../common/errors";
import { afterCommit, tx } from "../common/tx";
import { changed } from "../live/live";
import { claim, downloadUrl, removeObject } from "../storage/storage";
import { loadProject, ProjectModel } from "../projects/project.model";
import { RfqModel } from "../procurement/rfq.model";
import { PurchaseOrderModel } from "../procurement/purchase-order.model";
import { VariationOrderModel } from "../variations/variation-order.model";
import { loadOrg } from "../orgs/org.model";
import { FileModel } from "./file.model";

type Id = Types.ObjectId;
export type DownloadKind = "file" | "photo" | "quote" | "quoterev" | "invoice" | "vo";

@Injectable()
export class FilesService {
  async upload(projectId: Id, input: { files: { key: string; name: string }[] }) {
    await loadProject(projectId); // 404 outside scope
    // Checked one by one; the first bad file stops the whole upload.
    const claimed = [];
    for (const f of input.files) claimed.push(await claim(f, "files"));
    await FileModel.create(claimed.map((c) => ({ projectId, name: c.name, path: c.path, size: c.size, contentType: c.contentType, uploadedBy: ctx().userId })));
    changed({ kind: "project", projectId: String(projectId) });
  }

  async remove(fileId: Id) {
    await tx(async () => {
      const file = await FileModel.findById(fileId).lean();
      if (!file) throw notFound("File");
      await FileModel.deleteOne({ _id: fileId });
      afterCommit(() => removeObject(file.path));
      changed({ kind: "project", projectId: String(file.projectId) });
    });
  }

  /** A 5-minute link to a stored file. The owning record is read through the tenant plugin, so access follows project scope. */
  async download(kind: DownloadKind | "logo", id?: Id): Promise<{ url: string }> {
    const found = await this.locate(kind, id);
    if (!found?.key) throw notFound("File");
    return { url: await downloadUrl(found.key, found.name ?? "file") };
  }

  private async locate(kind: DownloadKind | "logo", id?: Id): Promise<{ key: string | null | undefined; name?: string | null } | null> {
    switch (kind) {
      case "logo": {
        const org = await loadOrg();
        return { key: org.logoPath, name: "logo" };
      }
      case "file": {
        const f = await FileModel.findById(id).lean();
        return f && { key: f.path, name: f.name };
      }
      case "photo": {
        const p = await ProjectModel.findById(id).select("photoPath").lean();
        return p && { key: p.photoPath, name: "photo" };
      }
      case "quote": {
        const r = await RfqModel.findOne({ "quotes._id": id }).lean();
        const q = r?.quotes.find((x) => x._id.equals(id!));
        return q ? { key: q.attachmentPath, name: q.attachmentName } : null;
      }
      case "quoterev": {
        const r = await RfqModel.findOne({ "quotes.revisions._id": id }).lean();
        const rev = r?.quotes.flatMap((q) => q.revisions).find((x) => x._id.equals(id!));
        return rev ? { key: rev.attachmentPath, name: rev.attachmentName } : null;
      }
      case "invoice": {
        const po = await PurchaseOrderModel.findOne({ "milestones._id": id }).lean();
        const m = po?.milestones.find((x) => x._id.equals(id!));
        return m ? { key: m.invoicePath, name: m.invoiceName } : null;
      }
      case "vo": {
        const vo = await VariationOrderModel.findById(id).lean();
        return vo && { key: vo.attachmentPath, name: vo.attachmentName };
      }
    }
  }
}
