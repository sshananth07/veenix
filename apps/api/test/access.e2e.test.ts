import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { Controller, Get, type INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { APP_FILTER, APP_GUARD } from "@nestjs/core";
import { ClsModule } from "nestjs-cls";
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair } from "jose";
import { AccessGuard } from "../src/auth/access.guard";
import { ErrorFilter } from "../src/common/error.filter";
import { Can } from "../src/common/decorators";
import { ctx } from "../src/common/context";
import { useJwksForTests } from "../src/auth/identity";
import { MembershipModel } from "../src/orgs/membership.model";
import { UserModel } from "../src/users/user.model";
import { env } from "../src/config/env";
import { newId } from "./ctx";

@Controller()
class ProbeController {
  @Can("bom:write") @Get("probe") probe() { return { role: ctx().role }; }
  @Get("unguarded") unguarded() { return { ok: true }; }
}

let app: INestApplication;
let token: (claims?: Record<string, unknown>) => Promise<string>;
const orgId = newId();

beforeAll(async () => {
  const { publicKey, privateKey } = await generateKeyPair("EdDSA", { crv: "Ed25519" });
  useJwksForTests(createLocalJWKSet({ keys: [{ ...(await exportJWK(publicKey)), kid: "t", alg: "EdDSA" }] }));
  token = (claims = {}) =>
    new SignJWT({ email: "pm@x.my", name: "PM", ev: true, mfa: true, sct: Date.now(), ...claims })
      .setProtectedHeader({ alg: "EdDSA", kid: "t" }).setSubject("sub-pm").setIssuer(env.AUTH_ISSUER).setAudience(env.AUTH_AUDIENCE).setExpirationTime("10m").sign(privateKey);

  const mod = await Test.createTestingModule({
    imports: [ClsModule.forRoot({ global: true, middleware: { mount: true } })],
    controllers: [ProbeController],
    providers: [{ provide: APP_GUARD, useClass: AccessGuard }, { provide: APP_FILTER, useClass: ErrorFilter }],
  }).compile();
  app = mod.createNestApplication();
  await app.init();
});

describe("AccessGuard", () => {
  it("requires MFA", async () => {
    const res = await request(app.getHttpServer()).get("/probe").set("authorization", `Bearer ${await token({ mfa: false })}`).set("x-org-id", String(orgId));
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("MFA_REQUIRED");
  });

  it("checks the membership on every request and applies the matrix", async () => {
    const auth = { authorization: `Bearer ${await token()}`, "x-org-id": String(orgId) };
    expect((await request(app.getHttpServer()).get("/probe").set(auth)).status).toBe(403); // not a member yet

    const user = await UserModel.findOne({ authSubject: "sub-pm" }).lean();
    await MembershipModel.create([{ orgId, userId: user!._id, role: "project_manager" }]);
    const ok = await request(app.getHttpServer()).get("/probe").set(auth);
    expect(ok.status).toBe(200);
    expect(ok.body.role).toBe("project_manager");

    await MembershipModel.updateOne({ orgId, userId: user!._id }, { status: "removed" });
    expect((await request(app.getHttpServer()).get("/probe").set(auth)).status).toBe(403);
  });

  it("refuses org routes that forgot @Can", async () => {
    const res = await request(app.getHttpServer()).get("/unguarded").set("authorization", `Bearer ${await token()}`).set("x-org-id", String(orgId));
    expect(res.status).toBe(500);
  });
});
