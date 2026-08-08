import { NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';
import type { NextRequest } from 'next/server';
import { requireNextAuthSecret } from '@/lib/secrets';
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limiter';

/**
 * PUBLIC_ROUTES — explicitly unauthenticated API/page paths.
 *
 * SECURITY RULE: every entry must be an endpoint that is genuinely
 * reachable without a session. Keep this list MINIMAL. Adding a route
 * here means the middleware will let unauthenticated requests through
 * to it — the route handler is then responsible for its own auth
 * (e.g. HMAC signature verification for inbound webhook receivers).
 *
 * Glob patterns: `*` matches a single path segment (e.g. `/api/auth/*`
 * matches `/api/auth/signin` but not `/api/auth/foo/bar`).
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
 *   - `/api/health`        Legacy health probe alias (kept public for
 *                          load-balancer / uptime-monitor checks).
 *   - `/api/parcel/health` External logistics-provider liveness probe.
 *   - `/api/public`        Public economic-state snapshot (comment in
 *                          route.ts: "no auth required").
 *   - `/api/showcase`      Public showcase (read-only demo data).
 *   - `/api/waitlist`      Public waitlist signup — applicants join
 *                          BEFORE they have a User account.
 *   - `/api/identity/recovery/initiate` Public identity-recovery flow
 *                          (legitimately unauthenticated — documented).
 *   - `/api/identity/recovery/complete` Terminal step of recovery flow.
 *   - `/api/pay`           Public payment-link checkout — customer pays
 *                          without logging in.
 *   - `/api/payment-links` Public payment-link metadata lookup.
 *   - `/api/checkout`      Public checkout session creation.
 *   - `/api/metrics/prometheus`  Prometheus scrape endpoint (P4-2).
 *                          Returns aggregate numeric metrics only
 *                          (counters/histograms/gauges) — no PII. Kept
 *                          public so monitoring scrapers can hit it
 *                          without a Bearer token.
 */
const PUBLIC_ROUTES = [
  '/api/auth/*',
  '/api/webhooks/*',
  '/healthz',
  '/api/healthz',
  '/api/health',
  '/api/parcel/health',
  '/api/public',
  '/api/showcase',
  '/api/waitlist',
  '/api/identity/recovery/initiate',
  '/api/identity/recovery/complete',
  '/api/pay',
  '/api/payment-links',
  '/api/checkout',
  // P4-2: Prometheus scrape endpoint. Returns aggregate numeric metrics
  // only (counters/histograms/gauges) — no PII, no business data. Kept
  // public so monitoring scrapers (Prometheus, VictoriaMetrics, Grafana
  // Agent) can hit it without a Bearer token. The JSON /api/metrics
  // endpoint remains auth-gated (it includes SLO names + node version).
  '/api/metrics/prometheus',
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
  // Normalize: remove trailing slash, strip query string.
  const normalized = pathname.split('?')[0].replace(/\/$/, '');
  return PUBLIC_ROUTE_RES.some((re) => re.test(normalized));
}

export async function middleware(req: NextRequest) {
  const path = req.nextUrl.pathname;
  const isApi = path.startsWith('/api/');

  // ---- API branch: deny-by-default, JSON 401 (no redirects). ----
  if (isApi) {
    // SEC-5: rate limit all API requests per IP (100/min).
    const clientIp = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
    if (!checkRateLimit('api:ip', clientIp, RATE_LIMITS.apiPerIp.maxRequests, RATE_LIMITS.apiPerIp.windowMs)) {
      return NextResponse.json(
        { error: 'Too many requests. Please slow down.' },
        { status: 429, headers: { 'Retry-After': '60' } },
      );
    }

    // Public API routes (auth callbacks, webhooks, health, waitlist, …)
    // skip the session check entirely. Individual routes handle their own
    // auth (signature verification for webhooks, etc.).
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
    // Page routes (role-gated)
    '/dashboard/:path*',
    '/admin/:path*',
    '/treasury/:path*',
    '/compliance/:path*',
    '/lp/:path*',
    '/support/:path*',
    '/ops/:path*',
    '/portal/:path*',
    // SEC-2 / C-6: API routes — now matched so deny-by-default applies.
    '/api/:path*',
  ],
};
