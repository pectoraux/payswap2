'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { type EngineHealth } from '@/kernel';
import { Cpu, Circle } from 'lucide-react';

const CATEGORY_COLOR: Record<string, string> = {
  Accounting: 'text-sky-500',
  Orchestration: 'text-violet-500',
  Flow: 'text-emerald-500',
  Liquidity: 'text-amber-500',
  Tokens: 'text-orange-500',
  Finance: 'text-teal-500',
  Markets: 'text-cyan-500',
  Governance: 'text-rose-500',
  Infrastructure: 'text-indigo-500',
  Intelligence: 'text-fuchsia-500',
  Platform: 'text-lime-500',
  Security: 'text-red-500',
};

export function EnginesPanel({ engines }: { engines: EngineHealth[] }) {
  const byCategory = engines.reduce<Record<string, EngineHealth[]>>((acc, e) => {
    (acc[e.category] ??= []).push(e);
    return acc;
  }, {});
  const categories = Object.keys(byCategory);

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base">
            <Cpu className="h-4 w-4 text-emerald-500" />
            Kernel Engines
          </CardTitle>
          <Badge className="gap-1 bg-emerald-600 hover:bg-emerald-600 text-white">
            <Circle className="h-2 w-2 fill-current" />
            {engines.length} online
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {categories.map((cat) => (
            <div key={cat}>
              <div className={`mb-1.5 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide ${CATEGORY_COLOR[cat] ?? 'text-muted-foreground'}`}>
                <Circle className="h-1.5 w-1.5 fill-current" />
                {cat}
              </div>
              <div className="space-y-1">
                {byCategory[cat].map((e) => (
                  <div key={e.id} className="group flex items-start gap-1.5 rounded px-1.5 py-0.5 hover:bg-muted/40" title={e.description}>
                    <Circle className="mt-1 h-1.5 w-1.5 shrink-0 fill-emerald-500 text-emerald-500" />
                    <div className="min-w-0">
                      <div className="text-xs font-medium leading-tight">{e.name}</div>
                      <div className="line-clamp-2 text-[10px] leading-tight text-muted-foreground">{e.description}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
