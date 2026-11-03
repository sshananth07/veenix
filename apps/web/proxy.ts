import { NextResponse, type NextRequest } from "next/server";
import { getSessionCookie } from "better-auth/cookies";

const PUBLIC = ["/login", "/signup", "/verify-email", "/verify-mfa", "/forgot-password", "/reset-password", "/api/auth"];

export function proxy(req: NextRequest) {
  if (PUBLIC.some((p) => req.nextUrl.pathname.startsWith(p))) return NextResponse.next();
  if (!getSessionCookie(req)) {
    // Come back here after login and MFA (e.g. a concept link opened from WhatsApp).
    const login = new URL("/login", req.url);
    if (req.nextUrl.pathname !== "/") login.searchParams.set("next", req.nextUrl.pathname + req.nextUrl.search);
    return NextResponse.redirect(login);
  }
  return NextResponse.next();
}

export const config = { matcher: ["/((?!_next/|favicon.ico).*)"] };
