import { NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';
import type { NextRequest } from 'next/server';

export async function middleware(req: NextRequest) {
  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET || 'payswap-dev-secret-7f8a9b2c4e1d6f3a8b5c9d2e7f4a1b8c' });
  const path = req.nextUrl.pathname;

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
  matcher: ['/dashboard/:path*', '/admin/:path*', '/treasury/:path*', '/compliance/:path*', '/lp/:path*', '/support/:path*', '/ops/:path*', '/portal/:path*'],
};
