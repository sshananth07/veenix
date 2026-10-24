import { describe, expect, it } from "vitest";
import { tx, afterCommit } from "./tx";
import { nextCode } from "../counters/counters";
import { AuditModel, audit } from "../audit/audit";
import { asOrg, newId } from "../../test/ctx";

describe("transactions and counters", () => {
  const org = newId();

  it("numbers codes per organization and per Malaysian year", async () => {
    const jan1Myt = new Date("2026-12-31T16:30:00Z");
    expect(await asOrg(org, () => nextCode("QT", jan1Myt))).toBe("QT-2027-0001");
    expect(await asOrg(org, () => nextCode("QT", jan1Myt))).toBe("QT-2027-0002");
    expect(await asOrg(newId(), () => nextCode("QT", jan1Myt))).toBe("QT-2027-0001");
    expect(await asOrg(org, () => nextCode("PO"))).toBe("PO-0001");
  });

  it("never hands out the same code twice under concurrency", async () => {
    const codes = await asOrg(org, () => Promise.all(Array.from({ length: 10 }, () => nextCode("RFQ"))));
    expect(new Set(codes).size).toBe(10);
  });

  it("runs after-commit hooks only when the transaction commits", async () => {
    const ran: string[] = [];
    await asOrg(org, () => tx(async () => { await audit("test.ok", "thing", newId()); afterCommit(() => ran.push("ok")); }));
    await expect(
      asOrg(org, () => tx(async () => { await audit("test.fail", "thing", newId()); afterCommit(() => ran.push("fail")); throw new Error("rollback"); })),
    ).rejects.toThrow("rollback");
    expect(ran).toEqual(["ok"]);
    const actions = await asOrg(org, () => AuditModel.find().lean());
    expect(actions.map((a) => a.action)).toEqual(["test.ok"]);
  });
});
