import { redirect } from 'next/navigation';
import { AppShell } from '@/components/app-shell';
import { requireAdmin } from '@/lib/auth-guards';

export const dynamic = 'force-dynamic';

/**
 * Admin console layout.
 *
 * Server-side auth check via requireAdmin():
 * - No session → /login
 * - No ADMIN or SUPER_ADMIN role → /unauthorized
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireAdmin();
  return <AppShell role="admin">{children}</AppShell>;
}
