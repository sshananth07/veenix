import { describe, expect, it } from "vitest";
import Redis from "ioredis";
import { changed, issueTicket, readTicket, visible } from "./live";
import { tx } from "../common/tx";
import { env } from "../config/env";
import { asOrg, newId } from "../../test/ctx";

describe("live", () => {
  it("filters events by project scope", () => {
    expect(visible({ kind: "project", projectId: "p1" }, ["p1"], "u1")).toBe(true);
    expect(visible({ kind: "project", projectId: "p2" }, ["p1"], "u1")).toBe(false);
    expect(visible({ kind: "lead", id: "l1" }, ["p1"], "u1")).toBe(false);
    expect(visible({ kind: "lead", id: "l1" }, "all", "u1")).toBe(true);
  });

  it("an event with a userId only reaches that user", () => {
    const e = { kind: "assistant", userId: "u1" } as const;
    expect(visible(e, "all", "u1")).toBe(true);
    expect(visible(e, "all", "u2")).toBe(false); // owners don't see other people's chats
  });

  it("publishes only after commit", async () => {
    const org = newId();
    const sub = new Redis(env.REDIS_URL);
    const got: string[] = [];
    await sub.subscribe(`live:${org}`);
    sub.on("message", (_c, m) => got.push(m));
    await asOrg(org, () => tx(async () => { changed({ kind: "project", projectId: "p1" }); expect(got).toEqual([]); }));
    await new Promise((r) => setTimeout(r, 200));
    expect(got.map((m) => JSON.parse(m))).toEqual([{ kind: "project", projectId: "p1" }]);
    sub.disconnect();
  });

  it("round-trips a ticket carrying the scope", async () => {
    const org = newId(), p = newId();
    const u = newId();
    const t = await asOrg(org, () => issueTicket(), { projectScope: [p], userId: u });
    expect(await readTicket(t)).toEqual({ orgId: String(org), scope: [String(p)], userId: String(u) });
    await expect(readTicket("junk")).rejects.toThrow("expired");
  });
});
