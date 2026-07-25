import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { RoleShell, type NavGroup } from '@/components/role-shell';
import { LayoutDashboard, BookOpen, Compass, FlaskConical } from 'lucide-react';

export const dynamic = 'force-dynamic';

const navGroups: NavGroup[] = [
  {
    label: 'Overview',
    items: [
      { label: 'Overview', href: '/developers', icon: <LayoutDashboard className="h-4 w-4" /> },
    ],
  },
  {
    label: 'Build',
    items: [
      { label: 'API Docs', href: '/developers/docs', icon: <BookOpen className="h-4 w-4" /> },
      { label: 'API Explorer', href: '/developers/explorer', icon: <Compass className="h-4 w-4" /> },
      { label: 'Sandbox', href: '/developers/sandbox', icon: <FlaskConical className="h-4 w-4" /> },
    ],
  },
];

export default async function DeveloperLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');
  const roles = (session.user as any)?.roles as string[] | undefined;
  if (!roles || !roles.some((r) => ['DEVELOPER', 'ADMIN', 'SUPER_ADMIN'].includes(r))) {
    redirect('/unauthorized');
  }
  return (
    <RoleShell roleLabel="Developer" navGroups={navGroups} basePath="/developers">
      {children}
    </RoleShell>
  );
}
