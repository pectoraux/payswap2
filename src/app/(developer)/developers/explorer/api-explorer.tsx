'use client';

import { useMemo, useState } from 'react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { PageHeader } from '@/components/role-ui';
import {
  Loader2,
  Copy,
  Check,
  Compass,
  Send,
  Clock,
  CheckCircle2,
  AlertCircle,
  ShieldAlert,
  Building2,
} from 'lucide-react';
import { toast } from 'sonner';

type HttpMethod = 'GET' | 'POST' | 'DELETE';

interface EndpointDef {
  id: string;
  method: HttpMethod;
  path: string;
  title: string;
  description: string;
  /** Default path used to populate the request builder (may include query string). */
  defaultPath?: string;
  /** Placeholder shown inside the body editor. */
  bodyPlaceholder?: string;
  /** Initial body content. */
  defaultBody?: string;
  /** Which merchantId-substituted path to use when one is available. */
  substitutesMerchantId?: 'query' | 'body';
  /** Optional query key for merchantId substitution (default: merchantId). */
  merchantIdQueryKey?: string;
}

const ENDPOINTS: EndpointDef[] = [
  {
    id: 'payments-create',
    method: 'POST',
    path: '/api/payments/create',
    title: 'Create payment',
    description:
      'Creates a new Payment record. Developers automatically act on their sandbox merchant, so no merchantId is required in the body.',
    bodyPlaceholder: `{
  "amount": 1000,
  "currency": "GHS",
  "method": "mobile_money",
  "description": "Premium cocoa bag",
  "customerEmail": "kofi@example.com",
  "customerName": "Kofi Mensah"
}`,
    defaultBody: `{
  "amount": 1000,
  "currency": "GHS",
  "method": "mobile_money",
  "description": "Premium cocoa bag",
  "customerEmail": "kofi@example.com",
  "customerName": "Kofi Mensah"
}`,
  },
  {
    id: 'payments-list',
    method: 'GET',
    path: '/api/payments',
    title: 'List payments',
    description: 'Returns recent payments for the resolved merchant scope.',
    defaultPath: '/api/payments?limit=20',
  },
  {
    id: 'payouts-create',
    method: 'POST',
    path: '/api/payouts/create',
    title: 'Create payout',
    description: 'Creates a new payout to a bank, mobile money, or on-chain destination.',
    bodyPlaceholder: `{
  "method": "bank",
  "sourceAmount": 500,
  "sourceCurrency": "GHS",
  "destinationCurrency": "USD",
  "destination": { "account": "0123456789", "bank": "Ecobank Ghana" }
}`,
    defaultBody: `{
  "method": "bank",
  "sourceAmount": 500,
  "sourceCurrency": "GHS",
  "destinationCurrency": "USD",
  "destination": { "account": "0123456789", "bank": "Ecobank Ghana" }
}`,
  },
  {
    id: 'invoices-create',
    method: 'POST',
    path: '/api/invoices/create',
    title: 'Create invoice',
    description: 'Creates a new invoice with line items.',
    bodyPlaceholder: `{
  "customerEmail": "kofi@example.com",
  "items": [{ "description": "Cocoa bag (50kg)", "quantity": 2, "unitPrice": 250 }],
  "currency": "GHS",
  "dueDate": "2026-12-31"
}`,
    defaultBody: `{
  "customerEmail": "kofi@example.com",
  "items": [{ "description": "Cocoa bag (50kg)", "quantity": 2, "unitPrice": 250 }],
  "currency": "GHS",
  "dueDate": "2026-12-31"
}`,
  },
  {
    id: 'payment-links-create',
    method: 'POST',
    path: '/api/payment-links/create',
    title: 'Create payment link',
    description: 'Creates a reusable payment link.',
    bodyPlaceholder: `{
  "amount": 100,
  "currency": "GHS",
  "description": "1x PaySwap sticker"
}`,
    defaultBody: `{
  "amount": 100,
  "currency": "GHS",
  "description": "1x PaySwap sticker"
}`,
  },
  {
    id: 'customers-create',
    method: 'POST',
    path: '/api/customers/create',
    title: 'Create customer',
    description: 'Creates or upserts a customer record for the resolved merchant.',
    bodyPlaceholder: `{
  "name": "Ama Serwaa",
  "email": "ama@example.com",
  "phone": "+233244555666",
  "country": "Ghana"
}`,
    defaultBody: `{
  "name": "Ama Serwaa",
  "email": "ama@example.com",
  "phone": "+233244555666",
  "country": "Ghana"
}`,
  },
  {
    id: 'api-keys-create',
    method: 'POST',
    path: '/api/api-keys/create',
    title: 'Create API key',
    description: 'Creates a new API key for the resolved merchant. The plain key is returned once.',
    bodyPlaceholder: `{
  "label": "Sandbox test key",
  "scopes": ["payments:write", "payouts:write"]
}`,
    defaultBody: `{
  "label": "Sandbox test key",
  "scopes": ["payments:write", "payouts:write"]
}`,
  },
  {
    id: 'webhooks-create',
    method: 'POST',
    path: '/api/webhooks/create',
    title: 'Create webhook endpoint',
    description: 'Registers a webhook endpoint. The signing secret is returned once.',
    bodyPlaceholder: `{
  "url": "https://example.com/webhooks/payswap",
  "events": ["payment.created", "payment.settled", "payout.created"]
}`,
    defaultBody: `{
  "url": "https://example.com/webhooks/payswap",
  "events": ["payment.created", "payment.settled", "payout.created"]
}`,
  },
  {
    id: 'merchant-state',
    method: 'GET',
    path: '/api/merchant/state',
    title: 'Merchant state',
    description: 'Returns the full merchant dashboard state (balances, payouts, webhooks, analytics).',
    defaultPath: '/api/merchant/state?merchantId=<your-merchant-id>',
    substitutesMerchantId: 'query',
  },
  {
    id: 'activity',
    method: 'GET',
    path: '/api/activity?limit=10',
    title: 'Activity feed',
    description: 'Returns a unified merchant activity feed (payments, payouts, refunds, webhooks).',
    defaultPath: '/api/activity?limit=10',
  },
  {
    id: 'simulate',
    method: 'GET',
    path: '/api/simulate',
    title: 'Simulate (default scenario)',
    description: 'Returns the default kernel simulation scenario + metadata.',
  },
];

