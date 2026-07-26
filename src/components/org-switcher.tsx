'use client';

import { useState, useSyncExternalStore } from 'react';
import { Building2, ChevronDown, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuLabel,
} from '@/components/ui/dropdown-menu';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { useRouter } from 'next/navigation';

export interface OrgOption {
  id: string;
  name: string;
  slug: string;
  type: string;
  role: string;
  logoUrl?: string | null;
}

const STORAGE_KEY = 'payswap.org-id';
const CHANGE_EVENT = 'payswap:org-change';

function readStoredOrg(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function subscribe(callback: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  window.addEventListener('storage', callback);
  window.addEventListener(CHANGE_EVENT, callback);
  return () => {
    window.removeEventListener('storage', callback);
    window.removeEventListener(CHANGE_EVENT, callback);
  };
}

function getSnapshot(): string | null {
  return readStoredOrg();
}

function getServerSnapshot(): string | null {
  return null;
}

function writeStoredOrg(id: string) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, id);
    document.cookie = `payswap-org-id=${id}; path=/; max-age=${30 * 24 * 60 * 60}; samesite=lax`;
  } catch {}
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function setOrgId(id: string): void {
  writeStoredOrg(id);
}

export function useOrgId(): string | null {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

const ORG_TYPE_LABELS: Record<string, string> = {
  merchant: 'Merchant',
  lp: 'Liquidity Provider',
  platform: 'Platform',
  developer: 'Developer',
};

const ORG_TYPE_COLORS: Record<string, string> = {
  merchant: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  lp: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
  platform: 'bg-violet-500/10 text-violet-600 dark:text-violet-400',
  developer: 'bg-sky-500/10 text-sky-600 dark:text-sky-400',
};

export function OrgSwitcher({ organizations, currentOrgId }: { organizations: OrgOption[]; currentOrgId?: string | null }) {
  const router = useRouter();
  const storedOrgId = useOrgId();
  const activeOrgId = currentOrgId || storedOrgId || organizations[0]?.id;
  const activeOrg = organizations.find(o => o.id === activeOrgId) || organizations[0];

  if (!activeOrg) return null;

  const switchOrg = (org: OrgOption) => {
    writeStoredOrg(org.id);
    toast.success(`Switched to ${org.name}`, {
      description: `${ORG_TYPE_LABELS[org.type] || org.type} · ${org.role}`,
    });
    setTimeout(() => router.refresh(), 300);
  };

  const initials = activeOrg.name
    .split(' ')
    .map(w => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="h-9 w-full justify-start gap-2.5 px-2">
          <Avatar className="h-7 w-7 shrink-0">
            <AvatarFallback className={cn('text-[10px] font-semibold', ORG_TYPE_COLORS[activeOrg.type])}>
              {initials}
            </AvatarFallback>
          </Avatar>
          <div className="flex-1 text-left leading-none min-w-0">
            <div className="text-xs font-semibold truncate">{activeOrg.name}</div>
            <div className="text-[10px] text-muted-foreground truncate">
              {ORG_TYPE_LABELS[activeOrg.type] || activeOrg.type} · {activeOrg.role}
            </div>
          </div>
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel className="text-[10px] uppercase tracking-wide text-muted-foreground">
          Workspaces
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {organizations.map((org) => (
          <DropdownMenuItem
            key={org.id}
            onClick={() => switchOrg(org)}
            className="gap-2.5 py-2"
          >
            <Avatar className="h-6 w-6 shrink-0">
              <AvatarFallback className={cn('text-[9px] font-semibold', ORG_TYPE_COLORS[org.type])}>
                {org.name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              <div className="text-xs font-medium truncate">{org.name}</div>
              <div className="text-[10px] text-muted-foreground">
                {ORG_TYPE_LABELS[org.type] || org.type} · {org.role}
              </div>
            </div>
            {org.id === activeOrgId && <Check className="h-3.5 w-3.5 text-emerald-500 shrink-0" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
