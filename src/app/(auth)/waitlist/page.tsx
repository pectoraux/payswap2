'use client';

import { useState, useEffect } from 'react';
import { Shield, Activity, Banknote, Eye } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { formatCurrency, formatNumber } from '@/lib/format';

export default function PublicEconomicPage() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/public')
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  if (loading) return <div className="flex items-center justify-center min-h-[60vh]"><p className="text-muted-foreground">Loading economic state...</p></div>;
  if (!data?.ok) return <div className="flex items-center justify-center min-h-[60vh]"><p className="text-muted-foreground">Unable to load economic state.</p></div>;

  return (
    <div className="max-w-4xl mx-auto py-8 px-4 space-y-6">
      <div className="text-center">
        <h1 className="text-3xl font-bold">PaySwap Economic Transparency</h1>
        <p className="text-muted-foreground mt-2">Real-time economic state — derived from the event-sourced runtime. All figures are auditable.</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2"><CardTitle className="text-sm font-medium">Total Reserves</CardTitle><Banknote className="h-4 w-4 text-muted-foreground" /></CardHeader>
          <CardContent><div className="text-2xl font-bold">{formatCurrency(data.totalReserves, 'USD')}</div><p className="text-xs text-muted-foreground">Fiat: {formatCurrency(data.fiatReserves, 'USD')}</p></CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2"><CardTitle className="text-sm font-medium">Twin Token Supply</CardTitle><Shield className="h-4 w-4 text-muted-foreground" /></CardHeader>
          <CardContent><div className="text-2xl font-bold">{formatNumber(data.twinTokenSupply)}</div><p className="text-xs text-muted-foreground">Backing: {(data.twinTokenBackingRatio * 100).toFixed(1)}%</p></CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2"><CardTitle className="text-sm font-medium">Global Health</CardTitle><Activity className="h-4 w-4 text-muted-foreground" /></CardHeader>
          <CardContent><div className="text-2xl font-bold">{data.health.globalScore}%</div><p className="text-xs text-muted-foreground">Reserve coverage: {data.health.reserveCoverage}%</p></CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2"><CardTitle className="text-sm font-medium">Solvency Ratio</CardTitle><Shield className="h-4 w-4 text-muted-foreground" /></CardHeader>
          <CardContent><div className="text-2xl font-bold">{data.solvencyRatio.toFixed(4)}</div><p className="text-xs text-muted-foreground">Settlement success: {data.health.settlementSuccessRate}%</p></CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Formal Verification</CardTitle><CardDescription>Machine-checkable invariants — always hold</CardDescription></CardHeader>
        <CardContent>
          <div className="space-y-2">
            {data.verification?.invariants?.map((inv: any) => (
              <div key={inv.name} className="flex items-center justify-between rounded border p-3 text-sm">
                <span className="font-medium">{inv.name}</span>
                <Badge variant={inv.holds ? 'default' : 'destructive'}>{inv.holds ? '✓ HOLDS' : '✗ VIOLATED'}</Badge>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Countries</CardTitle><CardDescription>Network health by country</CardDescription></CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 gap-4 text-center">
            <div><div className="text-3xl font-bold text-emerald-600">{data.health.countries.healthy}</div><p className="text-sm text-muted-foreground">Healthy</p></div>
            <div><div className="text-3xl font-bold text-amber-600">{data.health.countries.watch}</div><p className="text-sm text-muted-foreground">Watch</p></div>
            <div><div className="text-3xl font-bold text-rose-600">{data.health.countries.critical}</div><p className="text-sm text-muted-foreground">Critical</p></div>
          </div>
        </CardContent>
      </Card>

      <p className="text-center text-xs text-muted-foreground">{data.disclaimer}</p>
    </div>
  );
}
