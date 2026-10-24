import { beforeAll, describe, expect, it } from "vitest";
import mongoose from "mongoose";
import { SearchEntryModel } from "./search-entry.model";
import { SEARCH_INDEX_DEFINITION, indexEntry, search } from "./search";
import { asOrg, newId } from "../../test/ctx";

const org = newId(), p1 = newId(), p2 = newId();

async function waitFor(fn: () => Promise<boolean>, ms = 60_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn().catch(() => false)) return;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error("search index never became ready");
}

beforeAll(async () => {
  await SearchEntryModel.createCollection();
  await mongoose.connection.collection("search_entries").createSearchIndex({ name: "search_entries", definition: SEARCH_INDEX_DEFINITION });
  await asOrg(org, async () => {
    indexEntry({ kind: "project", refId: p1, projectId: p1, title: "Wawasan Interior Condo Reno", subtitle: "PRJ-2026-0001" });
    indexEntry({ kind: "project", refId: p2, projectId: p2, title: "Taman Bahagia Kitchen", subtitle: "PRJ-2026-0002" });
    indexEntry({ kind: "lead", refId: newId(), projectId: null, title: "Wawasan lead", subtitle: "L-2026-0001" });
  });
  await waitFor(async () => (await asOrg(org, () => search("Wawasan"))).length >= 2);
}, 90_000);

describe("search", () => {
  it("tolerates typos", async () => {
    const r = await asOrg(org, () => search("Wawsan"));
    expect(r.map((x) => x.title)).toContain("Wawasan Interior Condo Reno");
  });
  it("hides leads and unassigned projects from a project manager", async () => {
    const r = await asOrg(org, () => search("Wawasan"), { role: "project_manager", projectScope: [p2] });
    expect(r).toEqual([]);
    // ...while their assigned project is still found, so the empty result above isn't a filter that matches nothing.
    const own = await asOrg(org, () => search("Taman"), { role: "project_manager", projectScope: [p2] });
    expect(own.map((x) => x.title)).toEqual(["Taman Bahagia Kitchen"]);
  });
  it("never crosses organizations", async () => {
    expect(await asOrg(newId(), () => search("Wawasan"))).toEqual([]);
  });
});
