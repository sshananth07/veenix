import { NextResponse, type NextRequest } from "next/server";
import { getSessionCookie } from "better-auth/cookies";

const PUBLIC = ["/login", "/signup", "/verify-email", "/verify-mfa", "/forgot-password", "/reset-password", "/api/auth"];

export function proxy(req: NextRequest) {
  if (PUBLIC.some((p) => req.nextUrl.pathname.startsWith(p))) return NextResponse.next();
  if (!getSessionCookie(req)) return NextResponse.redirect(new URL("/login", req.url));
  return NextResponse.next();
}

export const config = { matcher: ["/((?!_next/|favicon.ico).*)"] };
