import { redirect } from 'next/navigation';
import { requireMerchant } from '@/lib/auth-guards';
import { db } from '@/lib/db';
import { Badge } from '@/components/ui/badge';
import {
  BookOpen,
  Mail,
  MessageSquare,
  Zap,
  ShoppingBag,
  Store,
  Puzzle,
} from 'lucide-react';
import { ExtensionsGrid, type ExtensionDef } from './extensions-grid';

export const dynamic = 'force-dynamic';

type Category = 'Payments' | 'Analytics' | 'Compliance' | 'Marketing' | 'Accounting';

const CATEGORIES: Category[] = [
  'Payments',
  'Analytics',
  'Compliance',
  'Marketing',
  'Accounting',
];

const EXTENSIONS: ExtensionDef[] = [
  {
    id: 'quickbooks',
    name: 'QuickBooks Sync',
    description:
      'Automatically sync transactions, invoices and payouts to your QuickBooks ledger.',
    category: 'Accounting',
    icon: 'book',
  },
  {
    id: 'mailchimp',
    name: 'Mailchimp Integration',
    description:
      'Add paying customers to Mailchimp audiences and trigger email journeys on payment events.',
    category: 'Marketing',
    icon: 'mail',
  },
  {
    id: 'slack',
    name: 'Slack Notifications',
    description:
      'Get instant Slack alerts for new payments, refunds and failed payouts in your channels.',
    category: 'Payments',
    icon: 'message',
  },
  {
    id: 'zapier',
    name: 'Zapier Connect',
    description:
      'Connect PaySwap to 5,000+ apps via Zapier with no-code workflows and triggers.',
    category: 'Payments',
    icon: 'zap',
  },
  {
    id: 'shopify',
    name: 'Shopify Plugin',
    description:
      'Accept PaySwap at Shopify checkout with automatic order fulfillment and reconciliation.',
    category: 'Payments',
    icon: 'shopping',
  },
  {
    id: 'woocommerce',
    name: 'WooCommerce Plugin',
    description:
      'Drop-in WooCommerce gateway that lets your WordPress customers pay with PaySwap.',
    category: 'Payments',
    icon: 'store',
  },
];

const CATEGORY_TONES: Record<Category, string> = {
  Payments: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  Analytics: 'bg-cyan-500/10 text-cyan-600 dark:text-cyan-400',
  Compliance: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
  Marketing: 'bg-teal-500/10 text-teal-600 dark:text-teal-400',
  Accounting: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
};

// Inline SVG icon helper — we render the right Lucide icon based on the
// `icon` string stored on the extension definition. This keeps the server
// component pure while still using the same icon vocabulary as the rest of
// the dashboard.
function ExtensionIcon({ icon }: { icon: ExtensionDef['icon'] }) {
  const cls = 'h-5 w-5';
  switch (icon) {
    case 'book':
      return <BookOpen className={cls} />;
    case 'mail':
      return <Mail className={cls} />;
    case 'message':
      return <MessageSquare className={cls} />;
    case 'zap':
      return <Zap className={cls} />;
    case 'shopping':
      return <ShoppingBag className={cls} />;
    case 'store':
      return <Store className={cls} />;
    default:
      return <Puzzle className={cls} />;
  }
}

/**
 * Parse the merchant `settings` JSON blob and return the list of installed
 * extension IDs (stored as `settings.installedExtensions: string[]`).
 */
function readInstalledExtensions(settingsJson: string | null): Set<string> {
  if (!settingsJson) return new Set();
  try {
    const parsed = JSON.parse(settingsJson) as {
      installedExtensions?: unknown;
    };
    if (Array.isArray(parsed.installedExtensions)) {
      return new Set(
        parsed.installedExtensions.filter(
          (e): e is string => typeof e === 'string',
        ),
      );
    }
  } catch {
    // ignore malformed settings JSON
  }
  return new Set();
}

export default async function ExtensionsPage() {
  // Validates session + merchant role.
  const ctx = await requireMerchant().catch(() => null);
  if (!ctx) redirect('/unauthorized');
  const { merchantId, merchant } = ctx;

  // Pull the live installed-extension IDs from the merchant's `settings` JSON.
  const fresh = await db.merchant.findUnique({
    where: { id: merchantId },
    select: { settings: true },
  });
  const installed = readInstalledExtensions(fresh?.settings ?? null);

  // Decorate each marketplace extension with its current install state.
  const extensions: (ExtensionDef & {
    installed: boolean;
    tone: string;
    iconNode: React.ReactNode;
  })[] = EXTENSIONS.map((e) => ({
    ...e,
    installed: installed.has(e.id),
    tone: CATEGORY_TONES[e.category as Category] ?? CATEGORY_TONES.Payments,
    iconNode: <ExtensionIcon icon={e.icon} />,
  }));

  const installedCount = extensions.filter((e) => e.installed).length;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Extensions</h1>
          <p className="text-sm text-muted-foreground">
            Connect PaySwap to the tools your business already uses.
          </p>
        </div>
        <Badge
          variant="secondary"
          className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
        >
          {installedCount} installed
        </Badge>
      </div>

      {/* Category filter chips (visual only — kept for marketplace feel) */}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5 text-xs font-medium text-emerald-600 dark:text-emerald-400"
        >
          All
        </button>
        {CATEGORIES.map((c) => (
          <button
            key={c}
            type="button"
            className="rounded-full border px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/50"
          >
            {c}
          </button>
        ))}
      </div>

      <ExtensionsGrid extensions={extensions} />
    </div>
  );
}
