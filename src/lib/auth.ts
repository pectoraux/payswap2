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
  // SECURITY: no fallback secret. If NEXTAUTH_SECRET is unset, throw at boot.
  // A hardcoded fallback secret in a public repo lets anyone forge JWTs with
  // SUPER_ADMIN roles — the entire deny-by-default middleware becomes decorative.
  secret: requireNextAuthSecret(),
};

/**
 * SECURITY: throw on missing NEXTAUTH_SECRET. Never fall back to a literal.
 * The `|| 'literal'` pattern makes a misconfiguration fail OPEN — anyone
 * can forge a JWT with the known secret. This function makes it fail CLOSED.
 *
 * In development, set NEXTAUTH_SECRET in .env (it's gitignored).
 * In production, set it in the Vercel/dashboard environment variables.
 */
function requireNextAuthSecret(): string {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error(
      'NEXTAUTH_SECRET is missing or too short (min 32 chars). ' +
      'Set it in .env for development or in the Vercel dashboard for production. ' +
      'Never commit a fallback secret — it lets anyone forge JWTs.'
    );
  }
  return secret;
}
