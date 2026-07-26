'use client';

import { useState } from 'react';
import { Webhook, Loader2, Copy, Check, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

const EVENTS = [
  { value: 'payment.created', label: 'payment.created' },
  { value: 'payment.completed', label: 'payment.completed' },
  { value: 'payment.failed', label: 'payment.failed' },
  { value: 'payout.completed', label: 'payout.completed' },
] as const;

export function CreateWebhookDialog() {
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [url, setUrl] = useState('');
  const [selected, setSelected] = useState<string[]>(['payment.created']);
  const [secret, setSecret] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  function reset() {
    setUrl('');
    setSelected(['payment.created']);
    setSecret(null);
    setCopied(false);
  }

  function toggleEvent(value: string) {
    setSelected((prev) =>
      prev.includes(value) ? prev.filter((s) => s !== value) : [...prev, value],
    );
  }

  async function handleCopy() {
    if (!secret) return;
    try {
      await navigator.clipboard.writeText(secret);
      setCopied(true);
      toast.success('Secret copied to clipboard');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Could not copy to clipboard');
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!url.trim()) {
      toast.error('Please provide a URL');
      return;
    }
    if (selected.length === 0) {
      toast.error('Subscribe to at least one event');
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch('/api/webhooks/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url.trim(), events: selected }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || 'Failed to create webhook');
      }
      toast.success('Webhook endpoint registered');
      setSecret(data.secret as string);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create webhook');
    } finally {
      setSubmitting(false);
    }
  }

  function handleOpenChange(v: boolean) {
    if (!v && secret) {
      setOpen(false);
      setTimeout(() => {
        reset();
        window.location.reload();
      }, 200);
      return;
    }
    setOpen(v);
    if (!v) reset();
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button className="bg-emerald-600 text-white hover:bg-emerald-700">
          <Webhook className="mr-2 h-4 w-4" /> Add Endpoint
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        {secret ? (
          <div className="space-y-4">
            <DialogHeader>
              <DialogTitle>Webhook signing secret</DialogTitle>
              <DialogDescription>
                Copy this secret now — it will not be shown again.
              </DialogDescription>
            </DialogHeader>
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>This secret won&apos;t be shown again</AlertTitle>
              <AlertDescription>
                Use it to verify the <code>X-PaySwap-Signature</code> header on
                incoming webhook deliveries.
              </AlertDescription>
            </Alert>
            <div className="flex items-center gap-2">
              <Input
                readOnly
                value={secret}
                className="font-mono text-xs"
                onFocus={(e) => e.currentTarget.select()}
              />
              <Button
                type="button"
                size="icon"
                variant="outline"
                onClick={handleCopy}
                aria-label="Copy secret"
              >
                {copied ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
              </Button>
            </div>
            <DialogFooter>
              <Button
                type="button"
                className="bg-emerald-600 text-white hover:bg-emerald-700"
                onClick={() => handleOpenChange(false)}
              >
                Done
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <DialogHeader>
              <DialogTitle>Add webhook endpoint</DialogTitle>
              <DialogDescription>
                Register a URL to receive real-time event payloads from PaySwap.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-1.5">
              <Label htmlFor="wh-url">Endpoint URL</Label>
              <Input
                id="wh-url"
                type="url"
                placeholder="https://example.com/webhooks/payswap"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                required
              />
            </div>

            <div className="space-y-2">
              <Label>Events</Label>
              <div className="grid gap-2">
                {EVENTS.map((ev) => (
                  <label
                    key={ev.value}
                    htmlFor={`event-${ev.value}`}
                    className="flex items-center gap-2 rounded-md border bg-card/40 p-2 text-sm cursor-pointer hover:bg-accent"
                  >
                    <Checkbox
                      id={`event-${ev.value}`}
                      checked={selected.includes(ev.value)}
                      onCheckedChange={() => toggleEvent(ev.value)}
                    />
                    <span className="font-mono text-xs">{ev.label}</span>
                  </label>
                ))}
              </div>
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => handleOpenChange(false)}
                disabled={submitting}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                className="bg-emerald-600 text-white hover:bg-emerald-700"
                disabled={submitting}
              >
                {submitting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Registering…
                  </>
                ) : (
                  'Register endpoint'
                )}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
