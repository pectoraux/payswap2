import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { AppShell } from '@/components/app-shell';
import { ensureDbInitialized } from '@/lib/db-init';

export default async function MerchantLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');
  await ensureDbInitialized();
  return <AppShell role="merchant">{children}</AppShell>;
}