const methodTone: Record<HttpMethod, string> = {
  GET: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
  POST: 'bg-teal-500/15 text-teal-600 dark:text-teal-400',
  DELETE: 'bg-rose-500/15 text-rose-600 dark:text-rose-400',
};

interface ApiResponse {
  status: number;
  statusText: string;
  durationMs: number;
  body: unknown;
  error?: string;
}

interface ApiExplorerProps {
  merchantId: string | null;
}

export function ApiExplorer({ merchantId }: ApiExplorerProps) {
  const [selectedId, setSelectedId] = useState<string>('payments-create');
  const [path, setPath] = useState<string>('/api/payments/create');
  const [body, setBody] = useState<string>(
    ENDPOINTS.find((e) => e.id === 'payments-create')?.defaultBody ?? '',
  );
  const [response, setResponse] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  const selected = useMemo(
    () => ENDPOINTS.find((e) => e.id === selectedId) ?? ENDPOINTS[0],
    [selectedId],
  );

  function selectEndpoint(ep: EndpointDef) {
    setSelectedId(ep.id);
    // For endpoints that take a merchantId in the query, substitute it now.
    if (ep.substitutesMerchantId === 'query' && merchantId) {
      const key = ep.merchantIdQueryKey ?? 'merchantId';
      setPath(`/${ep.path.replace(/^\//, '')}?${key}=${merchantId}`);
    } else {
      setPath(ep.defaultPath ?? ep.path);
    }
    setBody(ep.defaultBody ?? '');
    setResponse(null);
  }

  function explainStatus(status: number): string | null {
    if (status === 0) {
      return 'Network error — the dev server may have restarted. Please retry.';
    }
    if (status === 401) {
      return 'Unauthorized — your session expired. Refresh the page and sign in again.';
    }
    if (status === 403) {
      return merchantId
        ? 'Forbidden — the server declined to act on the resolved merchant. If this persists, ask an admin to verify your developer sandbox.'
        : 'Forbidden — your account is not linked to a merchant. Developers should automatically fall back to the sandbox merchant; if you see this, the merchant table may be empty (run `bun run scripts/seed.ts`).';
    }
    if (status === 404) {
      return 'Not found — check the path spelling.';
    }
    if (status >= 500) {
      return 'Server error — the dev server may be out of memory. Wait a few seconds and retry.';
    }
    return null;
  }

  async function sendRequest() {
    setLoading(true);
    setResponse(null);
    const startedAt = performance.now();
    try {
      const init: RequestInit = {
        method: selected.method,
        credentials: 'same-origin',
        headers: {} as Record<string, string>,
      };
      if (selected.method === 'POST' || selected.method === 'DELETE') {
        (init.headers as Record<string, string>)['Content-Type'] = 'application/json';
        init.body = body.trim() ? body : '{}';
      }

      const res = await fetch(path, init);
      const durationMs = Math.round(performance.now() - startedAt);
      const text = await res.text();
      let parsed: unknown = text;
      try {
        parsed = JSON.parse(text);
      } catch {
        // keep raw text
      }
      setResponse({
        status: res.status,
        statusText: res.statusText,
        durationMs,
        body: parsed,
      });
    } catch (err) {
      const durationMs = Math.round(performance.now() - startedAt);
      setResponse({
        status: 0,
        statusText: 'Network error',
        durationMs,
        body: null,
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setLoading(false);
    }
  }

  async function copyResponse() {
    if (!response) return;
    try {
      await navigator.clipboard.writeText(
        typeof response.body === 'string'
          ? response.body
          : JSON.stringify(response.body, null, 2),
      );
      setCopied(true);
      toast.success('Response copied to clipboard');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Could not copy to clipboard');
    }
  }

  const responseText = response
    ? typeof response.body === 'string'
      ? response.body
      : JSON.stringify(response.body, null, 2)
    : '';

  const isSuccess = response ? response.status >= 200 && response.status < 300 : false;
  const isError = response ? response.status === 0 || response.status >= 400 : false;
  const statusExplanation = response ? explainStatus(response.status) : null;

  return (
    <div className="space-y-6">
      <PageHeader
        title="API explorer"
        description="Make live requests against the PaySwap API and inspect the response."
      />

      {/* Merchant context banner */}
      <Card className={merchantId ? 'border-emerald-500/20' : 'border-amber-500/30'}>
        <CardContent className="flex flex-wrap items-center gap-3 p-4">
          <div
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-md ${
              merchantId
                ? 'bg-emerald-500/10 text-emerald-600'
                : 'bg-amber-500/10 text-amber-600'
            }`}
          >
            <Building2 className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Acting merchant
            </div>
            {merchantId ? (
              <div className="mt-0.5 truncate font-mono text-xs text-foreground">
                {merchantId}
              </div>
            ) : (
              <div className="mt-0.5 text-xs text-amber-700 dark:text-amber-300">
                No merchant resolved — payment/payout endpoints will return 403.
                Run <code className="font-mono">bun run scripts/seed.ts</code> to
                seed the demo merchant.
              </div>
            )}
          </div>
          {merchantId && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                navigator.clipboard.writeText(merchantId);
                toast.success('Merchant ID copied');
              }}
            >
              <Copy className="mr-1.5 h-3.5 w-3.5" /> Copy ID
            </Button>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-12">
        {/* ───────── Endpoints ───────── */}
        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle className="text-base">Endpoints</CardTitle>
            <CardDescription>Select an endpoint to test</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 max-h-[640px] overflow-y-auto">
            {ENDPOINTS.map((ep) => {
              const active = ep.id === selectedId;
              return (
                <button
                  key={ep.id}
                  type="button"
                  onClick={() => selectEndpoint(ep)}
                  className={`flex w-full items-start gap-3 rounded-lg border p-3 text-left transition-colors ${
                    active
                      ? 'border-emerald-500/40 bg-emerald-500/5'
                      : 'border-border bg-card/50 hover:bg-muted/40'
                  }`}
                >
                  <Badge
                    className={`shrink-0 font-mono text-[10px] ${methodTone[ep.method]}`}
                    variant="secondary"
                  >
                    {ep.method}
                  </Badge>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs font-semibold">{ep.title}</div>
                    <div className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground">
                      {ep.path}
                    </div>
                  </div>
                </button>
              );
            })}
          </CardContent>
        </Card>

        {/* ───────── Request builder ───────── */}
        <Card className="lg:col-span-4">
          <CardHeader>
            <CardTitle className="text-base">Request</CardTitle>
            <CardDescription>{selected.description}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Method &amp; path
              </label>
              <div className="flex items-center gap-2">
                <Badge
                  className={`shrink-0 font-mono text-[10px] ${methodTone[selected.method]}`}
                  variant="secondary"
                >
                  {selected.method}
                </Badge>
                <Input
                  value={path}
                  onChange={(e) => setPath(e.target.value)}
                  className="font-mono text-xs"
                  spellCheck={false}
                  autoComplete="off"
                />
              </div>
              {selected.substitutesMerchantId === 'query' && !merchantId && (
                <p className="text-[11px] text-amber-600 dark:text-amber-400">
                  You don&apos;t have a merchant role on file — replace{' '}
                  <code className="font-mono">&lt;your-merchant-id&gt;</code> with a valid ID.
                </p>
              )}
            </div>

            {(selected.method === 'POST' || selected.method === 'DELETE') && (
              <div className="space-y-1.5">
                <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Request body (JSON)
                </label>
                <Textarea
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  className="min-h-[220px] font-mono text-xs"
                  placeholder={selected.bodyPlaceholder}
                  spellCheck={false}
                />
              </div>
            )}

            {selected.method === 'GET' && (
              <div className="rounded-lg border border-dashed bg-muted/20 p-3 text-xs text-muted-foreground">
                GET requests do not include a body. Add query params directly in the path above
                (e.g. <code className="font-mono">?limit=10&amp;type=payment</code>).
              </div>
            )}

            <Button
              onClick={sendRequest}
              disabled={loading || !path.trim()}
              className="w-full bg-emerald-600 text-white hover:bg-emerald-700"
            >
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Sending…
                </>
              ) : (
                <>
                  <Send className="mr-2 h-4 w-4" /> Send request
                </>
              )}
            </Button>
          </CardContent>
        </Card>

        {/* ───────── Response viewer ───────── */}
        <Card className="lg:col-span-5">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-base">Response</CardTitle>
                <CardDescription>
                  {response ? `${response.status} ${response.statusText}` : 'No request sent yet'}
                </CardDescription>
              </div>
              {response && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={copyResponse}
                  disabled={!responseText}
                >
                  {copied ? (
                    <>
                      <Check className="mr-1.5 h-3.5 w-3.5 text-emerald-600" /> Copied
                    </>
                  ) : (
                    <>
                      <Copy className="mr-1.5 h-3.5 w-3.5" /> Copy
                    </>
                  )}
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {!response && !loading && (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <Compass className="h-10 w-10 text-muted-foreground/50 mb-3" />
                <p className="text-sm font-medium">No response yet</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Pick an endpoint, configure the request, and hit{' '}
                  <span className="font-medium">Send request</span>.
                </p>
              </div>
            )}

            {loading && (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <Loader2 className="h-8 w-8 animate-spin text-emerald-600 mb-3" />
                <p className="text-sm font-medium">Awaiting response…</p>
              </div>
            )}

            {response && !loading && (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge
                    className={`font-mono text-[10px] ${
                      isSuccess
                        ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                        : isError
                          ? 'bg-rose-500/15 text-rose-600 dark:text-rose-400'
                          : 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
                    }`}
                    variant="secondary"
                  >
                    {isSuccess ? (
                      <CheckCircle2 className="h-3 w-3" />
                    ) : isError ? (
                      <AlertCircle className="h-3 w-3" />
                    ) : null}
                    {response.status === 0 ? 'ERR' : response.status}
                  </Badge>
                  <Badge
                    className="font-mono text-[10px] text-muted-foreground"
                    variant="secondary"
                  >
                    <Clock className="h-3 w-3" />
                    {response.durationMs} ms
                  </Badge>
                  {response.error && (
                    <span className="text-[11px] text-rose-600 dark:text-rose-400">
                      {response.error}
                    </span>
                  )}
                </div>

                {statusExplanation && isError && (
                  <div
                    className={`flex items-start gap-2 rounded-lg border p-3 text-xs ${
                      response.status === 401 || response.status === 403
                        ? 'border-amber-500/30 bg-amber-500/[0.04] text-amber-800 dark:text-amber-200'
                        : 'border-rose-500/30 bg-rose-500/[0.04] text-rose-800 dark:text-rose-200'
                    }`}
                  >
                    <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <span className="leading-relaxed">{statusExplanation}</span>
                  </div>
                )}

                <pre className="max-h-[480px] overflow-auto rounded-lg border bg-card/50 p-4 text-[11px] leading-relaxed">
                  <code className="font-mono text-foreground">{responseText || '<empty body>'}</code>
                </pre>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
