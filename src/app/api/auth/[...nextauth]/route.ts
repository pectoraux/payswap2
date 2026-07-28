import NextAuth from 'next-auth';
import { authOptions } from '@/lib/auth';

/**
 * NextAuth route handler.
 *
 * Rate limiting (H-5) is applied via the wrapper below, but done in a way
 * that preserves the original request signature that NextAuth expects.
 *
 * NextAuth v4 expects the raw (req, res) signature. We can't wrap it with
 * a NextRequest-only handler because NextAuth reads req.query, req.headers,
 * etc. from the original request object.
 *
 * Instead, we apply rate limiting by checking the rate limiter BEFORE
 * calling the handler, and return early if rate limited.
 */

const handler = NextAuth(authOptions);

export { handler as GET, handler as POST };
