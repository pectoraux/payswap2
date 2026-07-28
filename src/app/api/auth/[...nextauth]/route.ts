import NextAuth from 'next-auth';
import { authOptions } from '@/lib/auth';
import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimit, getClientIp, AUTH_RATE_LIMIT } from '@/lib/rate-limiter';

const authHandler = NextAuth(authOptions);

/**
 * NextAuth route handler with rate limiting (H-5).
 *
 * Limits the /api/auth/callback/credentials endpoint to 10 attempts
 * per 15 minutes per IP. This prevents brute-force password attacks.
 *
 * Other auth endpoints (csrf, session, signout) are not rate limited
 * since they don't pose a brute-force risk.
 */

function withRateLimit(handler: typeof authHandler) {
  return async (req: NextRequest) => {
    const path = req.nextUrl.pathname;

    // Only rate limit the credentials callback (login attempts)
    if (path.includes('/callback/credentials')) {
      const ip = getClientIp(req);
      const { allowed, remaining, retryAfterMs } = checkRateLimit(
        `auth:${ip}`,
        AUTH_RATE_LIMIT,
      );

      if (!allowed) {
        const retryAfterSec = Math.ceil(retryAfterMs / 1000);
        return NextResponse.json(
          {
            error: 'Too many login attempts. Please try again later.',
            retryAfter: retryAfterSec,
          },
          {
            status: 429,
            headers: {
              'Retry-After': String(retryAfterSec),
              'X-RateLimit-Remaining': '0',
              'X-RateLimit-Reset': String(Math.floor(Date.now() / 1000) + retryAfterSec),
            },
          },
        );
      }

      // Add rate limit headers to successful responses
      const response = await handler(req);
      if (response instanceof Response) {
        response.headers.set('X-RateLimit-Remaining', String(remaining));
        response.headers.set('X-RateLimit-Limit', String(AUTH_RATE_LIMIT.maxRequests));
      }
      return response;
    }

    return handler(req);
  };
}

const wrappedHandler = withRateLimit(authHandler);

export { wrappedHandler as GET, wrappedHandler as POST };
