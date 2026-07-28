'use client';

import * as React from 'react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Webhook,
  Send,
  Loader2,
  Clock,
  CheckCircle2,
  AlertCircle,
  LinkIcon,
  Plus,
  Trash2,
  Check,
  Copy,
} from 'lucide-react';
import { toast } from 'sonner';

const EVENT_OPTIONS = [
  'payment.created',
  'payment.completed',
  'payment.failed',
  'payout.created',
  'payout.completed',
  'payout.failed',
  'refund.created',
  'refund.completed',
  'invoice.paid',
  'invoice.overdue',
  'customer.created',
  'extension.installed',
  'extension.uninstalled',
] as const;

export interface EndpointView {
  id: string;
  url: string;
  events: string;
  status: string;
  createdAt: string;
  deliveryCount: number;
  successRate: number | null;
  lastDeliveryAt: string | null;
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

interface Props {
  initialEndpoints: EndpointView[];
  initialDeliveries: DeliveryView[];
}

function parseEvents(raw: string): string[] {
  try {
    const v = JSON.parse(raw);
    if (Array.isArray(v)) return v.filter((x) => typeof x === 'string');
  } catch {
    // fall through — also accept comma-separated.
  }
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function endpointHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function fmtTime(iso: string | null): string {
  if (!iso) return '—';
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

function AddEndpointDialog({
  onCreated,
  trigger,
}: {
  onCreated: () => void;
  trigger: React.ReactNode;
}) {
  const [open, setOpen] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [url, setUrl] = React.useState('');
  const [events, setEvents] = React.useState<string[]>(['payment.completed']);
  const [newSecret, setNewSecret] = React.useState<string | null>(null);
  const [copied, setCopied] = React.useState(false);

  React.useEffect(() => {
    if (!open) {
      setTimeout(() => {
        setUrl('');
        setEvents(['payment.completed']);
        setNewSecret(null);
        setCopied(false);
      }, 200);
    }
  }, [open]);

  function toggleEvent(e: string) {
    setEvents((prev) =>
      prev.includes(e) ? prev.filter((x) => x !== e) : [...prev, e],
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!url.trim()) {
      toast.error('URL is required');
      return;
    }
    if (events.length === 0) {
      toast.error('Select at least one event type');
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch('/api/developer/webhooks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url.trim(), events }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data?.error || 'Failed to add endpoint');
      }
      setNewSecret(data.secret);
      toast.success('Endpoint registered');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to add endpoint');
    } finally {
      setSubmitting(false);
    }
  }

  async function copySecret() {
    if (!newSecret) return;
    try {
      await navigator.clipboard.writeText(newSecret);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
      toast.success('Signing secret copied');
    } catch {
      toast.error('Failed to copy');
    }
  }

  function handleClose() {
    if (newSecret) onCreated();
    setOpen(false);
  }

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? setOpen(true) : handleClose())}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-md">
        {newSecret ? (
          <>
            <DialogHeader>
              <DialogTitle>Copy your signing secret</DialogTitle>
              <DialogDescription>
                Use this to verify webhook signatures. You won&apos;t see it again.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <code className="flex-1 truncate rounded-md border bg-card/50 p-2 font-mono text-[11px]">
                  {newSecret}
                </code>
                <Button type="button" size="sm" onClick={copySecret} variant="outline">
                  {copied ? (
                    <>
                      <Check className="mr-1.5 h-3.5 w-3.5" /> Copied
                    </>
                  ) : (
                    <>
                      <Copy className="mr-1.5 h-3.5 w-3.5" /> Copy
                    </>
                  )}
                </Button>
              </div>
            </div>
            <DialogFooter>
              <Button type="button" onClick={handleClose} className="bg-emerald-600 text-white hover:bg-emerald-700">
                Done
              </Button>
            </DialogFooter>
          </>
        ) : (
          <form onSubmit={handleSubmit}>
            <DialogHeader>
              <DialogTitle>Add webhook endpoint</DialogTitle>
              <DialogDescription>
                We&apos;ll POST signed events to this URL whenever they occur.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-3">
              <div className="space-y-1.5">
                <Label htmlFor="wh-url">Endpoint URL</Label>
                <Input
                  id="wh-url"
                  placeholder="https://example.com/webhooks/payswap"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label>Events to subscribe</Label>
                <div className="grid max-h-60 gap-2 overflow-y-auto sm:grid-cols-2">
                  {EVENT_OPTIONS.map((ev) => {
                    const checked = events.includes(ev);
                    return (
                      <label
                        key={ev}
                        htmlFor={`evt-${ev}`}
                        className="flex cursor-pointer items-center gap-2 rounded-md border p-2 text-xs transition-colors hover:bg-muted/40"
                      >
                        <Checkbox
                          id={`evt-${ev}`}
                          checked={checked}
                          onCheckedChange={() => toggleEvent(ev)}
                        />
                        <span className="font-mono">{ev}</span>
                      </label>
                    );
                  })}
                </div>
                <p className="text-[10px] text-muted-foreground">
                  {events.length} event{events.length === 1 ? '' : 's'} selected
                </p>
              </div>
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setOpen(false)}
                disabled={submitting}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={submitting}
                className="bg-emerald-600 text-white hover:bg-emerald-700"
              >
                {submitting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Adding…
                  </>
                ) : (
                  <>
                    <Plus className="mr-2 h-4 w-4" /> Add endpoint
                  </>
                )}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

function EndpointCard({
  endpoint,
  onChanged,
}: {
  endpoint: EndpointView;
  onChanged: () => void;
}) {
  const [deleting, setDeleting] = React.useState(false);
  const [testing, setTesting] = React.useState(false);
  const [eventType, setEventType] = React.useState(
    parseEvents(endpoint.events)[0] ?? 'payment.completed',
  );

  const events = parseEvents(endpoint.events);
  const successPct =
    endpoint.successRate != null
      ? `${(endpoint.successRate * 100).toFixed(0)}%`
      : '—';

  async function handleDelete() {
    setDeleting(true);
    try {
      const res = await fetch(`/api/developer/webhooks/${endpoint.id}`, {
        method: 'DELETE',
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data?.error || 'Failed to remove endpoint');
      }
      toast.success('Endpoint removed');
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to remove');
    } finally {
      setDeleting(false);
    }
  }

  async function handleTest() {
    setTesting(true);
    try {
      const res = await fetch(`/api/developer/webhooks/${endpoint.id}/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventType }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data?.error || 'Failed to send test event');
      }
      toast.success(`Test ${eventType} delivered (${data.delivery.responseStatus ?? 'OK'})`);
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to send test');
    } finally {
      setTesting(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
              <LinkIcon className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <CardTitle className="truncate font-mono text-xs">
                {endpointHost(endpoint.url)}
              </CardTitle>
              <CardDescription className="mt-0.5 truncate font-mono text-[10px]">
                {endpoint.url}
              </CardDescription>
            </div>
          </div>
          <Badge
            className={`shrink-0 text-[10px] ${
              endpoint.status === 'ACTIVE'
                ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                : 'bg-muted text-muted-foreground'
            }`}
            variant="secondary"
          >
            {endpoint.status}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-3 gap-2 text-center">
          <div>
            <div className="text-sm font-semibold tabular-nums">{endpoint.deliveryCount}</div>
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Deliveries</div>
          </div>
          <div>
            <div className="text-sm font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">
              {successPct}
            </div>
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Success</div>
          </div>
          <div>
            <div className="text-[10px] font-medium tabular-nums text-muted-foreground">
              {endpoint.lastDeliveryAt ? fmtTime(endpoint.lastDeliveryAt) : 'Never'}
            </div>
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Last delivery</div>
          </div>
        </div>

        <div>
          <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            Subscribed
          </div>
          <div className="mt-1 flex flex-wrap gap-1">
            {events.length === 0 ? (
              <span className="text-xs text-muted-foreground">No events</span>
            ) : (
              events.map((ev) => (
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
            <Select value={eventType} onValueChange={setEventType}>
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
            onClick={handleTest}
            disabled={testing}
            className="bg-emerald-600 text-white hover:bg-emerald-700"
            size="sm"
          >
            {testing ? (
              <>
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> Sending…
              </>
            ) : (
              <>
                <Send className="mr-1.5 h-3.5 w-3.5" /> Send test
              </>
            )}
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                size="sm"
                variant="outline"
                className="border-rose-500/40 text-rose-600 hover:bg-rose-500/10 dark:text-rose-400"
                disabled={deleting}
              >
                {deleting ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Trash2 className="h-3.5 w-3.5" />
                )}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Remove this endpoint?</AlertDialogTitle>
                <AlertDialogDescription>
                  We&apos;ll stop sending events to this URL. Delivery history will also be removed.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={handleDelete}
                  disabled={deleting}
                  className="bg-rose-600 text-white hover:bg-rose-700"
                >
                  Remove endpoint
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </CardContent>
    </Card>
  );
}

export function WebhooksManager({ initialEndpoints, initialDeliveries }: Props) {
  const [endpoints, setEndpoints] = React.useState<EndpointView[]>(initialEndpoints);
  const [deliveries, setDeliveries] = React.useState<DeliveryView[]>(initialDeliveries);
  const [tick, setTick] = React.useState(0);

  const reload = React.useCallback(async () => {
    try {
      const res = await fetch('/api/developer/webhooks', { cache: 'no-store' });
      const data = await res.json();
      if (data.ok) {
        setEndpoints(data.endpoints);
        setDeliveries(data.deliveries);
      }
    } catch (err) {
      console.error('[webhooks] reload failed:', err);
    }
    setTick((t) => t + 1);
  }, []);

  return (
    <div className="space-y-6" data-tick={tick}>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted-foreground">
          {endpoints.length === 0
            ? 'Register an endpoint to start receiving events.'
            : `${endpoints.length} endpoint${endpoints.length === 1 ? '' : 's'} registered.`}
        </p>
        <AddEndpointDialog
          onCreated={reload}
          trigger={
            <Button className="bg-emerald-600 text-white hover:bg-emerald-700">
              <Plus className="mr-2 h-4 w-4" /> Add endpoint
            </Button>
          }
        />
      </div>

      {endpoints.length === 0 ? (
        <Card>
          <CardContent className="p-6">
            <div className="flex flex-col items-center justify-center py-10 text-center">
              <Webhook className="h-10 w-10 text-muted-foreground/50 mb-3" />
              <p className="text-sm font-medium">No webhook endpoints yet</p>
              <p className="mt-1 max-w-sm text-xs text-muted-foreground">
                Register an endpoint to receive real-time event deliveries when payments, payouts,
                refunds and more happen in your sandbox.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {endpoints.map((ep) => (
            <EndpointCard key={ep.id} endpoint={ep} onChanged={reload} />
          ))}
        </div>
      )}

      {/* Recent deliveries */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent deliveries</CardTitle>
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
                Send a test event above to see delivery results here.
              </p>
            </div>
          ) : (
            <ul className="max-h-96 divide-y divide-border overflow-y-auto">
              {deliveries.map((d) => {
                const ok = d.status === 'DELIVERED';
                const errored = d.status === 'FAILED' || (d.responseStatus ?? 0) >= 400;
                const endpoint = endpoints.find((e) => e.id === d.endpointId);
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
                        <span className="ml-auto truncate font-mono text-[10px] text-muted-foreground">
                          {endpointHost(endpoint.url)}
                        </span>
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
    </div>
  );
}
