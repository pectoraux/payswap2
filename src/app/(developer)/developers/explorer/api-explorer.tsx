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
} from 'lucide-react';
import { toast } from 'sonner';

type HttpMethod = 'GET' | 'POST';

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
}

const ENDPOINTS: EndpointDef[] = [
  {
    id: 'simulate',
    method: 'GET',
    path: '/api/simulate',
    title: 'Simulate (default scenario)',
    description: 'Returns the default kernel simulation scenario + metadata.',
  },
  {
    id: 'payments-create',
    method: 'POST',
    path: '/api/payments/create',
    title: 'Create payment',
    description: 'Creates a new Payment record for the authenticated merchant.',
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
  "description": "Premium cocoa bag"
}`,
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
    id: 'merchant-state',
    method: 'GET',
    path: '/api/merchant/state',
    title: 'Merchant state',
    description: 'Returns the full merchant dashboard state (balances, payouts, webhooks, analytics).',
    defaultPath: '/api/merchant/state?merchantId=<your-merchant-id>',
  },
];

const methodTone: Record<HttpMethod, string> = {
  GET: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
  POST: 'bg-teal-500/15 text-teal-600 dark:text-teal-400',
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
  const [selectedId, setSelectedId] = useState<string>(ENDPOINTS[0].id);
  const [path, setPath] = useState<string>(ENDPOINTS[0].defaultPath ?? ENDPOINTS[0].path);
  const [body, setBody] = useState<string>('');
  const [response, setResponse] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  const selected = useMemo(
    () => ENDPOINTS.find((e) => e.id === selectedId) ?? ENDPOINTS[0],
    [selectedId],
  );

  function selectEndpoint(ep: EndpointDef) {
    setSelectedId(ep.id);
    // Prefill the path — for merchant state, substitute the real merchantId.
    if (ep.id === 'merchant-state' && merchantId) {
      setPath(`/api/merchant/state?merchantId=${merchantId}`);
    } else {
      setPath(ep.defaultPath ?? ep.path);
    }
    setBody(ep.defaultBody ?? '');
    setResponse(null);
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
      if (selected.method === 'POST') {
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

  return (
    <div className="space-y-6">
      <PageHeader
        title="API explorer"
        description="Make live requests against the PaySwap API and inspect the response."
      />

      <div className="grid gap-6 lg:grid-cols-12">
        {/* ───────── Endpoints ───────── */}
        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle className="text-base">Endpoints</CardTitle>
            <CardDescription>Select an endpoint to test</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
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
              {selected.id === 'merchant-state' && !merchantId && (
                <p className="text-[11px] text-amber-600 dark:text-amber-400">
                  You don&apos;t have a merchant role on file — replace{' '}
                  <code className="font-mono">&lt;your-merchant-id&gt;</code> with a valid ID.
                </p>
              )}
            </div>

            {selected.method === 'POST' && (
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
