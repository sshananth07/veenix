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

describe("job lanes", () => {
  const order: string[] = [];
  const gaveUp: string[] = [];
  registerJob<{ n: string }>("assistant.turn", async ({ n }) => {
    if (n.startsWith("fail")) throw new Error("boom");
    order.push(n);
  }, { retryDelayMs: () => 5_000, maxAttempts: 2, onGiveUp: async ({ n }, error) => { gaveUp.push(`${n}:${error}`); } });

  it("runs jobs in one lane in order, oldest first", async () => {
    await asOrg(org, () => tx(async () => { await enqueue("assistant.turn", { n: "a" }, new Date(), "c1"); await enqueue("assistant.turn", { n: "b" }, new Date(Date.now() - 1000), "c1"); }));
    await runDue();
    expect(order.filter((n) => n === "a" || n === "b")).toEqual(["a", "b"]);
  });

  it("a claim loses when another job in the lane is running", async () => {
    const [running] = await JobModel.create([{ orgId: org, type: "assistant.turn", payload: { n: "r" }, status: "running", lockedUntil: new Date(Date.now() + 60_000), lane: "c2" }]);
    const [pending] = await JobModel.create([{ orgId: org, type: "assistant.turn", payload: { n: "p" }, lane: "c2" }]);
    await runDue();
    const p = (await JobModel.findById(pending._id).lean())!;
    expect(p).toMatchObject({ status: "pending", attempts: 0 });
    expect(running).toBeDefined();
  });

  it("a failed job holds back newer jobs in its lane", async () => {
    await asOrg(org, () => tx(async () => { await enqueue("assistant.turn", { n: "fail1" }, new Date(), "c3"); await enqueue("assistant.turn", { n: "after" }, new Date(), "c3"); }));
    await runDue();
    expect(order).not.toContain("after");
    expect((await JobModel.findOne({ "payload.n": "after" }).lean())!.status).toBe("pending");
  });

  it("uses the type's retry delay and calls onGiveUp at the last attempt", async () => {
    await asOrg(org, () => tx(() => enqueue("assistant.turn", { n: "fail2" }, new Date(), "c4")));
    await runDue();
    const first = (await JobModel.findOne({ "payload.n": "fail2" }).lean())!;
    expect(first.runAt.getTime() - Date.now()).toBeLessThan(6_000);
    await JobModel.updateOne({ _id: first._id }, { $set: { runAt: new Date() } });
    await runDue();
    expect((await JobModel.findById(first._id).lean())!.status).toBe("failed");
    expect(gaveUp).toEqual(["fail2:boom"]);
  });
});
