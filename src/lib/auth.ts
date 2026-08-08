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
import { requireNextAuthSecret } from '@/lib/secrets';

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
  // JWT signing secret — fail closed if missing (C-1 fix).
  // Evaluated lazily via getter so the module can be imported even before
  // env vars are fully loaded (Next.js loads .env asynchronously in some
  // contexts). The secret is checked on first use, not on import.
  // SECURITY: no fallback secret. A hardcoded fallback secret in a public
  // repo lets anyone forge JWTs with SUPER_ADMIN roles — the entire
  // deny-by-default middleware becomes decorative.
  get secret() {
    return requireNextAuthSecret();
  },
};

// `requireNextAuthSecret()` is imported from `@/lib/secrets` (canonical source).
