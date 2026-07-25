import { redirect } from 'next/navigation';
import { requireMerchant } from '@/lib/auth-guards';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  BookOpen,
  Mail,
  MessageSquare,
  Zap,
  ShoppingBag,
  Store,
  Puzzle,
  Check,
} from 'lucide-react';

export const dynamic = 'force-dynamic';

type Category = 'Payments' | 'Analytics' | 'Compliance' | 'Marketing' | 'Accounting';

interface Extension {
  id: string;
  name: string;
  description: string;
  category: Category;
  icon: React.ReactNode;
  installed?: boolean;
}

const CATEGORIES: Category[] = [
  'Payments',
  'Analytics',
  'Compliance',
  'Marketing',
  'Accounting',
];

const EXTENSIONS: Extension[] = [
  {
    id: 'quickbooks',
    name: 'QuickBooks Sync',
    description:
      'Automatically sync transactions, invoices and payouts to your QuickBooks ledger.',
    category: 'Accounting',
    icon: <BookOpen className="h-5 w-5" />,
    installed: true,
  },
  {
    id: 'mailchimp',
    name: 'Mailchimp Integration',
    description:
      'Add paying customers to Mailchimp audiences and trigger email journeys on payment events.',
    category: 'Marketing',
    icon: <Mail className="h-5 w-5" />,
  },
  {
    id: 'slack',
    name: 'Slack Notifications',
    description:
      'Get instant Slack alerts for new payments, refunds and failed payouts in your channels.',
    category: 'Payments',
    icon: <MessageSquare className="h-5 w-5" />,
  },
  {
    id: 'zapier',
    name: 'Zapier Connect',
    description:
      'Connect PaySwap to 5,000+ apps via Zapier with no-code workflows and triggers.',
    category: 'Payments',
    icon: <Zap className="h-5 w-5" />,
  },
  {
    id: 'shopify',
    name: 'Shopify Plugin',
    description:
      'Accept PaySwap at Shopify checkout with automatic order fulfillment and reconciliation.',
    category: 'Payments',
    icon: <ShoppingBag className="h-5 w-5" />,
  },
  {
    id: 'woocommerce',
    name: 'WooCommerce Plugin',
    description:
      'Drop-in WooCommerce gateway that lets your WordPress customers pay with PaySwap.',
    category: 'Payments',
    icon: <Store className="h-5 w-5" />,
  },
];

const CATEGORY_TONES: Record<Category, string> = {
  Payments: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  Analytics: 'bg-cyan-500/10 text-cyan-600 dark:text-cyan-400',
  Compliance: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
  Marketing: 'bg-teal-500/10 text-teal-600 dark:text-teal-400',
  Accounting: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
};

export default async function ExtensionsPage() {
  // Validates session + merchant role.
  const ctx = await requireMerchant().catch(() => null);
  if (!ctx) redirect('/unauthorized');

  const installedCount = EXTENSIONS.filter((e) => e.installed).length;

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

      {/* Category filter chips (non-functional visual) */}
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

      {/* Grid of extension cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {EXTENSIONS.map((e) => (
          <Card key={e.id} className="flex flex-col">
            <CardHeader>
              <div className="flex items-start gap-3">
                <div
                  className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${CATEGORY_TONES[e.category]}`}
                >
                  {e.icon}
                </div>
                <div className="min-w-0 flex-1">
                  <CardTitle className="text-base">{e.name}</CardTitle>
                  <div className="mt-1">
                    <Badge
                      variant="secondary"
                      className={`text-[9px] ${CATEGORY_TONES[e.category]}`}
                    >
                      {e.category}
                    </Badge>
                  </div>
                </div>
              </div>
            </CardHeader>
            <CardContent className="flex flex-1 flex-col gap-4">
              <CardDescription className="flex-1 text-xs leading-relaxed">
                {e.description}
              </CardDescription>
              {e.installed ? (
                <Button variant="outline" disabled className="w-full">
                  <Check className="mr-2 h-3.5 w-3.5 text-emerald-500" /> Installed
                </Button>
              ) : (
                <Button
                  className="w-full bg-emerald-600 text-white hover:bg-emerald-700"
                >
                  <Puzzle className="mr-2 h-3.5 w-3.5" /> Install
                </Button>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
