import { redirect } from 'next/navigation';
import { RoleShell } from '@/components/role-shell';
import { merchantNav } from '@/lib/nav-config';
import { requireMerchant } from '@/lib/auth-guards';

export const dynamic = 'force-dynamic';

/**
 * Merchant dashboard layout.
 *
 * Server-side auth check via requireMerchant():
 * - No session     → /login
 * - No merchant role → /unauthorized
 *
 * Defensive: a closed or suspended merchant cannot access the dashboard.
 *
 * Uses the UnifiedShell (via RoleShell) so the header renders the role
 * switcher, environment switcher, and command palette (Cmd+K) — matching
 * the other 8 role layouts. SessionProvider is already wired in the root
 * layout.
 */
export default async function MerchantLayout({ children }: { children: React.ReactNode }) {
  const { merchant } = await requireMerchant();

  // Defensive: a closed or suspended merchant should not access the dashboard.
  if (merchant.status === 'CLOSED' || merchant.status === 'SUSPENDED') {
    redirect('/unauthorized');
  }

  return (
    <RoleShell
      roleLabel="Merchant"
      navGroups={merchantNav}
      basePath="/dashboard"
      currentRole="MERCHANT"
      settingsHref="/dashboard/settings"
    >
      {children}
    </RoleShell>
  );
}
