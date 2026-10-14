import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { isSupabaseConfigured, getSupabaseConfig } from "@/lib/env";

/**
 * Refreshes auth tokens stored in cookies and enforces route authorization.
 */
export async function updateSession(request: NextRequest): Promise<NextResponse> {
  let response = NextResponse.next({
    request: {
      headers: request.headers,
    },
  });

  if (!isSupabaseConfigured()) {
    return response;
  }

  const { url, key } = getSupabaseConfig();

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) =>
          request.cookies.set(name, value)
        );
        response = NextResponse.next({
          request,
        });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options)
        );
      },
    },
  });

  // Validates session with Supabase Auth
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const pathname = request.nextUrl.pathname;
  const isProtectedRoute =
    pathname.startsWith("/profile") ||
    pathname.startsWith("/interests") ||
    pathname.startsWith("/network") ||
    pathname.startsWith("/create") ||
    pathname.startsWith("/feed") ||
    pathname.startsWith("/notifications") ||
    pathname.startsWith("/moderation") ||
    pathname.startsWith("/collaborate") ||
    pathname.startsWith("/settings");
  const isAuthRoute =
    pathname === "/login" ||
    pathname === "/signup" ||
    pathname === "/reset-password";

  // Redirect unauthenticated requests attempting to access protected routes
  if (isProtectedRoute && !user) {
    const redirectUrl = new URL("/login", request.url);
    redirectUrl.searchParams.set("redirectTo", pathname);
    return NextResponse.redirect(redirectUrl);
  }

  // Redirect authenticated requests away from login/signup to profile
  if (isAuthRoute && user) {
    return NextResponse.redirect(new URL("/profile", request.url));
  }

  return response;
}
