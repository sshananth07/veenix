import { Types } from "mongoose";
import { can, type Role, type SearchResultDto } from "@veenix/shared";
import { ctx } from "../common/context";
import { afterCommit } from "../common/tx";
import { SearchEntryModel } from "./search-entry.model";

export type SearchKind = SearchResultDto["kind"];

export const SEARCH_INDEX_DEFINITION = {
  mappings: {
    dynamic: false,
    fields: {
      orgId: { type: "objectId" },
      projectId: { type: "objectId" },
      kind: { type: "token" },
      title: [{ type: "string" }, { type: "autocomplete", tokenization: "edgeGram", minGrams: 2, maxGrams: 15, foldDiacritics: true }],
      subtitle: { type: "string" },
      keywords: { type: "string" },
    },
  },
};

type Entry = { kind: SearchKind; refId: Types.ObjectId; projectId: Types.ObjectId | null; title: string; subtitle: string; keywords?: string };

/** Keeps the search entry for a record up to date. Runs after commit; search is derived data. */
export function indexEntry(e: Entry) {
  afterCommit(async () => {
    const fields = { projectId: e.projectId, title: e.title, subtitle: e.subtitle, keywords: e.keywords ?? "" };
    const updated = await SearchEntryModel.updateOne({ kind: e.kind, refId: e.refId }, { $set: fields });
    if (updated.matchedCount === 0) {
      await SearchEntryModel.create([{ kind: e.kind, refId: e.refId, ...fields }]).catch((err) => {
        if (err?.code !== 11000) throw err; // another request created it first
      });
    }
  });
}

export function removeEntry(kind: SearchKind, refId: Types.ObjectId) {
  afterCommit(() => SearchEntryModel.deleteOne({ kind, refId }));
}

export async function search(q: string): Promise<SearchResultDto[]> {
  const c = ctx();
  const role = c.role as Role;
  const fuzzy = { maxEdits: q.length >= 6 ? 2 : 1, prefixLength: 1 };
  const filter: object[] = [{ equals: { path: "orgId", value: c.orgId } }];
  if (c.projectScope !== "all") {
    filter.push({ compound: { should: [{ in: { path: "projectId", value: c.projectScope } }, { equals: { path: "kind", value: "vendor" } }], minimumShouldMatch: 1 } });
  }
  const mustNot: object[] = [];
  if (!can(role, "lead:read")) mustNot.push({ equals: { path: "kind", value: "lead" } });
  if (!can(role, "vendor:read")) mustNot.push({ equals: { path: "kind", value: "vendor" } });

  const rows = await SearchEntryModel.aggregate<{ kind: SearchKind; refId: Types.ObjectId; projectId: Types.ObjectId | null; title: string; subtitle: string }>([
    {
      $search: {
        index: "search_entries",
        compound: {
          should: [{ autocomplete: { query: q, path: "title", fuzzy } }, { text: { query: q, path: ["title", "subtitle", "keywords"], fuzzy } }],
          minimumShouldMatch: 1,
          filter,
          ...(mustNot.length ? { mustNot } : {}),
        },
      },
    },
    { $limit: 20 },
    { $project: { kind: 1, refId: 1, projectId: 1, title: 1, subtitle: 1 } },
  ]);
  return rows.map((r) => ({ kind: r.kind, refId: String(r.refId), projectId: r.projectId ? String(r.projectId) : null, title: r.title, subtitle: r.subtitle }));
}
