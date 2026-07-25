'use client';

import { useState } from 'react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Check, Loader2, Puzzle } from 'lucide-react';
import { toast } from 'sonner';

export type ExtensionCategory =
  | 'Payments'
  | 'Analytics'
  | 'Compliance'
  | 'Marketing'
  | 'Accounting';

export type ExtensionIconKey =
  | 'book'
  | 'mail'
  | 'message'
  | 'zap'
  | 'shopping'
  | 'store'
  | 'puzzle';

export interface ExtensionDef {
  id: string;
  name: string;
  description: string;
  category: string;
  icon: ExtensionIconKey;
}

export interface DecoratedExtension extends ExtensionDef {
  installed: boolean;
  tone: string;
  iconNode: React.ReactNode;
}

interface ExtensionsGridProps {
  extensions: DecoratedExtension[];
}

/**
 * Read the installed extensions array out of the merchant settings JSON
 * returned by GET /api/merchant/settings.
 */
function readInstalled(raw: unknown): Set<string> {
  if (!raw || typeof raw !== 'object') return new Set();
  const obj = raw as { installedExtensions?: unknown };
  if (Array.isArray(obj.installedExtensions)) {
    return new Set(
      obj.installedExtensions.filter(
        (e): e is string => typeof e === 'string',
      ),
    );
  }
  return new Set();
}

export function ExtensionsGrid({ extensions }: ExtensionsGridProps) {
  // Local mirror so the UI updates instantly on install / uninstall without
  // waiting for a re-fetch. Server-rendered initial state seeds this.
  const [items, setItems] = useState(extensions);
  const [pending, setPending] = useState<string | null>(null);

  async function fetchSettings(): Promise<Record<string, unknown>> {
    const res = await fetch('/api/merchant/settings', { cache: 'no-store' });
    if (!res.ok) return {};
    const data = await res.json();
    const settings = data?.merchant?.settings;
    return settings && typeof settings === 'object'
      ? (settings as Record<string, unknown>)
      : {};
  }

  async function persistSettings(settings: Record<string, unknown>) {
    const res = await fetch('/api/merchant/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ settings }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data?.error || 'Failed to save settings');
    }
  }

  async function handleInstall(id: string) {
    setPending(id);
    try {
      const current = await fetchSettings();
      const currentSet = readInstalled(current);
      currentSet.add(id);
      const next = { ...current, installedExtensions: Array.from(currentSet) };
      await persistSettings(next);
      setItems((prev) =>
        prev.map((e) => (e.id === id ? { ...e, installed: true } : e)),
      );
      toast.success('Extension installed');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to install');
    } finally {
      setPending(null);
    }
  }

  async function handleUninstall(id: string) {
    setPending(id);
    try {
      const current = await fetchSettings();
      const currentSet = readInstalled(current);
      currentSet.delete(id);
      const next = { ...current, installedExtensions: Array.from(currentSet) };
      await persistSettings(next);
      setItems((prev) =>
        prev.map((e) => (e.id === id ? { ...e, installed: false } : e)),
      );
      toast.success('Extension uninstalled');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to uninstall');
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {items.map((e) => (
        <Card key={e.id} className="flex flex-col">
          <CardHeader>
            <div className="flex items-start gap-3">
              <div
                className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${e.tone}`}
              >
                {e.iconNode}
              </div>
              <div className="min-w-0 flex-1">
                <CardTitle className="text-base">{e.name}</CardTitle>
                <div className="mt-1">
                  <Badge
                    variant="secondary"
                    className={`text-[9px] ${e.tone}`}
                  >
                    {e.category}
                  </Badge>
                </div>
              </div>
            </div>
          </CardHeader>
          <CardContent className="flex flex-1 flex-col gap-4">
            <CardDescription className="flex-1 text-xs leading-relaxed">
              {e.description}
            </CardDescription>
            {e.installed ? (
              <div className="flex flex-col gap-2">
                <Button variant="outline" disabled className="w-full">
                  <Check className="mr-2 h-3.5 w-3.5 text-emerald-500" /> Installed
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full text-muted-foreground hover:text-rose-500"
                  disabled={pending === e.id}
                  onClick={() => handleUninstall(e.id)}
                >
                  {pending === e.id ? (
                    <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Puzzle className="mr-2 h-3.5 w-3.5" />
                  )}
                  Uninstall
                </Button>
              </div>
            ) : (
              <Button
                className="w-full bg-emerald-600 text-white hover:bg-emerald-700"
                disabled={pending === e.id}
                onClick={() => handleInstall(e.id)}
              >
                {pending === e.id ? (
                  <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Puzzle className="mr-2 h-3.5 w-3.5" />
                )}
                Install
              </Button>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
