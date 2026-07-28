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
import { Copy, KeyRound, Loader2, Plus, Trash2, Check, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';

const SCOPES = [
  { value: 'read:payments', label: 'Read payments' },
  { value: 'write:payments', label: 'Write payments' },
  { value: 'read:payouts', label: 'Read payouts' },
  { value: 'write:payouts', label: 'Write payouts' },
  { value: 'read:customers', label: 'Read customers' },
  { value: 'write:customers', label: 'Write customers' },
  { value: 'read:webhooks', label: 'Read webhooks' },
  { value: 'write:webhooks', label: 'Write webhooks' },
  { value: 'admin', label: 'Admin (full access)' },
];

export interface ApiKeyView {
  id: string;
  label: string;
  keyPrefix: string;
  scopes: string;
  status: string;
  lastUsedAt: string | null;
  createdAt: string;
  expiresAt: string | null;
}

interface ApiKeysManagerProps {
  initialKeys: ApiKeyView[];
}

function parseScopes(raw: string): string[] {
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

function inferEnv(keyPrefix: string): 'test' | 'live' {
  return keyPrefix.startsWith('sk_live_') ? 'live' : 'test';
}

function fmtTime(iso: string | null): string {
  if (!iso) return 'Never';
  try {
    return new Date(iso).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

function CreateKeyDialog({
  environment,
  onCreated,
  trigger,
}: {
  environment: 'test' | 'live';
  onCreated: () => void;
  trigger: React.ReactNode;
}) {
  const [open, setOpen] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [label, setLabel] = React.useState('');
  const [scopes, setScopes] = React.useState<string[]>(['read:payments', 'write:payments']);
  const [newKey, setNewKey] = React.useState<string | null>(null);
  const [copied, setCopied] = React.useState(false);

  React.useEffect(() => {
    if (!open) {
      setTimeout(() => {
        setLabel('');
        setScopes(['read:payments', 'write:payments']);
        setNewKey(null);
        setCopied(false);
      }, 200);
    }
  }, [open]);

  function toggleScope(s: string) {
    setScopes((prev) =>
      prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s],
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (label.trim().length < 2) {
      toast.error('Label must be at least 2 characters');
      return;
    }
    if (scopes.length === 0) {
      toast.error('Select at least one scope');
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch('/api/developer/api-keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: label.trim(), scopes, environment }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data?.error || 'Failed to create key');
      }
      setNewKey(data.key);
      toast.success(`${environment === 'test' ? 'Test' : 'Live'} key created`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create key');
    } finally {
      setSubmitting(false);
    }
  }

  async function copyKey() {
    if (!newKey) return;
    try {
      await navigator.clipboard.writeText(newKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
      toast.success('Key copied to clipboard');
    } catch {
      toast.error('Failed to copy');
    }
  }

  function handleClose() {
    if (newKey) {
      onCreated();
    }
    setOpen(false);
  }

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? setOpen(true) : handleClose())}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-md">
        {newKey ? (
          <>
            <DialogHeader>
              <DialogTitle>Copy your {environment} key</DialogTitle>
              <DialogDescription>
                This is the only time you&apos;ll see the full key. Store it somewhere safe.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div className="rounded-lg border bg-amber-500/5 p-3 text-xs">
                <div className="flex items-center gap-2 font-semibold text-amber-700 dark:text-amber-400">
                  <AlertTriangle className="h-4 w-4" />
                  Don&apos;t lose this key
                </div>
                <p className="mt-1 text-muted-foreground">
                  We only store a SHA-256 hash. If you lose it, you&apos;ll need to revoke and create a new one.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <code className="flex-1 truncate rounded-md border bg-card/50 p-2 font-mono text-[11px]">
                  {newKey}
                </code>
                <Button type="button" size="sm" onClick={copyKey} variant="outline">
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
              <DialogTitle>
                Create {environment === 'test' ? 'test' : 'live'} key
              </DialogTitle>
              <DialogDescription>
                {environment === 'test'
                  ? 'Test keys never move real money — use them in your dev environment.'
                  : "Live keys move real money. Only create one when you're ready to accept production traffic."}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-3">
              <div className="space-y-1.5">
                <Label htmlFor="key-label">Label</Label>
                <Input
                  id="key-label"
                  placeholder="e.g. Backend production server"
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  maxLength={64}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label>Scopes</Label>
                <div className="grid gap-2 sm:grid-cols-2">
                  {SCOPES.map((s) => {
                    const checked = scopes.includes(s.value);
                    return (
                      <label
                        key={s.value}
                        htmlFor={`scope-${s.value}`}
                        className="flex cursor-pointer items-center gap-2 rounded-md border p-2.5 text-xs transition-colors hover:bg-muted/40"
                      >
                        <Checkbox
                          id={`scope-${s.value}`}
                          checked={checked}
                          onCheckedChange={() => toggleScope(s.value)}
                        />
                        <span>{s.label}</span>
                      </label>
                    );
                  })}
                </div>
                <p className="text-[10px] text-muted-foreground">
                  {scopes.length} scope{scopes.length === 1 ? '' : 's'} selected
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
                className={
                  environment === 'live'
                    ? 'bg-rose-600 text-white hover:bg-rose-700'
                    : 'bg-emerald-600 text-white hover:bg-emerald-700'
                }
              >
                {submitting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Creating…
                  </>
                ) : (
                  <>
                    <Plus className="mr-2 h-4 w-4" /> Create key
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

function KeyRow({
  apiKey,
  onChanged,
}: {
  apiKey: ApiKeyView;
  onChanged: () => void;
}) {
  const [revoking, setRevoking] = React.useState(false);
  const scopes = parseScopes(apiKey.scopes);
  const env = inferEnv(apiKey.keyPrefix);

  async function handleRevoke() {
    setRevoking(true);
    try {
      const res = await fetch(`/api/developer/api-keys/${apiKey.id}`, {
        method: 'DELETE',
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data?.error || 'Failed to revoke key');
      }
      toast.success('Key revoked');
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to revoke');
    } finally {
      setRevoking(false);
    }
  }

  const isRevoked = apiKey.status === 'REVOKED';

  return (
    <div className="rounded-lg border bg-card/50 p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold">{apiKey.label}</span>
            <Badge
              className={
                env === 'live'
                  ? 'bg-rose-500/15 text-rose-600 dark:text-rose-400'
                  : 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
              }
              variant="secondary"
            >
              {env}
            </Badge>
            <Badge
              className={
                isRevoked
                  ? 'bg-muted text-muted-foreground'
                  : 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
              }
              variant="secondary"
            >
              {apiKey.status}
            </Badge>
          </div>
          <div className="mt-1 flex items-center gap-1.5 font-mono text-[10px] text-muted-foreground">
            <Copy className="h-3 w-3" />
            {apiKey.keyPrefix}…
          </div>
          <div className="mt-1 flex flex-wrap gap-1">
            {scopes.length === 0 ? (
              <span className="text-[10px] text-muted-foreground">No scopes</span>
            ) : (
              scopes.map((s) => (
                <span
                  key={s}
                  className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-mono"
                >
                  {s}
                </span>
              ))
            )}
          </div>
          <div className="mt-1.5 flex gap-4 text-[10px] text-muted-foreground">
            <span>Created: {fmtTime(apiKey.createdAt)}</span>
            <span>Last used: {fmtTime(apiKey.lastUsedAt)}</span>
          </div>
        </div>
        <div className="shrink-0">
          {!isRevoked && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  size="sm"
                  variant="outline"
                  className="border-rose-500/40 text-rose-600 hover:bg-rose-500/10 dark:text-rose-400"
                  disabled={revoking}
                >
                  {revoking ? (
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                  )}
                  Revoke
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Revoke this API key?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Any application using this key will stop working immediately.
                    This action cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel disabled={revoking}>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={handleRevoke}
                    disabled={revoking}
                    className="bg-rose-600 text-white hover:bg-rose-700"
                  >
                    Revoke key
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </div>
      </div>
    </div>
  );
}

function KeysSection({
  title,
  description,
  environment,
  keys,
  onCreated,
  onChanged,
}: {
  title: string;
  description: string;
  environment: 'test' | 'live';
  keys: ApiKeyView[];
  onCreated: () => void;
  onChanged: () => void;
}) {
  const filtered = keys
    .filter((k) => inferEnv(k.keyPrefix) === environment)
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <span
                className={`flex h-2 w-2 rounded-full ${
                  environment === 'live' ? 'bg-rose-500' : 'bg-emerald-500'
                }`}
              />
              {title}
            </CardTitle>
            <CardDescription>{description}</CardDescription>
          </div>
          <CreateKeyDialog
            environment={environment}
            onCreated={onCreated}
            trigger={
              <Button
                size="sm"
                className={
                  environment === 'live'
                    ? 'bg-rose-600 text-white hover:bg-rose-700'
                    : 'bg-emerald-600 text-white hover:bg-emerald-700'
                }
              >
                <Plus className="mr-1.5 h-3.5 w-3.5" /> Create key
              </Button>
            }
          />
        </div>
      </CardHeader>
      <CardContent>
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-10 text-center">
            <KeyRound className="h-8 w-8 text-muted-foreground/50 mb-2" />
            <p className="text-sm font-medium">No {environment} keys yet</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {environment === 'test'
                ? 'Create a test key to start integrating — test keys never move real money.'
                : "Create a live key when you're ready to accept production payments."}
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {filtered.map((k) => (
              <KeyRow key={k.id} apiKey={k} onChanged={onChanged} />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function ApiKeysManager({ initialKeys }: ApiKeysManagerProps) {
  const [keys, setKeys] = React.useState<ApiKeyView[]>(initialKeys);

  const reload = React.useCallback(() => {
    if (typeof window !== 'undefined') {
      window.location.reload();
    }
  }, []);

  // Touch setKeys so the linter doesn't complain about unused state setter.
  void setKeys;

  return (
    <div className="space-y-6">
      <KeysSection
        title="Test keys"
        description="Use test keys in your dev environment. They never move real money."
        environment="test"
        keys={keys}
        onCreated={reload}
        onChanged={reload}
      />
      <KeysSection
        title="Live keys"
        description="Live keys move real money. Rotate regularly and never commit them to a repo."
        environment="live"
        keys={keys}
        onCreated={reload}
        onChanged={reload}
      />
    </div>
  );
}
