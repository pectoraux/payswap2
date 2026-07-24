'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { type EntitySummary, ENTITY_META } from '@/kernel';
import { Boxes } from 'lucide-react';

export function EntityRegistry({ entities }: { entities: EntitySummary[] }) {
  // Group by type
  const byType = entities.reduce<Record<string, EntitySummary[]>>((acc, e) => {
    (acc[e.type] ??= []).push(e);
    return acc;
  }, {});

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base">
            <Boxes className="h-4 w-4 text-emerald-500" />
            Entity Registry
          </CardTitle>
          <Badge variant="outline" className="text-[10px]">{entities.length} entities</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {Object.entries(byType).map(([type, ents]) => {
          const meta = ENTITY_META[type as keyof typeof ENTITY_META] ?? { label: type, icon: '📦', color: 'text-muted-foreground' };
          return (
            <div key={type}>
              <div className={`mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide ${meta.color}`}>
                {meta.icon} {meta.label} ({ents.length})
              </div>
              <div className="space-y-0.5">
                {ents.map((e) => (
                  <div key={e.id} className="flex items-center gap-2 rounded border border-border/60 bg-muted/10 px-2 py-1">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[11px] font-medium">{e.label}</div>
                      <div className="font-mono text-[8px] text-muted-foreground">{e.id}</div>
                    </div>
                    <Badge variant="outline" className={`text-[8px] ${e.state === 'active' || e.state === 'healthy' ? 'text-emerald-600' : 'text-muted-foreground'}`}>{e.state}</Badge>
                    {e.balance > 0 && <span className="font-mono text-[9px]">{e.balance.toLocaleString()}</span>}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
