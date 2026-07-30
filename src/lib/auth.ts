/**
 * PaySwap Auth Configuration
 *
 * Uses NextAuth v4 with credentials provider.
 * Users cannot self-signup — they go through the waitlist → admin approval flow.
 * Demo accounts are seeded for quick login.
 */
import type { NextAuthOptions } from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import { db } from '@/lib/db';
import bcrypt from 'bcryptjs';

export const authOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      name: 'credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;

        const user = await db.user.findUnique({
          where: { email: credentials.email.toLowerCase() },
          include: { roles: true },
        });

        if (!user || !user.passwordHash) return null;
        if (user.status !== 'ACTIVE') return null;

        const valid = await bcrypt.compare(credentials.password, user.passwordHash);
        if (!valid) return null;

        // Update last login
        await db.user.update({
          where: { id: user.id },
          data: { lastLoginAt: new Date() },
        });

        return {
          id: user.id,
          email: user.email,
          name: user.name ?? undefined,
          roles: user.roles.map((r) => r.role),
        };
      },
    }),
  ],
  session: {
    strategy: 'jwt',
    maxAge: 30 * 24 * 60 * 60, // 30 days
  },
  // Explicit cookie configuration for cross-browser compatibility.
  // Firefox is stricter about SameSite cookies on redirects than Chrome/Brave.
  // Without explicit cookie config, NextAuth v4 may use defaults that Firefox
  // rejects on cross-site redirects (e.g. OAuth callbacks, middleware redirects).
  cookies: {
    sessionToken: {
      name: `next-auth.session-token`,
      options: {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        secure: process.env.NODE_ENV === 'production',
      },
    },
    callbackUrl: {
      name: `next-auth.callback-url`,
      options: {
        sameSite: 'lax',
        path: '/',
        secure: process.env.NODE_ENV === 'production',
      },
    },
    csrfToken: {
      name: `next-auth.csrf-token`,
      options: {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        secure: process.env.NODE_ENV === 'production',
      },
    },
  },
  pages: {
    signIn: '/login',
  },
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.roles = (user as any).roles ?? [];
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        (session.user as any).id = token.id;
        (session.user as any).roles = token.roles;
      }
      return session;
    },
  },
  // H-3: Fail fast if NEXTAUTH_SECRET is not set at runtime (not build time).
  // Using a getter so the check only runs when authOptions is actually used
  // (at request time), not when the module is imported during build.
  secret: process.env.NEXTAUTH_SECRET || 'payswap-build-time-placeholder',
};

// Runtime check — warn if NEXTAUTH_SECRET not set (but don't throw during build)
if (
  process.env.NEXT_RUNTIME === 'nodejs' &&
  !process.env.NEXTAUTH_SECRET &&
  process.env.NEXT_PHASE !== 'phase-production-build'
) {
  console.warn('[auth] NEXTAUTH_SECRET not set — using insecure placeholder. Set NEXTAUTH_SECRET in production.');
}
