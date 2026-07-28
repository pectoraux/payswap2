'use client';

import { useState } from 'react';
import {
  Loader2,
  Plus,
  Trash2,
  Route,
  Save,
  AlertCircle,
  ArrowRight,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { CurrencySelect } from '@/components/lp/currency-select';
import { FieldHelp } from '@/components/lp/field-help';

export interface CorridorRow {
  corridor: string;
  capacity: number;
  used: number;
  feeBps: number;
  activeSettlements: number;
}

function fmtCurrency(n: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(n);
}

export function LpCorridorManager({
  corridors,
  existingCurrencies,
}: {
  corridors: CorridorRow[];
  existingCurrencies: string[];
}) {
  // Local editable fee map so adjustments feel snappy.
  const [fees, setFees] = useState<Record<string, string>>(
    Object.fromEntries(corridors.map((c) => [c.corridor, String(c.feeBps)])),
  );
  const [capacities, setCapacities] = useState<Record<string, string>>(
    Object.fromEntries(corridors.map((c) => [c.corridor, String(c.capacity)])),
  );
  const [savingRow, setSavingRow] = useState<string | null>(null);
  const [removingRow, setRemovingRow] = useState<string | null>(null);

  // Add corridor dialog state
  const [addOpen, setAddOpen] = useState(false);
  const [sourceCcy, setSourceCcy] = useState('');
  const [destCcy, setDestCcy] = useState('');
  const [newFee, setNewFee] = useState('50');
  const [newCapacity, setNewCapacity] = useState('');
  const [adding, setAdding] = useState(false);

  async function addCorridor(e: React.FormEvent) {
    e.preventDefault();
    const s = sourceCcy.trim().toUpperCase();
    const d = destCcy.trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(s) || !/^[A-Z]{3}$/.test(d)) {
      toast.error('Pick a source and destination currency from the dropdown');
      return;
    }
    if (s === d) {
      toast.error('Source and destination currencies must differ');
      return;
    }
    const corridor = `${s}→${d}`;
    if (corridors.some((c) => c.corridor === corridor)) {
      toast.error(`${corridor} already exists`);
      return;
    }
    setAdding(true);
    try {
      const res = await fetch('/api/lp/corridors', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'add',
          corridor,
          feeBps: parseFloat(newFee) || 0,
          capacity: parseFloat(newCapacity) || 0,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Failed to add corridor');
      toast.success(`Added corridor ${corridor}`);
      setAddOpen(false);
      setSourceCcy('');
      setDestCcy('');
      setNewFee('50');
      setNewCapacity('');
      window.location.reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to add corridor');
    } finally {
      setAdding(false);
    }
  }

  async function removeCorridor(corridor: string) {
    setRemovingRow(corridor);
    try {
      const res = await fetch('/api/lp/corridors', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'remove', corridor }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Failed to remove corridor');
      toast.success(`Removed corridor ${corridor}`);
      window.location.reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to remove corridor');
    } finally {
      setRemovingRow(null);
    }
  }

  async function saveRow(corridor: string) {
    const fee = parseFloat(fees[corridor] ?? '');
    const cap = parseFloat(capacities[corridor] ?? '');
    if (!Number.isFinite(fee) || fee < 0 || fee > 1000) {
      toast.error('Fee must be between 0 and 1000 bps');
      return;
    }
    if (!Number.isFinite(cap) || cap < 0) {
      toast.error('Capacity must be ≥ 0');
      return;
    }
    setSavingRow(corridor);
    try {
      const res = await fetch('/api/lp/corridors', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'adjust',
          corridor,
          feeBps: fee,
          capacity: cap,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Failed to update corridor');
      toast.success(`Updated ${corridor}`);
      window.location.reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update corridor');
    } finally {
      setSavingRow(null);
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <Route className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
              Active corridors
            </CardTitle>
            <CardDescription>
              Manage the currency pairs you support. Capacity is the max notional
              you will settle at once; fee is in basis points (100 bps = 1%).
            </CardDescription>
          </div>
          <Dialog open={addOpen} onOpenChange={setAddOpen}>
            <DialogTrigger asChild>
              <Button size="sm" className="bg-emerald-600 text-white hover:bg-emerald-700">
                <Plus className="mr-1.5 h-4 w-4" /> Add corridor
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Add a new corridor</DialogTitle>
                <DialogDescription>
                  Pick a source and destination currency. You can fine-tune the
                  fee and capacity after adding.
                </DialogDescription>
              </DialogHeader>
              <form onSubmit={addCorridor} className="space-y-4">
                <div className="grid grid-cols-1 items-end gap-2 sm:grid-cols-[1fr_auto_1fr]">
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-1.5">
                      <Label htmlFor="src" className="text-xs uppercase tracking-wide text-muted-foreground">
                        Source currency
                      </Label>
                      <FieldHelp
                        title="Source currency"
                        description="The currency the merchant's customer pays in. This is the 'inflow' side of the corridor — funds you receive from the payer."
                        example="e.g., GHS for a Ghanaian customer paying for a service priced in NGN."
                      />
                    </div>
                    <CurrencySelect
                      id="src"
                      value={sourceCcy}
                      onValueChange={setSourceCcy}
                      placeholder="Source (e.g. GHS)"
                      size="md"
                      allowedCodes={existingCurrencies.length > 0 ? undefined : undefined}
                    />
                  </div>
                  <div className="hidden items-center justify-center pb-2 sm:flex">
                    <ArrowRight className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-1.5">
                      <Label htmlFor="dst" className="text-xs uppercase tracking-wide text-muted-foreground">
                        Destination currency
                      </Label>
                      <FieldHelp
                        title="Destination currency"
                        description="The currency the merchant receives the payout in. This is the 'outflow' side of the corridor — funds you send to the payee."
                        example="e.g., NGN for a Nigerian merchant receiving payout from a Ghanaian payer."
                      />
                    </div>
                    <CurrencySelect
                      id="dst"
                      value={destCcy}
                      onValueChange={setDestCcy}
                      placeholder="Destination (e.g. NGN)"
                      size="md"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-1.5">
                      <Label htmlFor="new-fee" className="text-xs uppercase tracking-wide text-muted-foreground">
                        Fee (bps)
                      </Label>
                      <FieldHelp
                        title="Fee (basis points)"
                        description="The fee you charge for settling payments on this corridor, in basis points. 100 bps = 1%. Higher fees mean more revenue per settlement but lower routing priority."
                        example="e.g., 50 bps = 0.50% fee. A $1,000 settlement earns you $5."
                      />
                    </div>
                    <Input
                      id="new-fee"
                      type="number"
                      min="0"
                      max="1000"
                      step="1"
                      value={newFee}
                      onChange={(e) => setNewFee(e.target.value)}
                      className="tabular-nums"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-1.5">
                      <Label htmlFor="new-cap" className="text-xs uppercase tracking-wide text-muted-foreground">
                        Capacity (USD)
                      </Label>
                      <FieldHelp
                        title="Corridor capacity"
                        description="The maximum notional volume you're willing to settle on this corridor at any one time. Limits your downside if a corridor goes bad. Draws from your total stake."
                        example="e.g., $50,000 means the router will keep routing payments to you until your open positions on this corridor hit $50K."
                      />
                    </div>
                    <Input
                      id="new-cap"
                      type="number"
                      min="0"
                      step="100"
                      value={newCapacity}
                      onChange={(e) => setNewCapacity(e.target.value)}
                      placeholder="50000"
                      className="tabular-nums"
                    />
                  </div>
                </div>
                {existingCurrencies.length > 0 && (
                  <p className="text-[11px] text-muted-foreground">
                    Currencies you already hold: {existingCurrencies.join(', ')}
                  </p>
                )}
                <DialogFooter>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setAddOpen(false)}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    disabled={adding || !sourceCcy || !destCcy}
                    className="bg-emerald-600 text-white hover:bg-emerald-700"
                  >
                    {adding ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Adding…
                      </>
                    ) : (
                      <>
                        <Plus className="mr-2 h-4 w-4" /> Add corridor
                      </>
                    )}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </CardHeader>
      <CardContent>
        {corridors.length === 0 ? (
          <div className="rounded-lg border border-dashed p-8 text-center">
            <Route className="mx-auto h-8 w-8 text-muted-foreground" />
            <h3 className="mt-3 text-sm font-semibold">No corridors yet</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              Add your first currency pair to start receiving routed payments.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {corridors.map((c) => {
              const utilization =
                c.capacity > 0 ? Math.min(100, Math.round((c.used / c.capacity) * 100)) : 0;
              const canRemove = c.activeSettlements === 0;
              return (
                <div
                  key={c.corridor}
                  className="rounded-lg border bg-card/50 p-4"
                >
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                    {/* Left: identity + utilization */}
                    <div className="flex-1 space-y-2">
                      <div className="flex items-center gap-2">
                        <span className="rounded bg-emerald-500/10 px-2 py-1 font-mono text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                          {c.corridor}
                        </span>
                        {c.activeSettlements > 0 && (
                          <Badge
                            variant="secondary"
                            className="bg-amber-500/15 text-amber-600 dark:text-amber-400"
                          >
                            {c.activeSettlements} active
                          </Badge>
                        )}
                      </div>
                      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-3">
                        <div>
                          <span className="text-muted-foreground">Allocated: </span>
                          <span className="font-semibold tabular-nums">
                            {fmtCurrency(c.capacity)}
                          </span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Used: </span>
                          <span className="font-semibold tabular-nums">
                            {fmtCurrency(c.used)}
                          </span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Utilization: </span>
                          <span className="font-semibold tabular-nums">{utilization}%</span>
                        </div>
                      </div>
                      <div className="max-w-xs">
                        <Progress value={utilization} className="h-1.5" />
                      </div>
                    </div>

                    {/* Right: fee + capacity inputs + actions */}
                    <div className="flex flex-wrap items-end gap-2">
                      <div className="space-y-1">
                        <div className="flex items-center gap-1">
                          <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">
                            Fee (bps)
                          </Label>
                          <FieldHelp
                            title="Fee (bps)"
                            description="Your fee for settling on this corridor, in basis points. 100 bps = 1%."
                            example="e.g., 50 bps on a $1,000 settlement = $5 fee to you."
                            size="sm"
                          />
                        </div>
                        <Input
                          type="number"
                          min="0"
                          max="1000"
                          step="1"
                          value={fees[c.corridor] ?? ''}
                          onChange={(e) =>
                            setFees((prev) => ({ ...prev, [c.corridor]: e.target.value }))
                          }
                          className="h-8 w-24 tabular-nums"
                        />
                      </div>
                      <div className="space-y-1">
                        <div className="flex items-center gap-1">
                          <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">
                            Capacity
                          </Label>
                          <FieldHelp
                            title="Capacity (USD)"
                            description="Max notional you'll settle at once on this corridor. Caps your exposure."
                            example="e.g., $50K caps open positions on this corridor at $50K."
                            size="sm"
                          />
                        </div>
                        <Input
                          type="number"
                          min="0"
                          step="100"
                          value={capacities[c.corridor] ?? ''}
                          onChange={(e) =>
                            setCapacities((prev) => ({
                              ...prev,
                              [c.corridor]: e.target.value,
                            }))
                          }
                          className="h-8 w-32 tabular-nums"
                        />
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 border-emerald-500/40 text-emerald-600 hover:bg-emerald-500/10 dark:text-emerald-400"
                        disabled={savingRow === c.corridor}
                        onClick={() => saveRow(c.corridor)}
                      >
                        {savingRow === c.corridor ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <>
                            <Save className="mr-1 h-3.5 w-3.5" /> Save
                          </>
                        )}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-8 text-rose-600 hover:bg-rose-500/10 dark:text-rose-400"
                        disabled={!canRemove || removingRow === c.corridor}
                        onClick={() => removeCorridor(c.corridor)}
                        title={
                          canRemove
                            ? 'Remove corridor'
                            : 'Cannot remove while settlements are active'
                        }
                      >
                        {removingRow === c.corridor ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Trash2 className="h-3.5 w-3.5" />
                        )}
                      </Button>
                    </div>
                  </div>

                  {!canRemove && (
                    <div className="mt-3 flex items-start gap-2 border-t border-amber-500/20 pt-2 text-[10px] text-amber-700 dark:text-amber-300">
                      <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
                      <span>
                        {c.activeSettlements} settlement
                        {c.activeSettlements === 1 ? '' : 's'} still in flight for this
                        corridor. Removal is enabled once they complete.
                      </span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
