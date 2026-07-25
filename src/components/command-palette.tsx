'use client';

import { useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { motion } from 'framer-motion';
import {
  CreditCard,
  ArrowDownToLine,
  Package,
  FileText,
  Users,
  KeyRound,
  Webhook,
  ShieldCheck,
  User,
  Beaker,
  Zap,
  Settings as SettingsIcon,
  CornerDownLeft,
  ChevronRight,
  type LucideIcon,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from '@/components/ui/command';
import {
  ROLE_LANDING_PATH,
  ROLE_LABEL,
  ROLE_ORDER,
  type NavGroup,
} from '@/lib/nav-config';
import { setEnvMode, useEnvMode, type EnvMode } from '@/components/env-switcher';
import { cn } from '@/lib/utils';

export interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * The navigation groups for the current role. These power the "Navigation"
   * and "Settings" sections of the palette.
   */
  navGroups: NavGroup[];
  /**
   * Optional role key for the currently active role (e.g. "MERCHANT"). Used
   * to highlight the active entry in the "Switch Role" section. If omitted,
   * the first role from the session is used.
   */
  currentRole?: string;
}

interface CreateAction {
  label: string;
  href: string;
  icon: LucideIcon;
  keywords: string;
}

interface SettingsEntry {
  label: string;
  href: string;
  icon: React.ReactNode;
}

const CREATE_ACTIONS: CreateAction[] = [
  {
    label: 'New Payment',
    href: '/dashboard/payments',
    icon: CreditCard,
    keywords: 'create payment charge checkout receive money',
  },
  {
    label: 'New Payout',
    href: '/dashboard/payouts',
    icon: ArrowDownToLine,
    keywords: 'create payout withdraw disburse send money',
  },
  {
    label: 'New Product',
    href: '/dashboard/products',
    icon: Package,
    keywords: 'create product catalog item sku',
  },
  {
    label: 'New Invoice',
    href: '/dashboard/invoices',
    icon: FileText,
    keywords: 'create invoice bill customer',
  },
  {
    label: 'New Customer',
    href: '/dashboard/customers',
    icon: Users,
    keywords: 'create customer contact record',
  },
  {
    label: 'New API Key',
    href: '/dashboard/settings/api-keys',
    icon: KeyRound,
    keywords: 'create api key token secret developer',
  },
  {
    label: 'New Webhook',
    href: '/dashboard/settings/webhooks',
    icon: Webhook,
    keywords: 'create webhook endpoint subscription event',
  },
];

const ENV_ICON: Record<EnvMode, LucideIcon> = {
  sandbox: Beaker,
  live: Zap,
};

/**
 * Global command palette.
 *
 * Rendered by the unified shell. The shell owns the `open` state and the
 * Cmd+K / Ctrl+K keyboard listener; this component just renders the palette
 * UI and dispatches navigation / action events when items are selected.
 *
 * Categories:
 *  1. Navigation — every nav item for the current role (from nav-config).
 *  2. Create — quick links to the "new X" pages (the dialog on each page
 *     handles the actual creation).
 *  3. Switch Role — navigate to a role's landing page.
 *  4. Switch Environment — toggle Sandbox ↔ Live.
 *  5. Settings — jump to any settings page.
 */
export function CommandPalette({
  open,
  onOpenChange,
  navGroups,
  currentRole,
}: CommandPaletteProps) {
  const router = useRouter();
  const { data: session } = useSession();
  const envMode = useEnvMode();

  // Flatten nav items, keeping the group label so we can render it as a hint.
  const flatNav = useMemo(
    () =>
      navGroups.flatMap((g) =>
        g.items.map((i) => ({ ...i, group: g.label })),
      ),
    [navGroups],
  );

  // Settings items are those whose group label is "Settings" or whose href is
  // nested under a known settings path.
  const settingsItems = useMemo<SettingsEntry[]>(
    () =>
      flatNav
        .filter(
          (i) =>
            i.group === 'Settings' ||
            i.href.includes('/settings') ||
            i.href.endsWith('/settings'),
        )
        .map((i) => ({ label: i.label, href: i.href, icon: i.icon })),
    [flatNav],
  );

  const roles = useMemo(() => {
    const raw = (session?.user as any)?.roles as string[] | undefined;
    if (!raw || raw.length === 0) return [] as string[];
    return [...raw].sort(
      (a, b) => ROLE_ORDER.indexOf(a) - ROLE_ORDER.indexOf(b),
    );
  }, [session]);

  const activeRole =
    currentRole && ROLE_LABEL[currentRole] ? currentRole : roles[0];

  // Centralised close helper — every onSelect path calls this so the palette
  // always dismisses before navigating / toggling.
  const close = () => onOpenChange(false);

  const navigate = (href: string) => {
    close();
    // Defer the push so the dialog can finish its exit animation first.
    // This avoids a janky "click item → flash of new page" effect.
    setTimeout(() => router.push(href), 0);
  };

  const toggleEnv = () => {
    const next: EnvMode = envMode === 'sandbox' ? 'live' : 'sandbox';
    setEnvMode(next);
    toast.success(
      next === 'live' ? 'Switched to Live mode' : 'Switched to Sandbox mode',
      {
        description:
          next === 'live'
            ? 'Real transactions will be processed.'
            : 'No real funds will move in this mode.',
      },
    );
    close();
  };

  const EnvIcon = ENV_ICON[envMode === 'sandbox' ? 'live' : 'sandbox'];
  const envTargetLabel = envMode === 'sandbox' ? 'Live' : 'Sandbox';

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Command Palette"
      description="Search pages, create new records, switch role or environment."
      className="max-w-lg overflow-hidden rounded-xl p-0 shadow-2xl"
      showCloseButton={false}
    >
      <CommandInput placeholder="Type a command or search…" />
      <CommandList className="max-h-[60vh]">
        <CommandEmpty>No results found.</CommandEmpty>

        {/* ───────── Navigation ───────── */}
        <CommandGroup heading="Navigation">
          {flatNav.map((item) => (
            <CommandItem
              key={`${item.group}-${item.href}`}
              value={`${item.label} ${item.group} ${item.href}`}
              onSelect={() => navigate(item.href)}
            >
              <span className="text-muted-foreground">{item.icon}</span>
              <span className="flex-1 truncate font-medium">{item.label}</span>
              <CommandShortcut>{item.group}</CommandShortcut>
            </CommandItem>
          ))}
        </CommandGroup>

        <CommandSeparator />

        {/* ───────── Create ───────── */}
        <CommandGroup heading="Create">
          {CREATE_ACTIONS.map((action) => {
            const Icon = action.icon;
            return (
              <CommandItem
                key={action.href}
                value={`${action.label} ${action.keywords}`}
                onSelect={() => navigate(action.href)}
              >
                <span className="flex h-5 w-5 items-center justify-center rounded-md bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                  <Icon className="h-3.5 w-3.5" />
                </span>
                <span className="flex-1 truncate font-medium">
                  {action.label}
                </span>
                <CommandShortcut>
                  <span className="inline-flex items-center gap-0.5">
                    Open <ChevronRight className="h-3 w-3" />
                  </span>
                </CommandShortcut>
              </CommandItem>
            );
          })}
        </CommandGroup>

        {/* ───────── Switch Role ───────── */}
        {roles.length > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup heading="Switch Role">
              {roles.map((role) => {
                const href = ROLE_LANDING_PATH[role];
                if (!href) return null;
                const isActive = role === activeRole;
                const RoleIcon =
                  role === 'ADMIN' || role === 'SUPER_ADMIN'
                    ? ShieldCheck
                    : User;
                return (
                  <CommandItem
                    key={role}
                    value={`switch role ${ROLE_LABEL[role] ?? role} ${role}`}
                    onSelect={() => navigate(href)}
                  >
                    <span
                      className={cn(
                        'flex h-5 w-5 items-center justify-center rounded-md',
                        isActive
                          ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                          : 'bg-muted text-muted-foreground',
                      )}
                    >
                      <RoleIcon className="h-3.5 w-3.5" />
                    </span>
                    <span className="flex-1 truncate font-medium">
                      {ROLE_LABEL[role] ?? role}
                    </span>
                    {isActive && (
                      <CommandShortcut>Current</CommandShortcut>
                    )}
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </>
        )}

        {/* ───────── Switch Environment ───────── */}
        <CommandSeparator />
        <CommandGroup heading="Switch Environment">
          <CommandItem
            value={`switch environment ${envTargetLabel.toLowerCase()} sandbox live toggle`}
            onSelect={toggleEnv}
          >
            <span
              className={cn(
                'flex h-5 w-5 items-center justify-center rounded-md',
                envMode === 'live'
                  ? 'bg-sky-500/15 text-sky-600 dark:text-sky-300'
                  : 'bg-violet-500/15 text-violet-600 dark:text-violet-300',
              )}
            >
              <EnvIcon className="h-3.5 w-3.5" />
            </span>
            <span className="flex-1 truncate font-medium">
              Switch to {envTargetLabel}
            </span>
            <CommandShortcut>
              <span className="inline-flex items-center gap-1">
                <span
                  className={cn(
                    'rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide',
                    envMode === 'live'
                      ? 'bg-sky-500/15 text-sky-600 dark:text-sky-300'
                      : 'bg-violet-500/15 text-violet-600 dark:text-violet-300',
                  )}
                >
                  {envMode}
                </span>
              </span>
            </CommandShortcut>
          </CommandItem>
        </CommandGroup>

        {/* ───────── Settings ───────── */}
        {settingsItems.length > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup heading="Settings">
              {settingsItems.map((item) => (
                <CommandItem
                  key={item.href}
                  value={`settings ${item.label} ${item.href}`}
                  onSelect={() => navigate(item.href)}
                >
                  <span className="text-muted-foreground">{item.icon}</span>
                  <span className="flex-1 truncate font-medium">
                    {item.label}
                  </span>
                  <CommandShortcut>
                    <SettingsIcon className="h-3 w-3" />
                  </CommandShortcut>
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}
      </CommandList>

      {/* ───────── Keyboard hint footer ───────── */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.05 }}
        className="flex items-center justify-between gap-3 border-t bg-muted/30 px-3 py-2 text-[10px] text-muted-foreground"
      >
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="inline-flex items-center gap-1">
            <kbd className="rounded border bg-background px-1.5 py-0.5 font-mono text-[9px] font-semibold">
              ↑
            </kbd>
            <kbd className="rounded border bg-background px-1.5 py-0.5 font-mono text-[9px] font-semibold">
              ↓
            </kbd>
            navigate
          </span>
          <span className="inline-flex items-center gap-1">
            <kbd className="inline-flex items-center rounded border bg-background px-1.5 py-0.5 font-mono text-[9px] font-semibold">
              <CornerDownLeft className="h-2.5 w-2.5" />
            </kbd>
            select
          </span>
          <span className="inline-flex items-center gap-1">
            <kbd className="rounded border bg-background px-1.5 py-0.5 font-mono text-[9px] font-semibold">
              esc
            </kbd>
            close
          </span>
        </div>
        <span className="hidden items-center gap-1 sm:inline-flex">
          <kbd className="rounded border bg-background px-1.5 py-0.5 font-mono text-[9px] font-semibold">
            ⌘K
          </kbd>
          to reopen
        </span>
      </motion.div>
    </CommandDialog>
  );
}
