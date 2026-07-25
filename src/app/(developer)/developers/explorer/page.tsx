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
import { Compass, Play, Terminal } from 'lucide-react';

export const dynamic = 'force-dynamic';

const endpoints = [
  { method: 'POST', path: '/v1/payments' },
  { method: 'GET', path: '/v1/payments' },
  { method: 'GET', path: '/v1/payments/{id}' },
  { method: 'POST', path: '/v1/payouts' },
  { method: 'GET', path: '/v1/wallets' },
  { method: 'POST', path: '/v1/webhook-endpoints' },
];

const methodTone: Record<string, string> = {
  GET: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
  POST: 'bg-teal-500/15 text-teal-600 dark:text-teal-400',
  PATCH: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
  DELETE: 'bg-rose-500/15 text-rose-600 dark:text-rose-400',
};

export default async function DeveloperExplorerPage() {
  const session = await getServerSession(authOptions);

  return (
    <div className="space-y-6">
      <PageHeader
        title="API explorer"
        description="Browse endpoints and inspect example responses."
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Endpoints</CardTitle>
            <CardDescription>Select an endpoint to inspect</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {endpoints.length === 0 ? (
              <EmptyState
                icon={<Compass className="h-6 w-6" />}
                title="No endpoints"
                description="Endpoints will be listed here."
              />
            ) : (
              endpoints.map((e) => (
                <button
                  key={e.path + e.method}
                  type="button"
                  className="flex w-full items-center gap-3 rounded-lg border bg-card/50 p-3 text-left transition-colors hover:bg-muted/40"
                >
                  <Badge className={`shrink-0 font-mono text-[10px] ${methodTone[e.method]}`} variant="secondary">
                    {e.method}
                  </Badge>
                  <span className="font-mono text-xs font-semibold">{e.path}</span>
                  <Play className="ml-auto h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                </button>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Response</CardTitle>
            <CardDescription>Example response payload</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3 text-xs">
              <Terminal className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
              <span className="font-medium">200 OK · application/json</span>
            </div>
            <pre className="mt-3 overflow-x-auto rounded-lg border bg-card/50 p-4 text-[11px] leading-relaxed">
              <code className="font-mono text-foreground">{`{
  "id": "pay_2c8f1a9e4b7d6038",
  "reference": "order_1234",
  "amount": 1000,
  "currency": "GHS",
  "status": "COMPLETED",
  "method": "MOBILE_MONEY",
  "fee": 5,
  "netAmount": 995,
  "createdAt": "2025-07-25T09:42:18.000Z",
  "settledAt": "2025-07-25T09:42:21.000Z"
}`}</code>
            </pre>
            <div className="mt-3 rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
              Interactive request execution is coming soon. For now, copy the curl example from the
              overview page to make live requests against the sandbox.
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
