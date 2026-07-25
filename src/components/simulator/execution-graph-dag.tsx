'use client';

import { motion } from 'framer-motion';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { type ExecutionGraphSummary } from '@/kernel';
import { GitBranch, CheckCircle2, Flag, RefreshCw, Layers } from 'lucide-react';

const NODE_COLOR: Record<string, string> = {
  debit: 'text-rose-500 bg-rose-500/10 border-rose-500/30',
  credit: 'text-emerald-500 bg-emerald-500/10 border-emerald-500/30',
  mint: 'text-amber-500 bg-amber-500/10 border-amber-500/30',
  burn: 'text-orange-500 bg-orange-500/10 border-orange-500/30',
  draw_lp: 'text-emerald-500 bg-emerald-500/10 border-emerald-500/30',
  draw_reserve: 'text-amber-500 bg-amber-500/10 border-amber-500/30',
  draw_treasury: 'text-violet-500 bg-violet-500/10 border-violet-500/30',
  fx_convert: 'text-teal-500 bg-teal-500/10 border-teal-500/30',
  notify: 'text-sky-500 bg-sky-500/10 border-sky-500/30',
  await: 'text-sky-500 bg-sky-500/10 border-sky-500/30',
  insurance: 'text-rose-500 bg-rose-500/10 border-rose-500/30',
  accrue_fee: 'text-violet-500 bg-violet-500/10 border-violet-500/30',
};

export function ExecutionGraphDAG({ graph }: { graph: ExecutionGraphSummary }) {
  // Group nodes by parallel group for vertical layering
  const layers = new Map<number, typeof graph.nodes>();
  for (const node of graph.nodes) {
    const g = node.parallelGroup;
    if (!layers.has(g)) layers.set(g, []);
    layers.get(g)!.push(node);
  }
  const layerList = [...layers.entries()].sort((a, b) => a[0] - b[0]);

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base">
            <GitBranch className="h-4 w-4 text-emerald-500" />
            Execution Graph (DAG)
          </CardTitle>
          <div className="flex items-center gap-1.5">
            <Badge variant="outline" className="text-[10px]">{graph.totalNodes} nodes</Badge>
            <Badge variant="outline" className="text-[10px] text-sky-600">{graph.parallelGroups} layers</Badge>
            <Badge variant="outline" className="text-[10px] text-violet-600">path {graph.criticalPathLength}</Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-1">
        <div className="flex items-center gap-3 text-[10px] text-muted-foreground mb-2">
          <span className="flex items-center gap-1"><Flag className="h-2.5 w-2.5 text-emerald-500" /> checkpoint</span>
          <span className="flex items-center gap-1"><RefreshCw className="h-2.5 w-2.5 text-sky-500" /> reversible</span>
          <span className="flex items-center gap-1"><Layers className="h-2.5 w-2.5" /> parallel layer</span>
        </div>
        {layerList.map(([group, nodes]) => (
          <div key={group} className="flex items-center gap-2">
            <Badge variant="outline" className="font-mono text-[8px] shrink-0">L{group}</Badge>
            <div className="flex flex-1 flex-wrap gap-1.5">
              {nodes.map((node, i) => (
                <motion.div key={node.id} initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: group * 0.04 }}
                  className={`flex items-center gap-1.5 rounded-md border px-2 py-1 text-[10px] ${NODE_COLOR[node.type] ?? 'bg-muted/20 border-border'}`}>
                  <span className="font-medium">{node.title}</span>
                  {node.amount != null && <span className="font-mono text-[9px]">{node.amount.toLocaleString()}</span>}
                  {node.checkpoint && <Flag className="h-2.5 w-2.5 text-emerald-500" />}
                  {node.reversible && <RefreshCw className="h-2.5 w-2.5 opacity-50" />}
                </motion.div>
              ))}
            </div>
          </div>
        ))}
        <div className="mt-2 rounded-md bg-muted/20 p-2 text-[10px] text-muted-foreground">
          <CheckCircle2 className="inline h-3 w-3 text-emerald-500 mr-1" />
          DAG enables parallel execution, retries, checkpoints, compensation, partial rollback, and replay.
        </div>
      </CardContent>
    </Card>
  );
}
