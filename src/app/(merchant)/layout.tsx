import { redirect } from 'next/navigation';
import { AppShell } from '@/components/app-shell';
import { requireMerchant } from '@/lib/auth-guards';

export const dynamic = 'force-dynamic';

/**
 * Merchant dashboard layout.
 *
 * Server-side auth check via requireMerchant():
 * - No session     → /login
 * - No merchant role → /unauthorized
 *
 * The AppShell (client component) handles navigation + sidebar.
 * SessionProvider is already wired in the root layout.
 */
export default async function MerchantLayout({ children }: { children: React.ReactNode }) {
  const { merchant } = await requireMerchant();

  // Defensive: a closed or suspended merchant should not access the dashboard.
  if (merchant.status === 'CLOSED' || merchant.status === 'SUSPENDED') {
    redirect('/unauthorized');
  }

  return <AppShell role="merchant">{children}</AppShell>;
}
