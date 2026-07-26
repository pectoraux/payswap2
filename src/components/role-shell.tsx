'use client';

import { UnifiedShell } from '@/components/unified-shell';
import type { NavGroup } from '@/lib/nav-config';
import type { OrgOption } from '@/components/org-switcher';

export { type NavGroup, type NavItem } from '@/lib/nav-config';

interface RoleShellProps {
  children: React.ReactNode;
  roleLabel: string;
  navGroups: NavGroup[];
  basePath?: string;
  currentRole?: string;
  settingsHref?: string;
  organizations?: OrgOption[];
}

export function RoleShell({
  children,
  roleLabel,
  navGroups,
  basePath,
  currentRole,
  settingsHref,
  organizations,
}: RoleShellProps) {
  return (
    <UnifiedShell
      navGroups={navGroups}
      roleLabel={roleLabel}
      basePath={basePath}
      currentRole={currentRole}
      settingsHref={settingsHref}
      organizations={organizations}
    >
      {children}
    </UnifiedShell>
  );
}
