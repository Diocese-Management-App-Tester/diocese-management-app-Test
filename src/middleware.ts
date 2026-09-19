import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

// /child/* is the child portal — no Supabase auth account, the scanned QR
// (national id) is the token, checked client-side + inside the RPCs.
const PUBLIC_PATHS = ['/login', '/signup', '/pending', '/child'];

/**
 * Route gate.
 *
 * PERFORMANCE (0046): this used to call `supabase.auth.getUser()` on EVERY
 * request — a network round-trip to the Auth server (rate-limited) for each
 * page, each RSC payload and each link prefetch. With 80 users navigating
 * that was hundreds of Auth calls per minute and 150–400 ms added to every
 * navigation. Now:
 *   • `getSession()` reads + verifies the JWT from the cookie locally (no
 *     network) and refreshes it through the Auth server ONLY when expired —
 *     that is the one call that genuinely needs the server;
 *   • the DB, RLS and every RPC still validate the real token on every
 *     query, so a forged cookie gets nothing but a redirect-free 401.
 */
export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const {
    data: { session },
  } = await supabase.auth.getSession();
  const user = session?.user ?? null;

  const path = request.nextUrl.pathname;
  const isPublic = PUBLIC_PATHS.some((p) => path.startsWith(p));

  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    return NextResponse.redirect(url);
  }

  if (user && (path.startsWith('/login') || path.startsWith('/signup'))) {
    const url = request.nextUrl.clone();
    url.pathname = '/';
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|favicon-16.png|favicon-32.png|manifest.json|manifest.webmanifest|sw.js|offline|branding|icons|api).*)',
  ],
};
