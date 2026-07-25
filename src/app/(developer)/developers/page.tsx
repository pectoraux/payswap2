import Link from 'next/link';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { PageHeader } from '@/components/role-ui';
import {
  BookOpen,
  Compass,
  FlaskConical,
  KeyRound,
  Terminal,
  Copy,
  ArrowRight,
  Code2,
  Webhook,
} from 'lucide-react';

export const dynamic = 'force-dynamic';

// Examples below target the real, same-origin PaySwap API paths the explorer
// hits — they double as the canonical "how do I call this?" snippet.
const curlExample = `# Create a 1,000 GHS mobile-money payment
curl -X POST https://api.payswap.io/api/payments/create \\
  -H "Authorization: Bearer psk_live_xxx" \\
  -H "Content-Type: application/json" \\
  -d '{
    "amount": 1000,
    "currency": "GHS",
    "method": "mobile_money",
    "description": "Premium cocoa bag",
    "customerEmail": "kofi@example.com",
    "customerName": "Kofi Mensah"
  }'

# → 201 Created
# {
#   "payment": {
#     "id": "pay_2c8f1a9e4b7d6038",
#     "reference": "PAY-2C8F1A9E",
#     "amount": 1000,
#     "currency": "GHS",
#     "method": "mobile_money",
#     "status": "PENDING",
#     "netAmount": 1000,
#     "createdAt": "2025-07-25T09:42:18.000Z"
#   }
# }`;

const tsExample = `import { PaySwap } from '@payswap/sdk';

const payswap = new PaySwap({
  apiKey: process.env.PAYSWAP_SECRET_KEY!, // psk_live_…
  // Use https://api.payswap.io in production
  baseUrl: process.env.PAYSWAP_BASE_URL!,
});

// Create a 1,000 GHS mobile-money payment
const { payment } = await payswap.payments.create({
  amount: 1000,
  currency: 'GHS',
  method: 'mobile_money',
  description: 'Premium cocoa bag',
  customerEmail: 'kofi@example.com',
  customerName: 'Kofi Mensah',
});

console.log(payment.reference, payment.status); // PAY-2C8F1A9E PENDING

// Fetch a unified activity feed (payments, payouts, refunds, webhooks)
const { items } = await payswap.activity.list({ limit: 10 });`;

const webhookExample = `// Verify an incoming webhook (Node / Express)
import { createHmac } from 'crypto';

app.post('/webhooks/payswap', express.raw({ type: 'application/json' }), (req, res) => {
  const signature = req.headers['x-payswap-signature'] as string;
  const expected = createHmac('sha256', process.env.PAYSWAP_WEBHOOK_SECRET!)
    .update(req.body)
    .digest('hex');

  if (signature !== expected) {
    return res.status(401).send('invalid signature');
  }

  const event = JSON.parse(req.body.toString());
  // event.type === 'payment.completed' | 'payment.failed' | 'payout.completed' | …
  console.log(event.type, event.data);
  res.json({ received: true });
});`;

