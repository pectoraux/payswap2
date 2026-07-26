'use client';

import { useState } from 'react';
import { Loader2, Save, Zap, Sliders } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';

export interface LpSettingsData {
  id: string;
  name: string;
  country: string;
  currencies: string[];
  tier: string;
  stake: number;
  collateral: number;
  available: number;
  capacity: Record<string, number>;
  feeBps: Record<string, number>;
  settlementSpeedMs: number;
  reputation: number;
  status: string;
}

function fmtCurrency(n: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(n);
}

export function LpSettingsForm({ lp }: { lp: LpSettingsData }) {
  const corridors = Object.keys(lp.capacity).sort();

  // Local editable state seeded from the server data.
  const [feeBps, setFeeBps] = useState<Record<string, string>>(
    Object.fromEntries(
      corridors.map((c) => [c, String(lp.feeBps[c] ?? 50)]),
    ),
  );
  const [capacity, setCapacity] = useState<Record<string, string>>(
    Object.fromEntries(
      corridors.map((c) => [c, String(lp.capacity[c] ?? 0)]),
    ),
  );
  const [speedMs, setSpeedMs] = useState<number>(lp.settlementSpeedMs || 2000);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);

    // Build payloads — only send values that parse cleanly.
    const feeBpsPayload: Record<string, number> = {};
    const capacityPayload: Record<string, number> = {};
    for (const c of corridors) {
      const fee = parseFloat(feeBps[c] ?? '');
      if (Number.isFinite(fee)) feeBpsPayload[c] = fee;
      const cap = parseFloat(capacity[c] ?? '');
      if (Number.isFinite(cap)) capacityPayload[c] = cap;
    }

    try {
      const res = await fetch('/api/lp/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          feeBps: feeBpsPayload,
          settlementSpeedMs: speedMs,
          capacityAdjustments: capacityPayload,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || 'Failed to save settings');
      }
      toast.success('Settings updated');
      // Refresh server data so the new values stick on the page.
      window.location.reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save settings');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Settlement speed preference */}
      <Card className="border-emerald-500/20 bg-emerald-500/[0.02]">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Zap className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
            Settlement preferences
          </CardTitle>
          <CardDescription>
            Target settlement latency for routing decisions. Lower values attract
            more flow but raise the bar on operational readiness.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="speed" className="text-xs uppercase tracking-wide text-muted-foreground">
                Target settlement time
              </Label>
              <span className="rounded bg-emerald-500/10 px-2 py-0.5 text-sm font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">
                {(speedMs / 1000).toFixed(2)}s
              </span>
            </div>
            <Slider
              id="speed"
              min={100}
              max={10000}
              step={100}
              value={[speedMs]}
              onValueChange={(v) => setSpeedMs(v[0])}
              className="py-2"
            />
            <div className="flex justify-between text-[10px] text-muted-foreground">
              <span>100ms (aggressive)</span>
              <span>10s (conservative)</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Per-corridor fee + capacity */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Sliders className="h-4 w-4 text-teal-600 dark:text-teal-400" />
            Corridor fees & capacity
          </CardTitle>
          <CardDescription>
            Set the fee (in basis points) and per-corridor capacity for each
            currency pair you support. 100 bps = 1%.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {corridors.length === 0 ? (
            <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
              No corridors configured. Visit the{' '}
              <a href="/lp/corridors" className="font-medium text-emerald-600 dark:text-emerald-400 underline-offset-4 hover:underline">
                Corridors
              </a>{' '}
              page to add your first currency pair.
            </div>
          ) : (
            <div className="space-y-3">
              <div className="grid grid-cols-[1fr_120px_160px] gap-3 px-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                <div>Corridor</div>
                <div className="text-right">Fee (bps)</div>
                <div className="text-right">Capacity (USD)</div>
              </div>
              <Separator />
              {corridors.map((c) => (
                <div
                  key={c}
                  className="grid grid-cols-[1fr_120px_160px] items-center gap-3"
                >
                  <div className="flex items-center gap-2">
                    <span className="rounded bg-emerald-500/10 px-2 py-1 font-mono text-xs font-medium text-emerald-600 dark:text-emerald-400">
                      {c}
                    </span>
                  </div>
                  <Input
                    type="number"
                    min={0}
                    max={1000}
                    step={1}
                    value={feeBps[c] ?? ''}
                    onChange={(e) =>
                      setFeeBps((prev) => ({ ...prev, [c]: e.target.value }))
                    }
                    className="text-right tabular-nums"
                  />
                  <Input
                    type="number"
                    min={0}
                    step={100}
                    value={capacity[c] ?? ''}
                    onChange={(e) =>
                      setCapacity((prev) => ({ ...prev, [c]: e.target.value }))
                    }
                    className="text-right tabular-nums"
                  />
                </div>
              ))}
              <p className="pt-2 text-[10px] text-muted-foreground">
                Fee example: 50 bps = 0.50%. Capacity is the maximum notional you
                are willing to settle for this corridor at any one time.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Stake & collateral summary (read-only context for the form) */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Capital position</CardTitle>
          <CardDescription>
            Reference snapshot. Manage deposits and withdrawals from the{' '}
            <a href="/lp/positions" className="font-medium text-emerald-600 dark:text-emerald-400 underline-offset-4 hover:underline">
              Positions
            </a>{' '}
            page.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <div className="rounded-lg border bg-card/50 p-3">
              <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                Stake
              </div>
              <div className="mt-1 text-lg font-bold tabular-nums text-emerald-600 dark:text-emerald-400">
                {fmtCurrency(lp.stake)}
              </div>
            </div>
            <div className="rounded-lg border bg-card/50 p-3">
              <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                Collateral
              </div>
              <div className="mt-1 text-lg font-bold tabular-nums text-teal-600 dark:text-teal-400">
                {fmtCurrency(lp.collateral)}
              </div>
            </div>
            <div className="col-span-2 rounded-lg border bg-card/50 p-3 sm:col-span-1">
              <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                Available
              </div>
              <div className="mt-1 text-lg font-bold tabular-nums">
                {fmtCurrency(lp.available)}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button
          type="submit"
          disabled={submitting}
          className="bg-emerald-600 text-white hover:bg-emerald-700"
        >
          {submitting ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Saving…
            </>
          ) : (
            <>
              <Save className="mr-2 h-4 w-4" /> Update Settings
            </>
          )}
        </Button>
      </div>
    </form>
  );
}
