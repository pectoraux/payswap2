'use client';

import { UnifiedShell } from '@/components/unified-shell';
import { adminNav, merchantNav } from '@/lib/nav-config';

export { type NavGroup, type NavItem } from '@/lib/nav-config';

interface AppShellProps {
  children: React.ReactNode;
  /**
   * Which nav config to render. Defaults to "merchant".
   * - "merchant" → merchant dashboard nav, base path /dashboard
   * - "admin"    → admin platform nav, base path /admin
   */
  role?: 'merchant' | 'admin';
}

/**
 * AppShell — backward-compatible wrapper around {@link UnifiedShell}.
 *
 * Existing layouts (`(merchant)/layout.tsx`, `(admin)/layout.tsx`) import
 * `<AppShell role="merchant|admin">` and continue to work without changes.
 * All real shell logic now lives in the unified shell.
 */
export function AppShell({ children, role = 'merchant' }: AppShellProps) {
  const isAdmin = role === 'admin';
  return (
    <UnifiedShell
      navGroups={isAdmin ? adminNav : merchantNav}
      roleLabel={isAdmin ? 'Admin' : 'Merchant'}
      basePath={isAdmin ? '/admin' : '/dashboard'}
      currentRole={isAdmin ? 'ADMIN' : 'MERCHANT'}
      settingsHref={isAdmin ? '/admin' : '/dashboard/settings'}
    >
      {children}
    </UnifiedShell>
  );
}
