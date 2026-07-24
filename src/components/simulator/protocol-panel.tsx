'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { type ProtocolSummary } from '@/kernel';
import { fmtMoney } from './format';
import { Lock, Shield, Coins, Store, AlertTriangle, Gavel, Network, Banknote } from 'lucide-react';

export function ProtocolPanel({ protocol }: { protocol: ProtocolSummary }) {
  return (
    <div className="space-y-4">
      {/* Escrow */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Lock className="h-4 w-4 text-amber-500" /> Settlement Escrow
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-1.5">
          {protocol.escrowEntries.length === 0 ? (
            <div className="text-xs text-muted-foreground">No escrow entries.</div>
          ) : (
            protocol.escrowEntries.map((e) => (
              <div key={e.id} className="flex items-center gap-2 rounded border border-amber-500/30 bg-amber-500/5 px-2 py-1.5">
                <Lock className="h-3 w-3 text-amber-500 shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[11px] font-medium">{e.transactionId}</div>
                  <div className="font-mono text-[9px] text-muted-foreground">LP {e.lpId} → Merchant {e.merchantId}</div>
                </div>
                <span className="font-mono text-[11px]">{fmtMoney(e.amount, e.currency as any)}</span>
                <Badge variant={e.state === 'frozen' ? 'default' : 'secondary'} className="text-[8px]">{e.state}</Badge>
              </div>
            ))
          )}
          <p className="text-[9px] italic text-muted-foreground">Frozen Twin Tokens are the guarantee — no insurance pool needed.</p>
        </CardContent>
      </Card>

      <div className="grid gap-4 xl:grid-cols-2">
        {/* LP Registry */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Coins className="h-4 w-4 text-emerald-500" /> LP Registry
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1">
            {protocol.lpRegistry.map((lp) => (
              <div key={lp.lpId} className="flex items-center gap-2 rounded border border-border/60 bg-muted/10 px-2 py-1">
                <span className="font-mono text-[10px]">{lp.lpId}</span>
                <div className="ml-auto flex items-center gap-1">
                  <Badge variant="outline" className="text-[8px]">{lp.tier}</Badge>
                  <Badge variant="outline" className="text-[8px] text-emerald-600">rep {lp.reputation.toFixed(2)}</Badge>
                  <Badge variant="outline" className="text-[8px] text-amber-600">exp {lp.authorizedExposure.toLocaleString()}</Badge>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Merchant Registry */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Store className="h-4 w-4 text-rose-500" /> Merchant Registry
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1">
            {protocol.merchantRegistry.map((m) => (
              <div key={m.merchantId} className="flex items-center gap-2 rounded border border-border/60 bg-muted/10 px-2 py-1">
                <span className="font-mono text-[10px]">{m.merchantId}</span>
                <div className="ml-auto flex items-center gap-1">
                  <Badge variant="outline" className="text-[8px]">{m.tier}</Badge>
                  <Badge variant="outline" className="text-[8px] text-emerald-600">rep {m.reputation.toFixed(2)}</Badge>
                  <Badge variant="outline" className="text-[8px] text-violet-600">bond {m.bond.toLocaleString()}</Badge>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      {/* Collateral Vault */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Shield className="h-4 w-4 text-violet-500" /> Collateral Vault
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-1">
          {protocol.collateralEntries.map((c) => (
            <div key={c.id} className="flex items-center gap-2 rounded border border-border/60 bg-muted/10 px-2 py-1">
              <Shield className="h-3 w-3 text-violet-500" />
              <span className="font-mono text-[10px]">LP {c.lpId}</span>
              <span className="ml-auto font-mono text-[10px]">{fmtMoney(c.amount, c.currency as any)}</span>
              <Badge variant={c.state === 'locked' ? 'default' : c.state === 'slashed' ? 'destructive' : 'secondary'} className="text-[8px]">{c.state}</Badge>
              {c.slashAmount > 0 && <Badge variant="destructive" className="text-[8px]">-{c.slashAmount}</Badge>}
            </div>
          ))}
        </CardContent>
      </Card>

      <div className="grid gap-4 xl:grid-cols-2">
        {/* Net Settlement */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Network className="h-4 w-4 text-sky-500" /> Net Settlement
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1">
            {protocol.netSettlement.corridors.map((c, i) => (
              <div key={i} className="flex items-center gap-2 rounded border border-border/60 bg-muted/10 px-2 py-1">
                <span className="text-[10px]">{c.fromCountry} → {c.toCountry}</span>
                <span className="ml-auto font-mono text-[10px]">{fmtMoney(Math.abs(c.balance), c.currency as any)}</span>
              </div>
            ))}
            <Separator />
            <div className="flex items-center justify-between text-[10px]">
              <span className="text-muted-foreground">Gross / Net</span>
              <span className="font-mono">{protocol.netSettlement.grossVolume.toLocaleString()} / {protocol.netSettlement.netVolume.toLocaleString()}</span>
            </div>
          </CardContent>
        </Card>

        {/* Disputes + Twin Tokens */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Gavel className="h-4 w-4 text-rose-500" /> Disputes & Tokens
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1">
            <div className="text-[10px] text-muted-foreground">Disputes: {protocol.disputes.length}</div>
            {protocol.disputes.map((d) => (
              <div key={d.id} className="flex items-center gap-2 text-[10px]">
                <AlertTriangle className="h-3 w-3 text-rose-500" />
                <span>{d.id}: {d.state} {d.outcome ? `→ ${d.outcome}` : ''}</span>
              </div>
            ))}
            <Separator />
            {protocol.twinTokenSupply.map((t, i) => (
              <div key={i} className="flex items-center gap-2 text-[10px]">
                <Banknote className="h-3 w-3 text-amber-500" />
                <span>Twin{t.currency} supply: {t.supply.toLocaleString()}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
