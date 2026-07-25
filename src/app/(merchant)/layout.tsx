import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { AppShell } from '@/components/app-shell';
import { getUserOrganizations } from '@/lib/org-context';

export default async function MerchantLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');

  const userId = (session.user as any)?.id;
  const organizations = userId ? await getUserOrganizations(userId) : [];

  return <AppShell role="merchant" organizations={organizations as any}>{children}</AppShell>;
}
