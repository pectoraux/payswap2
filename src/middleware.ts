import { NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';
import type { NextRequest } from 'next/server';
import { requireNextAuthSecret } from '@/lib/secrets';

/**
 * PUBLIC_ROUTES — explicitly unauthenticated API/page paths.
 *
 * SECURITY RULE: every entry must be an endpoint that is genuinely
 * reachable without a session. Keep this list MINIMAL. Adding a route
 * here means the middleware will let unauthenticated requests through
 * to it — the route handler is then responsible for its own auth
 * (e.g. HMAC signature verification for inbound webhook receivers).
 *
 * Rationale per entry:
 *   - `/api/auth/*`        NextAuth callbacks (signin, callback, signout).
 *                          The handler enforces its own credentials flow.
 *   - `/api/webhooks/*`    Inbound webhook receivers authenticated by HMAC
 *                          signature, not session. Management endpoints
 *                          within this tree still call requireSession()
 *                          themselves — defence in depth.
 *   - `/healthz`           Container HEALTHCHECK probe (Docker/K8s).
 *   - `/api/healthz`       API alias of the container health probe.
 *   - `/api/parcel/health` External logistics-provider liveness probe.
 *   - `/api/public`        Public economic-state snapshot (comment in
 *                          route.ts: "no auth required").
 *   - `/api/waitlist`      Public waitlist signup — applicants join
 *                          BEFORE they have a User account.
 */
const PUBLIC_ROUTES = [
  '/api/auth/*',
  '/api/webhooks/*',
  '/healthz',
  '/api/healthz',
  '/api/parcel/health',
  '/api/public',
  '/api/waitlist',
] as const;

/**
 * Convert a PUBLIC_ROUTES glob-style pattern (`*` matches a single path
 * segment, `**` would match multiple — we only need single-segment `*`
 * here) into a RegExp for testing against `req.nextUrl.pathname`.
 */
function compilePublicPattern(pattern: string): RegExp {
  // Escape regex metacharacters, then turn `\*` into `[^/]*`.
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  const body = escaped.replace(/\*/g, '[^/]*');
  return new RegExp('^' + body + '$');
}

const PUBLIC_ROUTE_RES = PUBLIC_ROUTES.map(compilePublicPattern);

/** True when the request path is in the PUBLIC_ROUTES allowlist. */
function isPublicPath(pathname: string): boolean {
  return PUBLIC_ROUTE_RES.some((re) => re.test(pathname));
}

export async function middleware(req: NextRequest) {
  const path = req.nextUrl.pathname;
  const isApi = path.startsWith('/api/');

  // ---- API branch: deny-by-default, JSON 401 (no redirects). ----
  if (isApi) {
    // Public API routes (auth callbacks, webhooks, health, waitlist, …)
    // skip the session check entirely.
    if (isPublicPath(path)) {
      return NextResponse.next();
    }
    const token = await getToken({ req, secret: requireNextAuthSecret() });
    if (!token) {
      // API clients expect JSON, not a redirect to /login.
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
    // Authenticated API request — let the route handler do its own
    // role / ownership checks (defence in depth).
    return NextResponse.next();
  }

  // ---- Page branch: existing role-gated page-route checks. ----
  const token = await getToken({ req, secret: requireNextAuthSecret() });
  if (!token) {
    const loginUrl = new URL('/login', req.url);
    loginUrl.searchParams.set('callbackUrl', req.url);
    return NextResponse.redirect(loginUrl);
  }

  const roles = (token.roles as string[]) || [];

  const routeRoles: Record<string, string[]> = {
    '/dashboard': ['MERCHANT', 'MERCHANT_STAFF', 'ADMIN', 'SUPER_ADMIN'],
    '/admin': ['ADMIN', 'SUPER_ADMIN'],
    '/treasury': ['TREASURY', 'ADMIN', 'SUPER_ADMIN'],
    '/compliance': ['COMPLIANCE', 'ADMIN', 'SUPER_ADMIN'],
    '/lp': ['LP', 'ADMIN', 'SUPER_ADMIN'],
    '/support': ['SUPPORT', 'ADMIN', 'SUPER_ADMIN'],
    '/ops': ['OPERATIONS', 'ADMIN', 'SUPER_ADMIN'],
    '/developers': ['DEVELOPER', 'MERCHANT', 'MERCHANT_STAFF', 'ADMIN', 'SUPER_ADMIN'],
    '/portal': ['CUSTOMER', 'ADMIN', 'SUPER_ADMIN'],
  };

  for (const [prefix, allowed] of Object.entries(routeRoles)) {
    if (path.startsWith(prefix)) {
      const hasAccess = roles.some((r) => allowed.includes(r));
      if (!hasAccess) {
        return NextResponse.redirect(new URL('/unauthorized', req.url));
      }
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    '/dashboard/:path*',
    '/admin/:path*',
    '/treasury/:path*',
    '/compliance/:path*',
    '/lp/:path*',
    '/support/:path*',
    '/ops/:path*',
    '/portal/:path*',
    '/api/:path*',
  ],
};
