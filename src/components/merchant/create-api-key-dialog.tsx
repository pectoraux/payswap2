'use client';

import { useState } from 'react';
import { KeyRound, Loader2, Copy, Check, AlertTriangle } from 'lucide-react';
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

const SCOPES = [
  { value: 'payments:read', label: 'payments:read' },
  { value: 'payments:write', label: 'payments:write' },
  { value: 'payouts:read', label: 'payouts:read' },
  { value: 'payouts:write', label: 'payouts:write' },
  { value: 'webhooks:read', label: 'webhooks:read' },
] as const;

export function CreateApiKeyDialog() {
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [label, setLabel] = useState('');
  const [selected, setSelected] = useState<string[]>(['payments:read']);
  const [plainKey, setPlainKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  function reset() {
    setLabel('');
    setSelected(['payments:read']);
    setPlainKey(null);
    setCopied(false);
  }

  function toggleScope(value: string) {
    setSelected((prev) =>
      prev.includes(value) ? prev.filter((s) => s !== value) : [...prev, value],
    );
  }

  async function handleCopy() {
    if (!plainKey) return;
    try {
      await navigator.clipboard.writeText(plainKey);
      setCopied(true);
      toast.success('API key copied to clipboard');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Could not copy to clipboard');
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!label.trim()) {
      toast.error('Please provide a label');
      return;
    }
    if (selected.length === 0) {
      toast.error('Select at least one scope');
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch('/api/api-keys/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: label.trim(), scopes: selected }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || 'Failed to create API key');
      }
      toast.success('API key created');
      setPlainKey(data.key as string);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create API key');
    } finally {
      setSubmitting(false);
    }
  }

  function handleOpenChange(v: boolean) {
    if (!v && plainKey) {
      // Closing after a key was revealed — reload so the new key shows up in
      // the table.
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
          <KeyRound className="mr-2 h-4 w-4" /> Create API Key
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        {plainKey ? (
          <div className="space-y-4">
            <DialogHeader>
              <DialogTitle>Your new API key</DialogTitle>
              <DialogDescription>
                Copy this key now — it will not be shown again.
              </DialogDescription>
            </DialogHeader>
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>This key won&apos;t be shown again</AlertTitle>
              <AlertDescription>
                We only store a hashed copy. If you lose it you will have to
                revoke and regenerate the key.
              </AlertDescription>
            </Alert>
            <div className="flex items-center gap-2">
              <Input
                readOnly
                value={plainKey}
                className="font-mono text-xs"
                onFocus={(e) => e.currentTarget.select()}
              />
              <Button
                type="button"
                size="icon"
                variant="outline"
                onClick={handleCopy}
                aria-label="Copy API key"
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
              <DialogTitle>Create API key</DialogTitle>
              <DialogDescription>
                Generate a secret key your applications can use to authenticate
                API requests.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-1.5">
              <Label htmlFor="ak-label">Label</Label>
              <Input
                id="ak-label"
                placeholder="e.g. Production server"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                required
              />
            </div>

            <div className="space-y-2">
              <Label>Scopes</Label>
              <div className="grid gap-2">
                {SCOPES.map((s) => (
                  <label
                    key={s.value}
                    htmlFor={`scope-${s.value}`}
                    className="flex items-center gap-2 rounded-md border bg-card/40 p-2 text-sm cursor-pointer hover:bg-accent"
                  >
                    <Checkbox
                      id={`scope-${s.value}`}
                      checked={selected.includes(s.value)}
                      onCheckedChange={() => toggleScope(s.value)}
                    />
                    <span className="font-mono text-xs">{s.label}</span>
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
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Generating…
                  </>
                ) : (
                  'Generate key'
                )}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
