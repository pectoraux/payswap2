import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { AppShell } from '@/components/app-shell';

export default async function MerchantLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');
  return <AppShell role="merchant">{children}</AppShell>;
}
