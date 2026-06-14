import { NextRequest, NextResponse } from "next/server";

// Exchange a Firebase ID token for a server-set __session cookie.
// This keeps the token out of localStorage and makes it available
// to the Next.js middleware for route protection.
//
// In production, this should use firebase-admin to verify the token
// before setting the cookie. For Phase 4, we set the cookie directly
// and rely on Firebase client-side verification.
// Phase 5: Add firebase-admin token verification here.

const SESSION_COOKIE_MAX_AGE = 60 * 60 * 24 * 5; // 5 days in seconds

export async function POST(request: NextRequest) {
  try {
    const { idToken } = await request.json();

    if (!idToken || typeof idToken !== "string") {
      return NextResponse.json({ error: "Invalid token" }, { status: 400 });
    }

    // TODO Phase 5: Verify idToken with firebase-admin before trusting it
    // import { getAuth } from "firebase-admin/auth";
    // const decoded = await getAuth().verifyIdToken(idToken);

    const response = NextResponse.json({ status: "ok" });
    response.cookies.set("__session", idToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: SESSION_COOKIE_MAX_AGE,
      path: "/",
    });

    return response;
  } catch {
    return NextResponse.json({ error: "Session creation failed" }, { status: 500 });
  }
}

export async function DELETE() {
  // Sign out — clear the session cookie
  const response = NextResponse.json({ status: "ok" });
  response.cookies.set("__session", "", { maxAge: 0, path: "/" });
  return response;
}
