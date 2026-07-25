import { NextResponse } from 'next/server';
import { withAuth } from 'next-auth/middleware';

export default withAuth(
  function middleware(req) {
    const token = req.nextauth.token;
    const path = req.nextUrl.pathname;

    if (!token) {
      return NextResponse.redirect(new URL('/login', req.url));
    }

    const roles = (token.roles as string[]) || [];

    // Role-based route protection
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
  },
  {
    callbacks: {
      authorized: ({ token }) => !!token,
    },
  }
);

export const config = {
  matcher: ['/dashboard/:path*', '/admin/:path*', '/treasury/:path*', '/compliance/:path*', '/lp/:path*', '/support/:path*', '/ops/:path*', '/portal/:path*'],
};
