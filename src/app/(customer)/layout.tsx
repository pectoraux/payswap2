import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { RoleShell, type NavGroup } from '@/components/role-shell';
import {
  LayoutDashboard,
  CreditCard,
  Wallet,
  FileText,
  UserCircle,
} from 'lucide-react';

export const dynamic = 'force-dynamic';

const navGroups: NavGroup[] = [
  {
    label: 'Overview',
    items: [
      { label: 'Overview', href: '/portal', icon: <LayoutDashboard className="h-4 w-4" /> },
    ],
  },
  {
    label: 'Activity',
    items: [
      { label: 'Payments', href: '/portal/payments', icon: <CreditCard className="h-4 w-4" /> },
      { label: 'Wallet', href: '/portal/wallet', icon: <Wallet className="h-4 w-4" /> },
      { label: 'Invoices', href: '/portal/invoices', icon: <FileText className="h-4 w-4" /> },
    ],
  },
  {
    label: 'Account',
    items: [
      { label: 'Profile', href: '/portal/profile', icon: <UserCircle className="h-4 w-4" /> },
    ],
  },
];

export default async function CustomerLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');
  const roles = (session.user as any)?.roles as string[] | undefined;
  if (!roles || !roles.some((r) => ['CUSTOMER', 'ADMIN', 'SUPER_ADMIN'].includes(r))) {
    redirect('/unauthorized');
  }
  return (
    <RoleShell roleLabel="Customer" navGroups={navGroups} basePath="/portal">
      {children}
    </RoleShell>
  );
}