export default async function DeveloperOverviewPage() {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as any)?.id as string | undefined;

  // Look up the developer's merchant API keys (if they have a merchant role)
  const userRole = userId
    ? await db.userRole.findFirst({
        where: { userId, role: { in: ['MERCHANT', 'MERCHANT_STAFF', 'DEVELOPER'] } },
      })
    : null;

  const apiKeys = userRole?.merchantId
    ? await db.apiKey.findMany({
        where: { merchantId: userRole.merchantId, status: 'ACTIVE' },
        take: 5,
      })
    : [];

  const baseUrl = 'https://api.payswap.io';

  return (
    <div className="space-y-6">
      <PageHeader
        title="Developer portal"
        description="Everything you need to integrate with the PaySwap API."
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="group relative overflow-hidden">
          <CardContent className="p-5">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
              <BookOpen className="h-5 w-5" />
            </div>
            <h3 className="mt-3 text-base font-semibold">API Docs</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              Reference for every endpoint, parameter and response shape.
            </p>
            <Button asChild variant="ghost" size="sm" className="mt-3 -ml-2 text-emerald-600 dark:text-emerald-400">
              <Link href="/developers/docs">
                Read docs <ArrowRight className="ml-1 h-3.5 w-3.5" />
              </Link>
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-5">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-teal-500/10 text-teal-600 dark:text-teal-400">
              <Compass className="h-5 w-5" />
            </div>
            <h3 className="mt-3 text-base font-semibold">API Explorer</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              Make live requests against the sandbox and inspect responses.
            </p>
            <Button asChild variant="ghost" size="sm" className="mt-3 -ml-2 text-emerald-600 dark:text-emerald-400">
              <Link href="/developers/explorer">
                Open explorer <ArrowRight className="ml-1 h-3.5 w-3.5" />
              </Link>
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-5">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-cyan-500/10 text-cyan-600 dark:text-cyan-400">
              <Webhook className="h-5 w-5" />
            </div>
            <h3 className="mt-3 text-base font-semibold">Webhook Tester</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              Send test events to your endpoints and debug delivery results.
            </p>
            <Button asChild variant="ghost" size="sm" className="mt-3 -ml-2 text-emerald-600 dark:text-emerald-400">
              <Link href="/developers/webhooks">
                Test webhooks <ArrowRight className="ml-1 h-3.5 w-3.5" />
              </Link>
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-5">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-violet-500/10 text-violet-600 dark:text-violet-400">
              <FlaskConical className="h-5 w-5" />
            </div>
            <h3 className="mt-3 text-base font-semibold">Sandbox</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              Test account funded with virtual GHS, KES and USDC for end-to-end testing.
            </p>
            <Button asChild variant="ghost" size="sm" className="mt-3 -ml-2 text-emerald-600 dark:text-emerald-400">
              <Link href="/developers/sandbox">
                Launch sandbox <ArrowRight className="ml-1 h-3.5 w-3.5" />
              </Link>
            </Button>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Quick start</CardTitle>
            <CardDescription>
              Make your first payment request in under a minute — base URL:{' '}
              <code className="font-mono text-xs">{baseUrl}</code>
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <Terminal className="h-3.5 w-3.5" /> curl
              </div>
              <pre className="overflow-x-auto rounded-lg border bg-card/50 p-4 text-[11px] leading-relaxed">
                <code className="font-mono text-foreground">{curlExample}</code>
              </pre>
            </div>
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <Code2 className="h-3.5 w-3.5" /> TypeScript
              </div>
              <pre className="overflow-x-auto rounded-lg border bg-card/50 p-4 text-[11px] leading-relaxed">
                <code className="font-mono text-foreground">{tsExample}</code>
              </pre>
            </div>
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <Webhook className="h-3.5 w-3.5" /> Webhook verification
              </div>
              <pre className="overflow-x-auto rounded-lg border bg-card/50 p-4 text-[11px] leading-relaxed">
                <code className="font-mono text-foreground">{webhookExample}</code>
              </pre>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">API keys</CardTitle>
              <Button asChild variant="ghost" size="sm" className="-mr-2 text-emerald-600 dark:text-emerald-400">
                <Link href="/dashboard/settings/api-keys">
                  Manage <ArrowRight className="ml-1 h-3.5 w-3.5" />
                </Link>
              </Button>
            </div>
            <CardDescription>Authenticate every API request</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {apiKeys.length === 0 ? (
              <div className="rounded-lg border border-dashed p-4 text-xs text-muted-foreground">
                <KeyRound className="mb-2 h-5 w-5 text-amber-500" />
                No active API keys found. Generate one from your merchant API
                key settings to start integrating.
                <Button asChild variant="outline" size="sm" className="mt-3 w-full">
                  <Link href="/dashboard/settings/api-keys">
                    Generate API key <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
                  </Link>
                </Button>
              </div>
            ) : (
              apiKeys.map((k) => (
                <div key={k.id} className="rounded-lg border bg-card/50 p-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold">{k.label}</span>
                    <Badge className="bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" variant="secondary">
                      {k.status}
                    </Badge>
                  </div>
                  <div className="mt-1 flex items-center gap-1.5 font-mono text-[10px] text-muted-foreground">
                    <Copy className="h-3 w-3" />
                    {k.keyPrefix}…
                  </div>
                </div>
              ))
            )}
            <div className="rounded-lg border bg-card/50 p-3 text-xs">
              <div className="flex items-center gap-2">
                <Webhook className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                <span className="font-medium">Webhooks</span>
              </div>
              <p className="mt-1 text-muted-foreground">
                Subscribe to events like{' '}
                <code className="font-mono">payment.completed</code> and{' '}
                <code className="font-mono">payout.completed</code>.
              </p>
              <Button asChild variant="outline" size="sm" className="mt-3 w-full">
                <Link href="/dashboard/settings/webhooks">
                  Configure endpoints <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
                </Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
