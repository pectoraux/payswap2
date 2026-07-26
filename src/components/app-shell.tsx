'use client';

import { UnifiedShell } from '@/components/unified-shell';
import { adminNav, merchantNav } from '@/lib/nav-config';
import type { OrgOption } from '@/components/org-switcher';

export { type NavGroup, type NavItem } from '@/lib/nav-config';

interface AppShellProps {
  children: React.ReactNode;
  role?: 'merchant' | 'admin';
  organizations?: OrgOption[];
}

export function AppShell({ children, role = 'merchant', organizations }: AppShellProps) {
  const isAdmin = role === 'admin';
  return (
    <UnifiedShell
      navGroups={isAdmin ? adminNav : merchantNav}
      roleLabel={isAdmin ? 'Admin' : 'Merchant'}
      basePath={isAdmin ? '/admin' : '/dashboard'}
      currentRole={isAdmin ? 'ADMIN' : 'MERCHANT'}
      settingsHref={isAdmin ? '/admin' : '/dashboard/settings'}
      organizations={organizations}
    >
      {children}
    </UnifiedShell>
  );
}
