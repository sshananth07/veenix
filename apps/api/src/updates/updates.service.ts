import { Injectable } from "@nestjs/common";
import { Types } from "mongoose";
import type { SiteUpdateDto, SiteUpdateInput } from "@veenix/shared";
import { audit } from "../audit/audit";
import { ctx } from "../common/context";
import { notFound } from "../common/errors";
import { afterCommit, tx } from "../common/tx";
import { changed } from "../live/live";
import { loadProject } from "../projects/project.model";
import { claim, removeObject } from "../storage/storage";
import { UserModel } from "../users/user.model";
import { SiteUpdateModel } from "./site-update.model";

@Injectable()
export class UpdatesService {
  async add(input: SiteUpdateInput, source?: { messageId: Types.ObjectId }): Promise<{ id: string }> {
    return tx(async () => {
      const projectId = (await loadProject(input.projectId))._id; // 404 outside scope
      const photos = [];
      for (const p of input.photos) photos.push(await claim(p, "photos"));
      const [u] = await SiteUpdateModel.create([{
        projectId, kind: input.kind, text: input.text, photos: photos.map((p) => ({ path: p.path, name: p.name })),
        authorId: ctx().userId, messageId: source?.messageId ?? null,
      }]);
      await audit("update.add", "site_update", u._id, { kind: input.kind, messageId: source?.messageId }, projectId);
      changed({ kind: "project", projectId: String(projectId) });
      return { id: String(u._id) };
    });
  }

  async remove(id: Types.ObjectId) {
    await tx(async () => {
      const u = await SiteUpdateModel.findById(id).lean();
      if (!u) throw notFound("Update");
      await SiteUpdateModel.deleteOne({ _id: id });
      await audit("update.remove", "site_update", id, undefined, u.projectId);
      for (const p of u.photos) afterCommit(() => removeObject(p.path));
      changed({ kind: "project", projectId: String(u.projectId) });
    });
  }

  async list(projectId: Types.ObjectId): Promise<SiteUpdateDto[]> {
    await loadProject(projectId);
    const rows = await SiteUpdateModel.find({ projectId }).sort({ createdAt: -1 }).limit(200).lean();
    const users = await UserModel.find({ _id: { $in: rows.map((r) => r.authorId) } }).select("name").lean();
    return rows.map((r) => ({
      id: String(r._id), projectId: String(r.projectId), kind: r.kind, text: r.text, photos: r.photos.map((p) => ({ path: p.path, name: p.name })),
      authorName: users.find((u) => r.authorId?.equals(u._id))?.name ?? "", fromAssistant: !!r.messageId, createdAt: r.createdAt,
    }));
  }
}
