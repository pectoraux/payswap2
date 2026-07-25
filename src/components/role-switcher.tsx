'use client';

import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { Check, ChevronsUpDown, ShieldCheck, User } from 'lucide-react';
import { useMemo } from 'react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ROLE_LANDING_PATH, ROLE_LABEL, ROLE_ORDER } from '@/lib/nav-config';
import { cn } from '@/lib/utils';

/**
 * Role / organization switcher that lives in the unified shell header.
 *
 * Reads the user's roles from the session, shows the currently-active role
 * (derived from the current URL), and navigates to the role's landing page
 * when a different role is selected.
 */
export function RoleSwitcher({ currentRole }: { currentRole?: string }) {
  const router = useRouter();
  const { data: session } = useSession();

  const roles = useMemo(() => {
    const raw = (session?.user as any)?.roles as string[] | undefined;
    if (!raw || raw.length === 0) return [] as string[];
    // Sort by the canonical ROLE_ORDER so the dropdown is deterministic.
    return [...raw].sort(
      (a, b) => ROLE_ORDER.indexOf(a) - ROLE_ORDER.indexOf(b),
    );
  }, [session]);

  const activeRole = currentRole && ROLE_LABEL[currentRole]
    ? currentRole
    : roles[0];

  const activeLabel = activeRole ? ROLE_LABEL[activeRole] ?? 'Select role' : 'Select role';

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          className="h-9 w-full justify-between gap-2 bg-background px-2.5 text-sm font-medium"
          aria-label="Switch role"
        >
          <span className="flex min-w-0 items-center gap-2">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
              {activeRole && ['ADMIN', 'SUPER_ADMIN'].includes(activeRole) ? (
                <ShieldCheck className="h-3.5 w-3.5" />
              ) : (
                <User className="h-3.5 w-3.5" />
              )}
            </span>
            <span className="truncate">{activeLabel}</span>
          </span>
          <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-[15rem]">
        <DropdownMenuLabel className="text-xs text-muted-foreground">
          Switch role
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {roles.length === 0 ? (
          <div className="px-2 py-1.5 text-xs text-muted-foreground">
            No roles assigned
          </div>
        ) : (
          roles.map((role) => {
            const href = ROLE_LANDING_PATH[role];
            if (!href) return null;
            const isActive = role === activeRole;
            return (
              <DropdownMenuItem
                key={role}
                onClick={() => {
                  if (!isActive) router.push(href);
                }}
                className={cn(
                  'gap-2',
                  isActive && 'bg-accent text-accent-foreground',
                )}
              >
                <span className="flex h-6 w-6 items-center justify-center rounded-md bg-muted text-muted-foreground">
                  {['ADMIN', 'SUPER_ADMIN'].includes(role) ? (
                    <ShieldCheck className="h-3.5 w-3.5" />
                  ) : (
                    <User className="h-3.5 w-3.5" />
                  )}
                </span>
                <span className="flex-1 truncate">{ROLE_LABEL[role] ?? role}</span>
                {isActive && <Check className="h-3.5 w-3.5" />}
              </DropdownMenuItem>
            );
          })
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
