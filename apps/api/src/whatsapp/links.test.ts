import { beforeAll, describe, expect, it } from "vitest";
import { redis } from "../common/redis";
import { env } from "../config/env";
import { asOrg, newId } from "../../test/ctx";
import { WhatsAppLinkModel } from "./link.model";
import { confirmLink, myLink, startLink, unlink } from "./links.service";
import { normalizePhone } from "./phone";

const org = newId(), alice = newId(), bob = newId();
const asAlice = <T>(fn: () => Promise<T>) => asOrg(org, fn, { userId: alice });
const asBob = <T>(fn: () => Promise<T>) => asOrg(org, fn, { userId: bob });

beforeAll(() => {
  env.WHATSAPP_NUMBER = "60300000000";
});

describe("WhatsApp phone linking", () => {
  it("normalizes Malaysian numbers and WhatsApp IDs to the same form", () => {
    for (const raw of ["012-345 6789", "+60123456789", "60123456789", "+60 12-345 6789", "0060123456789"]) expect(normalizePhone(raw)).toBe("60123456789");
    expect(normalizePhone("12")).toBeNull();
    expect(normalizePhone("not a phone")).toBeNull();
  });

  it("a code works once and expires", async () => {
    const { code, waUrl } = await asAlice(() => startLink());
    expect(code).toMatch(/^\d{6}$/);
    expect(waUrl).toBe(`https://wa.me/60300000000?text=LINK%20${code}`);
    expect(await redis.ttl(`walink:${code}`)).toBeLessThanOrEqual(600);

    expect(await confirmLink("+60 12-345 6789", code)).toBe(true);
    expect(await asAlice(() => myLink())).toMatchObject({ available: true, phone: "60123456789" });
    expect((await WhatsAppLinkModel.findOne({ phone: "60123456789" }).lean())!.activeOrgId).toEqual(org);
    expect(await confirmLink("60123456789", code)).toBe(false); // used

    const late = await asAlice(() => startLink());
    await redis.pexpire(`walink:${late.code}`, 1);
    await new Promise((r) => setTimeout(r, 20));
    expect(await confirmLink("60111111111", late.code)).toBe(false);
  });

  it("a number already linked to another user is refused", async () => {
    const { code } = await asBob(() => startLink());
    expect(await confirmLink("60123456789", code)).toBe(false);
    expect((await WhatsAppLinkModel.findOne({ phone: "60123456789" }).lean())!.userId).toEqual(alice);
    expect(await asBob(() => myLink())).toMatchObject({ phone: null });
  });

  it("linking needs a signed-in session: the webhook alone can't create a link without a code", async () => {
    for (const code of ["000000", "123456", "abc", ""]) expect(await confirmLink("60199999999", code)).toBe(false);
    expect(await WhatsAppLinkModel.exists({ phone: "60199999999" })).toBeNull();
  });

  it("unlink removes the user's own link only", async () => {
    await asBob(() => unlink());
    expect(await WhatsAppLinkModel.exists({ userId: alice })).not.toBeNull();
    await asAlice(() => unlink());
    expect(await asAlice(() => myLink())).toMatchObject({ phone: null, verifiedAt: null });
  });
});
