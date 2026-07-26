'use client';

import { SessionProvider } from 'next-auth/react';
import type { ReactNode } from 'react';

/**
 * Client-only wrapper around next-auth's SessionProvider.
 *
 * next-auth v4 does not ship a "use client" directive in its react entry,
 * so importing SessionProvider directly into a Server Component (the root
 * layout) causes Next.js to treat it as a Server Component and crash on
 * its internal `useContext` call. This thin wrapper establishes the
 * client boundary.
 */
export function AuthSessionProvider({ children }: { children: ReactNode }) {
  return <SessionProvider>{children}</SessionProvider>;
}
