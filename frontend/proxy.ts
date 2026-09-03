// frontend/proxy.ts
/**
 * THIS FILE IS NOT A SECURITY BOUNDARY. Read this before changing it.
 *
 * Next's proxy runs on the Edge runtime, where firebase-admin cannot run:
 * no Node crypto, no gRPC. It therefore CANNOT verify a session cookie. All
 * it can do is observe that one is present, which a forged cookie also
 * satisfies. Any protection that depends on this file is protection that
 * does not exist -- which was exactly the flaw in the previous
 * `__session=true` design, where an unsigned client-set flag was checked
 * here and nowhere else.
 *
 * What this file is for: sending an obviously-signed-out visitor to /login
 * on navigation, instead of into a page that renders and then fails its own
 * data fetch. That is a UX improvement and nothing more.
 *
 * Real enforcement is in lib/server/session.ts, in the Node runtime,
 * co-located with the data access it protects: assertSession() in every
 * Route Handler, requireSessionUser() in every Server Component that reads
 * a document. A request that slips past this file still cannot read or
 * write anything.
 *
 * Two other changes from the previous version:
 *
 *   - The NEXT_PUBLIC_DISABLE_AUTH bypass is GONE. It was the mechanism of
 *     the 2026-07-08 production incident (DECISION_LOG #27) in its
 *     LOCAL_MODE form, and keeping a "skip all auth" branch in the tree at
 *     all is a standing invitation to set it somewhere it does not belong.
 *     Local development signs in for real against the Firebase Auth
 *     emulator; see the persistence-tier design doc for the setup.
 *
 *   - /api is no longer blanket-excluded. It was excluded because the API
 *     routes had their own gate (assertLocalOnly) and the proxy had nothing
 *     useful to add. They still have their own gate -- a better one -- and
 *     the proxy still has nothing useful to add, but "redirect an API call
 *     to an HTML login page" is a worse answer than "let it through and let
 *     the handler return 401", so /api is excluded from the MATCHER rather
 *     than short-circuited inside the function. Same outcome, one less
 *     branch.
 */

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const SESSION_COOKIE = "__session";

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname.startsWith("/login")) {
    return NextResponse.next();
  }

  if (!request.cookies.has(SESSION_COOKIE)) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("from", pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Everything except:
     * - api          (Route Handlers enforce their own auth and must be
     *                 able to answer 401 rather than redirect to HTML)
     * - _next/static (build output)
     * - _next/image  (image optimizer)
     * - favicon.ico
     */
    "/((?!api|_next/static|_next/image|favicon.ico).*)",
  ],
};
