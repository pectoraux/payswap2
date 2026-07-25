'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { signOut, useSession } from 'next-auth/react';
import {
  LayoutDashboard, CreditCard, ArrowDownToLine, Users, Package,
  FileText, BarChart3, Settings, KeyRound, Webhook, UserCog,
  LogOut, ChevronDown, Bell, Search, Menu, X, Shield, Globe,
} from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

interface NavItem { label: string; href: string; icon: React.ReactNode; }
interface NavGroup { label: string; items: NavItem[]; }

const merchantNav: NavGroup[] = [
  { label: 'Overview', items: [
    { label: 'Dashboard', href: '/dashboard', icon: <LayoutDashboard className="h-4 w-4" /> },
    { label: 'Analytics', href: '/dashboard/analytics', icon: <BarChart3 className="h-4 w-4" /> },
  ]},
  { label: 'Accept Payments', items: [
    { label: 'Payments', href: '/dashboard/payments', icon: <CreditCard className="h-4 w-4" /> },
    { label: 'Payouts', href: '/dashboard/payouts', icon: <ArrowDownToLine className="h-4 w-4" /> },
  ]},
  { label: 'Manage Business', items: [
    { label: 'Customers', href: '/dashboard/customers', icon: <Users className="h-4 w-4" /> },
    { label: 'Products', href: '/dashboard/products', icon: <Package className="h-4 w-4" /> },
    { label: 'Invoices', href: '/dashboard/invoices', icon: <FileText className="h-4 w-4" /> },
  ]},
  { label: 'Settings', items: [
    { label: 'General', href: '/dashboard/settings', icon: <Settings className="h-4 w-4" /> },
    { label: 'API Keys', href: '/dashboard/settings/api-keys', icon: <KeyRound className="h-4 w-4" /> },
    { label: 'Webhooks', href: '/dashboard/settings/webhooks', icon: <Webhook className="h-4 w-4" /> },
    { label: 'Team', href: '/dashboard/settings/team', icon: <UserCog className="h-4 w-4" /> },
  ]},
];

const adminNav: NavGroup[] = [
  { label: 'Platform', items: [
    { label: 'Overview', href: '/admin', icon: <LayoutDashboard className="h-4 w-4" /> },
    { label: 'Waitlist', href: '/admin/waitlist', icon: <Users className="h-4 w-4" /> },
    { label: 'Users', href: '/admin/users', icon: <Users className="h-4 w-4" /> },
    { label: 'Merchants', href: '/admin/merchants', icon: <Package className="h-4 w-4" /> },
  ]},
  { label: 'System', items: [
    { label: 'Audit Trail', href: '/admin/audit', icon: <Shield className="h-4 w-4" /> },
  ]},
];

export function AppShell({ children, role }: { children: React.ReactNode; role?: string }) {
  const pathname = usePathname();
  const { data: session } = useSession();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const roles = (session?.user as any)?.roles as string[] | undefined;
  const navGroups = role === 'admin' ? adminNav : merchantNav;

  const initials = (session?.user?.name || session?.user?.email || 'U')
    .split(' ').map((s) => s[0]).slice(0, 2).join('').toUpperCase();

  return (
    <div className="flex min-h-screen bg-background">
      {sidebarOpen && <div className="fixed inset-0 z-40 bg-black/50 lg:hidden" onClick={() => setSidebarOpen(false)} />}
      <aside className={cn('fixed inset-y-0 left-0 z-50 w-64 border-r bg-background transition-transform lg:static lg:translate-x-0', sidebarOpen ? 'translate-x-0' : '-translate-x-full')}>
        <div className="flex h-14 items-center gap-2.5 border-b px-4">
          <Link href="/" className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-emerald-500 to-teal-600 text-white shadow-sm">
              <span className="text-sm font-bold">P</span>
            </div>
            <div className="leading-none">
              <span className="text-sm font-bold tracking-tight">PaySwap</span>
              <div className="text-[10px] text-muted-foreground">{role === 'admin' ? 'Admin' : 'Merchant'}</div>
            </div>
          </Link>
          <Button variant="ghost" size="icon" className="ml-auto lg:hidden" onClick={() => setSidebarOpen(false)}><X className="h-4 w-4" /></Button>
        </div>
        <nav className="flex-1 overflow-y-auto p-3">
          {navGroups.map((group) => (
            <div key={group.label} className="mb-4">
              <div className="mb-1 px-3 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{group.label}</div>
              {group.items.map((item) => {
                const active = pathname === item.href || (item.href !== '/dashboard' && item.href !== '/admin' && pathname.startsWith(item.href));
                return (
                  <Link key={item.href} href={item.href} className={cn('flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors', active ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground')}>
                    {item.icon}{item.label}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>
        <div className="border-t p-3">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="w-full justify-start gap-2.5 px-2">
                <Avatar className="h-8 w-8"><AvatarFallback className="bg-emerald-500/10 text-emerald-600 text-xs font-semibold">{initials}</AvatarFallback></Avatar>
                <div className="flex-1 text-left leading-none">
                  <div className="text-xs font-semibold truncate">{session?.user?.name || 'User'}</div>
                  <div className="text-[10px] text-muted-foreground truncate">{session?.user?.email}</div>
                </div>
                <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuItem asChild><Link href="/dashboard/settings">Settings</Link></DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => signOut({ callbackUrl: '/login' })} className="text-rose-600"><LogOut className="mr-2 h-4 w-4" /> Sign out</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </aside>
      <div className="flex flex-1 flex-col lg:pl-0">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b bg-background/80 px-4 backdrop-blur lg:px-6">
          <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setSidebarOpen(true)}><Menu className="h-4 w-4" /></Button>
          <div className="flex-1" />
          <Button variant="ghost" size="icon" className="h-8 w-8"><Search className="h-4 w-4" /></Button>
          <Button variant="ghost" size="icon" className="h-8 w-8 relative"><Bell className="h-4 w-4" /><span className="absolute top-1 right-1 h-2 w-2 rounded-full bg-rose-500" /></Button>
        </header>
        <main className="flex-1 p-4 lg:p-6">{children}</main>
      </div>
    </div>
  );
}
