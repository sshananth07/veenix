import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import { env } from "../config/env";
import { unauthenticated } from "../common/errors";

// The only file that knows which auth provider issues tokens (spec §6.5).
let jwks: JWTVerifyGetKey = createRemoteJWKSet(new URL(env.AUTH_JWKS_URL));
export const useJwksForTests = (keys: JWTVerifyGetKey) => {
  jwks = keys;
};

const ABSOLUTE_SESSION_MS = 7 * 86_400_000;

export interface Identity {
  subject: string;
  email: string;
  name: string;
}

export async function verifyIdentity(token: string): Promise<Identity> {
  let payload;
  try {
    ({ payload } = await jwtVerify(token, jwks, {
      issuer: env.AUTH_ISSUER,
      audience: env.AUTH_AUDIENCE,
      algorithms: ["EdDSA"],
      clockTolerance: 5,
    }));
  } catch {
    throw unauthenticated("UNAUTHENTICATED", "Your session has expired. Sign in again.");
  }
  if (payload.ev !== true) throw unauthenticated("EMAIL_UNVERIFIED", "Verify your email first");
  if (payload.mfa !== true) throw unauthenticated("MFA_REQUIRED", "Set up two-factor sign-in first");
  const sct = Number(payload.sct);
  if (Number.isFinite(sct) && Date.now() - sct > ABSOLUTE_SESSION_MS) throw unauthenticated("SESSION_EXPIRED", "Please sign in again");
  return { subject: String(payload.sub), email: String(payload.email), name: String(payload.name ?? "") };
}
