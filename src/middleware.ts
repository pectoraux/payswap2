import { NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';
import type { NextRequest } from 'next/server';

/**
 * SEC-2: Deny-by-default on /api/*.
 *
 * Previously, the matcher only covered page paths (/dashboard, /admin, etc.).
 * /api/* was not matched at all — 79 of 432 API routes were reachable
 * unauthenticated, including runtime/projections, runtime/ledger,
 * runtime/transactions, and treasury/insights.
 *
 * Now: /api/* IS matched. An explicit PUBLIC_ROUTES allowlist is the only
 * way an API route is reachable without a session. Webhook receivers are
 * public (they authenticate by signature, not session) but are listed
 * explicitly so a new webhook endpoint is a deliberate addition.
 *
 * A new API route is protected unless someone deliberately opens it.
 */

// Routes that are legitimately public — no session required.
const PUBLIC_ROUTES: string[] = [
  // Auth
  '/api/auth/[...nextauth]',
  // Health + docs
  '/api/health',
  '/api/public',
  '/api/showcase', // public showcase (read-only demo data)
  // Identity recovery (legitimately public — documented as such)
  '/api/identity/recovery/initiate',
  '/api/identity/recovery/complete',
  // Webhook receivers (authenticate by signature, not session)
  '/api/webhooks/stripe',
  '/api/webhooks/paystack',
  '/api/webhooks/flutterwave',
  '/api/webhooks/stellar',
  '/api/webhooks/coinbase',
  // Payment link checkout (public — customer pays without logging in)
  '/api/pay',
  '/api/payment-links',
  '/api/checkout',
  // Waitlist (public sign-up)
  '/api/waitlist',
];

function isPublicRoute(path: string): boolean {
  // Normalize: remove trailing slash, strip query string.
  const normalized = path.split('?')[0].replace(/\/$/, '');
  // Check exact match first.
  if (PUBLIC_ROUTES.includes(normalized)) return true;
  // Check prefix match (for dynamic segments like /api/pay/[paymentId]).
  for (const route of PUBLIC_ROUTES) {
    if (normalized.startsWith(route + '/')) return true;
    // Handle Next.js dynamic routes: /api/auth/[...nextauth] matches /api/auth/signin etc.
    if (route.includes('[')) {
      const regex = new RegExp('^' + route.replace(/\[.*?\]/g, '[^/]+') + '$');
      if (regex.test(normalized)) return true;
    }
  }
  return false;
}

export async function middleware(req: NextRequest) {
  const path = req.nextUrl.pathname;
  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET || 'payswap-dev-secret-7f8a9b2c4e1d6f3a8b5c9d2e7f4a1b8c' });

  // ── API routes: deny-by-default ──
  if (path.startsWith('/api/')) {
    if (isPublicRoute(path)) {
      // Public route — let it through. Individual routes handle their own
      // auth (signature verification for webhooks, etc.).
      return NextResponse.next();
    }
    // Protected API route — require a valid session token.
    if (!token) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 },
      );
    }
    // Token is valid — let it through. Individual routes may do additional
    // role-based checks.
    return NextResponse.next();
  }

  // ── Page routes: redirect to login if no token ──
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
    // Page routes (unchanged)
    '/dashboard/:path*',
    '/admin/:path*',
    '/treasury/:path*',
    '/compliance/:path*',
    '/lp/:path*',
    '/support/:path*',
    '/ops/:path*',
    '/portal/:path*',
    // SEC-2: API routes — now matched
    '/api/:path*',
  ],
};
