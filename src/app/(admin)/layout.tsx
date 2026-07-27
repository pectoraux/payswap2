import { RoleShell } from '@/components/role-shell';
import { adminNav } from '@/lib/nav-config';
import { requireAdmin } from '@/lib/auth-guards';

export const dynamic = 'force-dynamic';

/**
 * Admin console layout.
 *
 * Server-side auth check via requireAdmin():
 * - No session → /login
 * - No ADMIN or SUPER_ADMIN role → /unauthorized
 *
 * Uses the UnifiedShell (via RoleShell) so the header renders the role
 * switcher, environment switcher, and command palette (Cmd+K) — matching
 * the other 8 role layouts.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const { roles } = await requireAdmin();
  // Admins may hold either ADMIN or SUPER_ADMIN. Prefer SUPER_ADMIN when
  // present so the role switcher highlights the user's actual top-level role.
  const currentRole = roles.includes('SUPER_ADMIN') ? 'SUPER_ADMIN' : 'ADMIN';
  return (
    <RoleShell
      roleLabel="Admin"
      navGroups={adminNav}
      basePath="/admin"
      currentRole={currentRole}
      settingsHref="/admin"
    >
      {children}
    </RoleShell>
  );
}
