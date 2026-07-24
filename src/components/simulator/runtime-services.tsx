'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { type RuntimeServiceSummary } from '@/kernel';
import { Server, Globe, Cpu, GitBranch, Shield, Brain, Code } from 'lucide-react';

const SERVICE_ICON: Record<string, typeof Server> = {
  'World Runtime': Globe,
  'Financial Solver': Cpu,
  'Execution Runtime': GitBranch,
  'Governance Runtime': Shield,
  'Intelligence Runtime': Brain,
  'Developer Runtime': Code,
};

export function RuntimeServicesPanel({ services }: { services: RuntimeServiceSummary[] }) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Server className="h-4 w-4 text-emerald-500" />
          Runtime Services
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-2 sm:grid-cols-2">
        {services.map((s) => {
          const Icon = SERVICE_ICON[s.name] ?? Server;
          return (
            <div key={s.name} className="rounded-lg border bg-muted/20 p-2.5">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-xs font-medium">
                  <Icon className="h-3 w-3 text-emerald-500" /> {s.name}
                </span>
                <Badge className="gap-1 text-[9px] bg-emerald-600 hover:bg-emerald-600 text-white">
                  <span className="h-1.5 w-1.5 rounded-full bg-white" /> {s.status}
                </Badge>
              </div>
              <div className="mt-1 text-[10px] text-muted-foreground">{s.owns}</div>
              <div className="mt-1 text-[9px] font-mono text-muted-foreground">{s.engineCount} engines</div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
