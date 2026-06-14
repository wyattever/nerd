import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Public paths that do not require authentication
const PUBLIC_PATHS = ["/login", "/_next", "/favicon.ico", "/api/auth"];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Local development bypass
  if (process.env.NEXT_PUBLIC_DISABLE_AUTH === "true") {
    return NextResponse.next();
  }

  // Allow public paths through
  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  // Check for Firebase session cookie
  const sessionCookie = request.cookies.get("__session")?.value;

  if (!sessionCookie) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("redirect", pathname);
    return NextResponse.redirect(loginUrl);
  }

  // Verify the session cookie with Firebase Auth REST API
  // This is a lightweight check — full verification happens server-side
  // For Next.js App Router, we verify the cookie is present and non-empty.
  // Deep verification (JWT decode) requires firebase-admin which runs server-side only.
  // See src/app/api/auth/verify/route.ts for server-side token verification.
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
