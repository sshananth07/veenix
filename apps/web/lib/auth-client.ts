"use client";
import { createAuthClient } from "better-auth/react";
import { twoFactorClient } from "better-auth/client/plugins";
import { safeReturnPath } from "@veenix/shared";

export const authClient = createAuthClient({
  plugins: [
    twoFactorClient({
      onTwoFactorRedirect() {
        window.location.href = "/verify-mfa";
      },
    }),
  ],
});

/**
 * Where to go after signing in: the page the user was sent away from (proxy.ts adds ?next=), if it's one of ours.
 * Kept in sessionStorage across the MFA step, which loses the query string.
 */
export function returnPath(): string {
  const fromUrl = new URLSearchParams(window.location.search).get("next");
  if (fromUrl) sessionStorage.setItem("next", fromUrl);
  return safeReturnPath(fromUrl ?? sessionStorage.getItem("next"), window.location.origin);
}
