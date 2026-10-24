import { beforeAll, describe, expect, it } from "vitest";
import { SignJWT, exportJWK, generateKeyPair, createLocalJWKSet } from "jose";
import { useJwksForTests, verifyIdentity } from "./identity";
import { env } from "../config/env";

let sign: (claims: Record<string, unknown>) => Promise<string>;

beforeAll(async () => {
  const { publicKey, privateKey } = await generateKeyPair("EdDSA", { crv: "Ed25519" });
  useJwksForTests(createLocalJWKSet({ keys: [{ ...(await exportJWK(publicKey)), kid: "t", alg: "EdDSA" }] }));
  sign = (claims) =>
    new SignJWT(claims).setProtectedHeader({ alg: "EdDSA", kid: "t" }).setSubject("user-1").setIssuer(env.AUTH_ISSUER).setAudience(env.AUTH_AUDIENCE).setExpirationTime("10m").sign(privateKey);
});

const good = { email: "a@b.my", name: "Aisyah", ev: true, mfa: true, sct: Date.now() };

describe("verifyIdentity", () => {
  it("accepts a verified, MFA-enrolled, fresh session", async () => {
    expect(await verifyIdentity(await sign(good))).toEqual({ subject: "user-1", email: "a@b.my", name: "Aisyah" });
  });
  it("refuses tokens that are missing a step", async () => {
    await expect(verifyIdentity(await sign({ ...good, mfa: false }))).rejects.toMatchObject({ code: "MFA_REQUIRED" });
    await expect(verifyIdentity(await sign({ ...good, ev: false }))).rejects.toMatchObject({ code: "EMAIL_UNVERIFIED" });
    await expect(verifyIdentity(await sign({ ...good, sct: Date.now() - 8 * 86_400_000 }))).rejects.toMatchObject({ code: "SESSION_EXPIRED" });
    await expect(verifyIdentity("not-a-jwt")).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  });
});
