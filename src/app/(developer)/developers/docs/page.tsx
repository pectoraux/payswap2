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
import { PageHeader, EmptyState } from '@/components/role-ui';
import { BookOpen, ArrowRight } from 'lucide-react';

export const dynamic = 'force-dynamic';

interface EndpointDoc {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  path: string;
  title: string;
  description: string;
}

const endpoints: { group: string; items: EndpointDoc[] }[] = [
  {
    group: 'Payments',
    items: [
      { method: 'POST', path: '/v1/payments', title: 'Create payment', description: 'Initiate a new payment intent for a customer.' },
      { method: 'GET', path: '/v1/payments', title: 'List payments', description: 'Paginated list of payments for the merchant.' },
      { method: 'GET', path: '/v1/payments/{id}', title: 'Retrieve payment', description: 'Fetch a single payment by ID or reference.' },
      { method: 'POST', path: '/v1/payments/{id}/refund', title: 'Refund payment', description: 'Issue a full or partial refund.' },
    ],
  },
  {
    group: 'Payouts',
    items: [
      { method: 'POST', path: '/v1/payouts', title: 'Create payout', description: 'Send funds to a bank or mobile money account.' },
      { method: 'GET', path: '/v1/payouts', title: 'List payouts', description: 'Paginated list of payouts.' },
    ],
  },
  {
    group: 'Wallets',
    items: [
      { method: 'GET', path: '/v1/wallets', title: 'List wallets', description: 'Balances across the merchant currency wallets.' },
      { method: 'GET', path: '/v1/wallets/{id}/transactions', title: 'Wallet transactions', description: 'Transaction history for a wallet.' },
    ],
  },
  {
    group: 'Webhooks',
    items: [
      { method: 'POST', path: '/v1/webhook-endpoints', title: 'Create endpoint', description: 'Register a webhook URL to receive events.' },
      { method: 'GET', path: '/v1/webhook-endpoints', title: 'List endpoints', description: 'List configured webhook endpoints.' },
    ],
  },
];

const methodTone: Record<EndpointDoc['method'], string> = {
  GET: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
  POST: 'bg-teal-500/15 text-teal-600 dark:text-teal-400',
  PATCH: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
  DELETE: 'bg-rose-500/15 text-rose-600 dark:text-rose-400',
};

export default async function DeveloperDocsPage() {
  const session = await getServerSession(authOptions);

  return (
    <div className="space-y-6">
      <PageHeader
        title="API documentation"
        description="REST API reference for the PaySwap platform."
      />

      <Card>
        <CardContent>
          <div className="flex items-start gap-3 rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-4">
            <BookOpen className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600 dark:text-emerald-400" />
            <div>
              <div className="text-sm font-semibold">Base URL</div>
              <p className="mt-1 text-xs text-muted-foreground">
                All requests should be made to{' '}
                <code className="rounded bg-card/80 px-1.5 py-0.5 font-mono">https://api.payswap.io</code>.
                Authenticate with a Bearer token in the <code className="font-mono">Authorization</code> header.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {endpoints.length === 0 ? (
        <Card>
          <CardContent>
            <EmptyState
              icon={<BookOpen className="h-6 w-6" />}
              title="No endpoints documented"
              description="API reference will appear here."
            />
          </CardContent>
        </Card>
      ) : (
        endpoints.map((g) => (
          <Card key={g.group}>
            <CardHeader>
              <CardTitle className="text-base">{g.group}</CardTitle>
              <CardDescription>{g.items.length} endpoint{g.items.length === 1 ? '' : 's'}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {g.items.map((e) => (
                <div
                  key={e.path + e.method}
                  className="flex items-center gap-3 rounded-lg border bg-card/50 p-3 transition-colors hover:bg-muted/40"
                >
                  <Badge className={`shrink-0 font-mono text-[10px] ${methodTone[e.method]}`} variant="secondary">
                    {e.method}
                  </Badge>
                  <div className="min-w-0 flex-1">
                    <div className="font-mono text-xs font-semibold">{e.path}</div>
                    <div className="text-xs text-muted-foreground">{e.description}</div>
                  </div>
                  <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                </div>
              ))}
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
}
