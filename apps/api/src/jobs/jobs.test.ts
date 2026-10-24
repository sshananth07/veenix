import { describe, expect, it } from "vitest";
import { JobModel } from "./job.model";
import { enqueue, registerJob, runDue } from "./jobs";
import { tx } from "../common/tx";
import { ctx } from "../common/context";
import { asOrg, newId } from "../../test/ctx";

const org = newId();
const seen: string[] = [];
registerJob("mail.send", async (p: { to: string }) => {
  if (p.to === "fail@x.my") throw new Error("smtp down");
  seen.push(`${p.to}:${String(ctx().orgId)}`);
});

describe("jobs", () => {
  it("only exists when the transaction commits", async () => {
    await expect(asOrg(org, () => tx(async () => { await enqueue("mail.send", { to: "rolled@x.my" }); throw new Error("no"); }))).rejects.toThrow("no");
    expect(await JobModel.countDocuments({ "payload.to": "rolled@x.my" })).toBe(0);
  });

  it("runs handlers in the job's organization and backs off failures", async () => {
    await asOrg(org, () => tx(async () => { await enqueue("mail.send", { to: "ok@x.my" }); await enqueue("mail.send", { to: "fail@x.my" }); }));
    await runDue();
    expect(seen).toContain(`ok@x.my:${org}`);
    const failed = await JobModel.findOne({ "payload.to": "fail@x.my" }).lean();
    expect(failed).toMatchObject({ status: "pending", attempts: 1, lastError: "smtp down" });
    expect(failed!.runAt.getTime()).toBeGreaterThan(Date.now());
  });
});
