'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { PageHeader } from '@/components/role-ui';
import {
  Webhook,
  Send,
  Loader2,
  Clock,
  CheckCircle2,
  AlertCircle,
  LinkIcon,
  ArrowRight,
  ExternalLink,
} from 'lucide-react';
import { toast } from 'sonner';

export interface EndpointView {
  id: string;
  url: string;
  events: string[];
  status: string;
  createdAt: string;
}

export interface DeliveryView {
  id: string;
  endpointId: string;
  eventType: string;
  status: string;
  responseStatus: number | null;
  responseBody: string | null;
  attempts: number;
  createdAt: string;
  deliveredAt: string | null;
}

interface PendingTest {
  endpointId: string;
  eventType: string;
}

interface WebhookTesterProps {
  endpoints: EndpointView[];
  recentDeliveries: DeliveryView[];
  hasMerchant: boolean;
}

const EVENT_OPTIONS = [
  'payment.created',
  'payment.completed',
  'payment.failed',
  'payout.completed',
];

function endpointHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function fmtTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    return iso;
  }
}

export function WebhookTester({
  endpoints,
  recentDeliveries,
  hasMerchant,
}: WebhookTesterProps) {
  // Per-endpoint selected event type, keyed by endpoint id.
  const [selectedEvents, setSelectedEvents] = useState<Record<string, string>>(
    () =>
      Object.fromEntries(
        endpoints.map((e) => [e.id, e.events[0] ?? 'payment.created']),
      ),
  );
  const [pending, setPending] = useState<PendingTest[]>([]);
  const [deliveries, setDeliveries] = useState<DeliveryView[]>(recentDeliveries);

  function setEvent(endpointId: string, eventType: string) {
    setSelectedEvents((prev) => ({ ...prev, [endpointId]: eventType }));
  }

  async function sendTest(endpoint: EndpointView) {
    const eventType = selectedEvents[endpoint.id] ?? 'payment.created';
    setPending((prev) => [...prev, { endpointId: endpoint.id, eventType }]);
    try {
      const res = await fetch('/api/webhooks/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpointId: endpoint.id, eventType }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || 'Failed to send test event');
      }
      const d = data.delivery;
      const newDelivery: DeliveryView = {
        id: d.id,
        endpointId: d.endpointId ?? endpoint.id,
        eventType: d.eventType,
        status: d.status,
        responseStatus: d.responseStatus,
        responseBody: d.responseBody,
        attempts: 1,
        createdAt: d.deliveredAt ?? new Date().toISOString(),
        deliveredAt: d.deliveredAt ?? null,
      };
      setDeliveries((prev) => [newDelivery, ...prev].slice(0, 50));
      const ok = newDelivery.status === 'DELIVERED';
      toast.success(
        ok
          ? `Test ${eventType} delivered (${newDelivery.responseStatus ?? 'OK'})`
          : `Test ${eventType} failed: ${newDelivery.responseBody ?? 'no response'}`,
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to send test event');
    } finally {
      setPending((prev) =>
        prev.filter((p) => !(p.endpointId === endpoint.id && p.eventType === eventType)),
      );
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Webhook tester"
        description="Send test events to your webhook endpoints and inspect delivery results."
      />

      {!hasMerchant ? (
        <Card>
          <CardContent className="p-6">
            <div className="flex flex-col items-center justify-center py-10 text-center">
              <Webhook className="h-10 w-10 text-muted-foreground/50 mb-3" />
              <p className="text-sm font-medium">No merchant account linked</p>
              <p className="mt-1 max-w-sm text-xs text-muted-foreground">
                Webhook endpoints are scoped to a merchant. Log in as a merchant
                user to register and test endpoints.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : endpoints.length === 0 ? (
        <Card>
          <CardContent className="p-6">
            <div className="flex flex-col items-center justify-center py-10 text-center">
              <Webhook className="h-10 w-10 text-muted-foreground/50 mb-3" />
              <p className="text-sm font-medium">No webhook endpoints yet</p>
              <p className="mt-1 max-w-sm text-xs text-muted-foreground">
                Register an endpoint from your merchant webhook settings to start
                testing deliveries.
              </p>
              <Button asChild className="mt-4 bg-emerald-600 text-white hover:bg-emerald-700" size="sm">
                <Link href="/dashboard/settings/webhooks">
                  Register endpoint <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
                </Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* ───────── Endpoints ───────── */}
          <div className="grid gap-4 md:grid-cols-2">
            {endpoints.map((ep) => {
              const isPending = pending.some((p) => p.endpointId === ep.id);
              const selected = selectedEvents[ep.id] ?? 'payment.created';
              return (
                <Card key={ep.id}>
                  <CardHeader>
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex min-w-0 items-center gap-2">
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                          <LinkIcon className="h-4 w-4" />
                        </div>
                        <div className="min-w-0">
                          <CardTitle className="truncate font-mono text-xs">
                            {endpointHost(ep.url)}
                          </CardTitle>
                          <CardDescription className="mt-0.5 truncate font-mono text-[10px]">
                            {ep.url}
                          </CardDescription>
                        </div>
                      </div>
                      <Badge
                        className={`shrink-0 text-[10px] ${
                          ep.status === 'ACTIVE'
                            ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                            : 'bg-muted text-muted-foreground'
                        }`}
                        variant="secondary"
                      >
                        {ep.status}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div>
                      <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                        Subscribed
                      </div>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {ep.events.length === 0 ? (
                          <span className="text-xs text-muted-foreground">No events</span>
                        ) : (
                          ep.events.map((ev) => (
                            <span
                              key={ev}
                              className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-600 dark:text-emerald-400"
                            >
                              {ev}
                            </span>
                          ))
                        )}
                      </div>
                    </div>

                    <div className="flex items-end gap-2">
                      <div className="flex-1 space-y-1">
                        <label className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                          Test event
                        </label>
                        <Select value={selected} onValueChange={(v) => setEvent(ep.id, v)}>
                          <SelectTrigger className="w-full" size="sm">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {EVENT_OPTIONS.map((ev) => (
                              <SelectItem key={ev} value={ev}>
                                {ev}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <Button
                        onClick={() => sendTest(ep)}
                        disabled={isPending}
                        className="bg-emerald-600 text-white hover:bg-emerald-700"
                        size="sm"
                      >
                        {isPending ? (
                          <>
                            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> Sending…
                          </>
                        ) : (
                          <>
                            <Send className="mr-1.5 h-3.5 w-3.5" /> Send test
                          </>
                        )}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>

          {/* ───────── Recent deliveries ───────── */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Recent test deliveries</CardTitle>
              <CardDescription>
                {deliveries.length} delivery{deliveries.length === 1 ? '' : 'ies'} recorded
              </CardDescription>
            </CardHeader>
            <CardContent>
              {deliveries.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <Clock className="h-10 w-10 text-muted-foreground/50 mb-3" />
                  <p className="text-sm font-medium">No deliveries yet</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Send a test event above to see the delivery result here.
                  </p>
                </div>
              ) : (
                <ul className="max-h-96 divide-y divide-border overflow-y-auto">
                  {deliveries.map((d) => {
                    const endpoint = endpoints.find((e) => e.id === d.endpointId);
                    const ok = d.status === 'DELIVERED';
                    const errored = d.status === 'FAILED' || (d.responseStatus ?? 0) >= 400;
                    return (
                      <li key={d.id} className="py-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge
                            className={`font-mono text-[10px] ${
                              ok
                                ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                                : errored
                                  ? 'bg-rose-500/15 text-rose-600 dark:text-rose-400'
                                  : 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
                            }`}
                            variant="secondary"
                          >
                            {ok ? <CheckCircle2 className="h-3 w-3" /> : <AlertCircle className="h-3 w-3" />}
                            {d.status}
                          </Badge>
                          <span className="font-mono text-xs font-medium">{d.eventType}</span>
                          {d.responseStatus !== null && (
                            <span className="font-mono text-[10px] text-muted-foreground">
                              HTTP {d.responseStatus}
                            </span>
                          )}
                          {endpoint && (
                            <a
                              href={endpoint.url}
                              target="_blank"
                              rel="noreferrer"
                              className="ml-auto inline-flex items-center gap-1 truncate font-mono text-[10px] text-emerald-600 hover:underline dark:text-emerald-400"
                            >
                              <ExternalLink className="h-3 w-3 shrink-0" />
                              <span className="truncate">{endpointHost(endpoint.url)}</span>
                            </a>
                          )}
                          <span className="text-[10px] text-muted-foreground">
                            {fmtTime(d.createdAt)}
                          </span>
                        </div>
                        {d.responseBody && (
                          <pre className="mt-2 max-h-32 overflow-auto rounded-md border bg-card/50 p-2 text-[10px] leading-relaxed">
                            <code className="font-mono text-foreground">{d.responseBody}</code>
                          </pre>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
