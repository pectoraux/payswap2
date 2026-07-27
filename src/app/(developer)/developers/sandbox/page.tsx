import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { PageHeader } from '@/components/role-ui';
import { FlaskConical } from 'lucide-react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { SandboxConsole } from './sandbox-console';
import { resolveDeveloperMerchantId } from '@/lib/developer-context';
import { getOrCreateDeveloperSandbox } from '@/lib/developer-sandbox';

export const dynamic = 'force-dynamic';

const testCards = [
  { brand: 'Visa', number: '4242 4242 4242 4242', cvc: '123', note: 'Success' },
  { brand: 'Visa', number: '4000 0000 0000 0002', cvc: '123', note: 'Declined' },
  { brand: 'Mobile money', number: '+233 24 422 2222', cvc: '—', note: 'STK push success' },
];

const sandboxAccounts = [
  { label: 'Mobile money customer', email: 'customer@payswap.demo', currency: 'GHS', balance: 500, description: 'Funded GHS wallet for testing checkout flows.' },
  { label: 'Merchant account', email: 'merchant@payswap.demo', currency: 'GHS', balance: 25000, description: 'Active merchant with wallets, products and customers.' },
  { label: 'Liquidity provider', email: 'lp@payswap.demo', currency: 'USD', balance: 200000, description: 'LP profile with capacity across GHS↔KES corridor.' },
];

export default async function DeveloperSandboxPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');
  const userId = (session.user as any)?.id as string | undefined;
  if (!userId) redirect('/login');

  const merchantId = await resolveDeveloperMerchantId(userId);
  let initialSandbox: any = null;
  try {
    initialSandbox = getOrCreateDeveloperSandbox(userId, merchantId);
  } catch (err) {
    console.error('[sandbox/page] failed to provision sandbox:', err);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Sandbox"
        description="Pre-funded test accounts, fixtures, and connectors — fully isolated from production."
      />

      <SandboxConsole initialSandbox={initialSandbox} />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Pre-funded test accounts</CardTitle>
          <CardDescription>
            Use these credentials with sandbox secret key <code className="font-mono">sk_test_…</code>
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-3">
            {sandboxAccounts.map((a) => (
              <div key={a.email} className="rounded-lg border bg-card/50 p-4">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    {a.label}
                  </span>
                  <Badge className="bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" variant="secondary">
                    {a.currency}
                  </Badge>
                </div>
                <div className="mt-2 text-xl font-bold tabular-nums text-emerald-600 dark:text-emerald-400">
                  {new Intl.NumberFormat('en-US', { style: 'currency', currency: a.currency }).format(a.balance)}
                </div>
                <div className="mt-1 font-mono text-[10px] text-muted-foreground">{a.email}</div>
                <p className="mt-2 text-xs text-muted-foreground">{a.description}</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Test fixtures</CardTitle>
          <CardDescription>Cards and mobile money numbers for testing</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {testCards.map((c) => (
            <div key={c.number} className="flex items-center gap-3 rounded-lg border bg-card/50 p-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-md bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                <FlaskConical className="h-4 w-4" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-xs font-semibold">{c.brand}</div>
                <div className="font-mono text-[10px] text-muted-foreground">{c.number}</div>
              </div>
              <Badge variant="secondary" className="text-[10px]">
                {c.note}
              </Badge>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
