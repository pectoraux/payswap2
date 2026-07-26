import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { PageHeader } from '@/components/role-ui';
import { FlaskConical, Coins, Wallet, TestTube } from 'lucide-react';

export const dynamic = 'force-dynamic';

const sandboxAccounts = [
  {
    label: 'Mobile money customer',
    email: 'customer@payswap.demo',
    currency: 'GHS',
    balance: 500,
    description: 'Funded GHS wallet for testing checkout flows.',
  },
  {
    label: 'Merchant account',
    email: 'merchant@payswap.demo',
    currency: 'GHS',
    balance: 25000,
    description: 'Active merchant with wallets, products and customers.',
  },
  {
    label: 'Liquidity provider',
    email: 'lp@payswap.demo',
    currency: 'USD',
    balance: 200000,
    description: 'LP profile with capacity across GHS↔KES corridor.',
  },
];

const testCards = [
  { brand: 'Visa', number: '4242 4242 4242 4242', cvc: '123', note: 'Success' },
  { brand: 'Visa', number: '4000 0000 0000 0002', cvc: '123', note: 'Declined' },
  { brand: 'Mobile money', number: '+233 24 422 2222', cvc: '—', note: 'STK push success' },
];

export default async function DeveloperSandboxPage() {
  const session = await getServerSession(authOptions);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Sandbox"
        description="Pre-funded test accounts and fixtures for end-to-end testing."
      />

      <Card>
        <CardContent>
          <div className="flex items-start gap-3 rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-4">
            <FlaskConical className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600 dark:text-emerald-400" />
            <div>
              <div className="text-sm font-semibold">Sandbox mode</div>
              <p className="mt-1 text-xs text-muted-foreground">
                Sandbox calls are isolated from production. Use the credentials below with
                the demo secret key <code className="font-mono">psk_test_demo</code>.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {sandboxAccounts.map((a) => (
          <Card key={a.email}>
            <CardContent className="p-5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {a.label}
                </span>
                <Badge className="bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" variant="secondary">
                  {a.currency}
                </Badge>
              </div>
              <div className="mt-2 text-2xl font-bold tabular-nums text-emerald-600 dark:text-emerald-400">
                {new Intl.NumberFormat('en-US', { style: 'currency', currency: a.currency }).format(a.balance)}
              </div>
              <div className="mt-1 font-mono text-[10px] text-muted-foreground">{a.email}</div>
              <p className="mt-2 text-xs text-muted-foreground">{a.description}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Test fixtures</CardTitle>
            <CardDescription>Cards and mobile money numbers for testing</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {testCards.map((c) => (
              <div key={c.number} className="flex items-center gap-3 rounded-lg border bg-card/50 p-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-md bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                  {c.brand === 'Mobile money' ? <Wallet className="h-4 w-4" /> : <Coins className="h-4 w-4" />}
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

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Webhook inspector</CardTitle>
            <CardDescription>Inspect webhook delivery attempts</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-12 text-center">
              <TestTube className="h-6 w-6 text-muted-foreground" />
              <h3 className="mt-3 text-sm font-semibold">No deliveries yet</h3>
              <p className="mt-1 max-w-xs text-xs text-muted-foreground">
                Trigger a sandbox event (e.g. complete a payment) to see webhook deliveries here.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
