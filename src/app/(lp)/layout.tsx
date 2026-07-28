import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { RoleShell } from '@/components/role-shell';
import { lpNav } from '@/lib/nav-config';
import { LpAiAssistant } from '@/components/lp/lp-ai-assistant';

export const dynamic = 'force-dynamic';

export default async function LpLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');
  const roles = (session.user as any)?.roles as string[] | undefined;
  if (!roles || !roles.some((r) => ['LP', 'ADMIN', 'SUPER_ADMIN'].includes(r))) {
    redirect('/unauthorized');
  }
  return (
    <RoleShell roleLabel="LP" navGroups={lpNav} basePath="/lp" currentRole="LP">
      {children}
      {/* Floating AI assistant — available on every LP page */}
      <LpAiAssistant />
    </RoleShell>
  );
}
