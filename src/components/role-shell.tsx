'use client';

import { UnifiedShell } from '@/components/unified-shell';
import type { NavGroup } from '@/lib/nav-config';

export { type NavGroup, type NavItem } from '@/lib/nav-config';

interface RoleShellProps {
  children: React.ReactNode;
  roleLabel: string;
  navGroups: NavGroup[];
  /**
   * The base path used to determine whether a nav item is active.
   * Defaults to the first nav item href.
   */
  basePath?: string;
  /**
   * The role key (e.g. "TREASURY") used by the role switcher to highlight
   * the active role. Optional.
   */
  currentRole?: string;
  /**
   * Where the "Settings" item in the user dropdown links to. Defaults to
   * `basePath`.
   */
  settingsHref?: string;
}

/**
 * RoleShell — backward-compatible wrapper around {@link UnifiedShell}.
 *
 * Existing role layouts (`(customer)`, `(treasury)`, etc.) import
 * `<RoleShell roleLabel="..." navGroups={...} basePath="...">` and continue
 * to work without changes. All real shell logic now lives in the unified shell.
 */
export function RoleShell({
  children,
  roleLabel,
  navGroups,
  basePath,
  currentRole,
  settingsHref,
}: RoleShellProps) {
  return (
    <UnifiedShell
      navGroups={navGroups}
      roleLabel={roleLabel}
      basePath={basePath}
      currentRole={currentRole}
      settingsHref={settingsHref}
    >
      {children}
    </UnifiedShell>
  );
}
