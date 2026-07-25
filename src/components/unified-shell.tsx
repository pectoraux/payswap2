'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { signOut, useSession } from 'next-auth/react';
import { useEffect, useState } from 'react';
import { Bell, ChevronDown, Command as CommandIcon, LogOut, Menu, Search, Settings, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { RoleSwitcher } from '@/components/role-switcher';
import { EnvSwitcher } from '@/components/env-switcher';
import { OrgSwitcher, type OrgOption } from '@/components/org-switcher';
import { CommandPalette } from '@/components/command-palette';
import type { NavGroup } from '@/lib/nav-config';
import { cn } from '@/lib/utils';

export interface UnifiedShellProps {
  children: React.ReactNode;
  navGroups: NavGroup[];
  roleLabel: string;
  /**
   * The base path used to determine whether a nav item is active.
   * Defaults to the first nav item href.
   */
  basePath?: string;
  /** Optional organizations for the workspace switcher */
  organizations?: OrgOption[];
  /**
   * The role key (e.g. "MERCHANT", "ADMIN") used by the role switcher to
   * highlight the currently-active role. Optional — if omitted, the switcher
   * falls back to the first role in the session.
   */
  currentRole?: string;
  /**
   * Where the "Settings" item in the user dropdown should link to.
   * Defaults to `basePath`.
   */
  settingsHref?: string;
}

export function UnifiedShell({
  children,
  navGroups,
  roleLabel,
  basePath,
  currentRole,
  settingsHref,
  organizations,
}: UnifiedShellProps) {
  const pathname = usePathname();
  const { data: session } = useSession();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);

  // Global Cmd+K / Ctrl+K shortcut → open the command palette. Lives in the
  // shell so the listener is attached once on every authenticated page.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((prev) => !prev);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const rootPath = basePath ?? navGroups[0]?.items[0]?.href ?? '/';
  const resolvedSettingsHref = settingsHref ?? rootPath;

  const initials = (session?.user?.name || session?.user?.email || 'U')
    .split(' ')
    .map((s) => s[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  const isActive = (href: string) => {
    if (href === rootPath) return pathname === href;
    return pathname === href || pathname.startsWith(href + '/');
  };

  const openPalette = () => {
    setPaletteOpen(true);
    setSidebarOpen(false);
  };

  return (
    <div className="flex min-h-screen bg-background">
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 lg:hidden"
          onClick={() => setSidebarOpen(false)}
          aria-hidden="true"
        />
      )}

      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-50 flex w-64 flex-col border-r bg-background transition-transform lg:static lg:translate-x-0',
          sidebarOpen ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        {/* Brand row */}
        <div className="flex h-14 shrink-0 items-center gap-2.5 border-b px-4">
          <Link href="/" className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-emerald-500 to-teal-600 text-white shadow-sm">
              <span className="text-sm font-bold">P</span>
            </div>
            <div className="leading-none">
              <span className="text-sm font-bold tracking-tight">PaySwap</span>
              <div className="text-[10px] text-muted-foreground">{roleLabel}</div>
            </div>
          </Link>
          <Button
            variant="ghost"
            size="icon"
            className="ml-auto lg:hidden"
            onClick={() => setSidebarOpen(false)}
            aria-label="Close sidebar"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Workspace switcher (organizations) */}
        {organizations && organizations.length > 0 && (
          <div className="border-b px-2 py-2">
            <OrgSwitcher organizations={organizations} />
          </div>
        )}

        {/* Switcher row — role + sandbox/live toggle */}
        <div className="flex items-center gap-2 border-b px-3 py-2.5">
          <div className="min-w-0 flex-1">
            <RoleSwitcher currentRole={currentRole} />
          </div>
          <EnvSwitcher />
        </div>

        {/* Navigation */}
        <nav className="max-h-[calc(100vh-13rem)] flex-1 overflow-y-auto p-3">
          {navGroups.map((group) => (
            <div key={group.label} className="mb-4">
              <div className="mb-1 px-3 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                {group.label}
              </div>
              {group.items.map((item) => {
                const active = isActive(item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setSidebarOpen(false)}
                    className={cn(
                      'flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                      active
                        ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                        : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground',
                    )}
                  >
                    {item.icon}
                    {item.label}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>

        {/* User dropdown */}
        <div className="mt-auto border-t p-3">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="w-full justify-start gap-2.5 px-2">
                <Avatar className="h-8 w-8">
                  <AvatarFallback className="bg-emerald-500/10 text-xs font-semibold text-emerald-600">
                    {initials}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 overflow-hidden text-left leading-none">
                  <div className="truncate text-xs font-semibold">
                    {session?.user?.name || 'User'}
                  </div>
                  <div className="truncate text-[10px] text-muted-foreground">
                    {session?.user?.email}
                  </div>
                </div>
                <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel className="text-xs text-muted-foreground">
                {session?.user?.email || 'Signed in'}
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild>
                <Link href={resolvedSettingsHref}>
                  <Settings className="mr-2 h-4 w-4" /> Settings
                </Link>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => signOut({ callbackUrl: '/login' })}
                className="text-rose-600 dark:text-rose-400"
              >
                <LogOut className="mr-2 h-4 w-4" /> Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </aside>

      {/* Main column */}
      <div className="flex flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b bg-background/80 px-4 backdrop-blur lg:px-6">
          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden"
            onClick={() => setSidebarOpen(true)}
            aria-label="Open sidebar"
          >
            <Menu className="h-4 w-4" />
          </Button>
          <div className="flex-1" />
          <button
            type="button"
            onClick={openPalette}
            aria-label="Open command palette"
            className="hidden h-8 items-center gap-2 rounded-md border bg-background px-2 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground sm:flex"
          >
            <Search className="h-3.5 w-3.5" />
            <span>Search…</span>
            <kbd className="ml-1 inline-flex items-center gap-0.5 rounded border bg-muted px-1 py-0.5 font-mono text-[9px] font-semibold">
              <CommandIcon className="h-2.5 w-2.5" />K
            </kbd>
          </button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 sm:hidden"
            onClick={openPalette}
            aria-label="Search"
          >
            <Search className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="relative h-8 w-8"
            onClick={() => toast.info('No new notifications')}
            aria-label="Notifications"
          >
            <Bell className="h-4 w-4" />
            <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-rose-500" />
          </Button>
        </header>
        <main className="flex-1 p-4 lg:p-6">{children}</main>
      </div>

      {/* Global command palette (Cmd+K / Ctrl+K) */}
      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        navGroups={navGroups}
        currentRole={currentRole}
      />
    </div>
  );
}
