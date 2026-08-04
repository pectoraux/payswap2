'use client';

import { useMemo, useState } from 'react';
import { type CapabilityNode, type EntityNode, type AssetNode, type OffersEdge } from './shared';

interface Props {
  entities: EntityNode[];
  capabilities: CapabilityNode[];
  assets: AssetNode[];
  offersEdges: OffersEdge[];
}

const ENTITY_COLORS: Record<string, string> = {
  organization: '#10b981',
  bank: '#0ea5e9',
  api: '#8b5cf6',
  government: '#f59e0b',
  human: '#ec4899',
  service: '#14b8a6',
  dao: '#f97316',
  device: '#6366f1',
};
const CAP_COLORS: Record<string, string> = {
  logistics: '#10b981',
  finance: '#0ea5e9',
  identity: '#8b5cf6',
  education: '#f59e0b',
  marketplace: '#ec4899',
  communication: '#14b8a6',
  compliance: '#ef4444',
  government: '#f97316',
  insurance: '#6366f1',
  employment: '#84cc16',
  ai: '#a855f7',
  infrastructure: '#06b6d4',
  environment: '#22c55e',
  general: '#64748b',
};
const ASSET_COLORS: Record<string, string> = {
  currency: '#10b981',
  credential: '#8b5cf6',
  data: '#0ea5e9',
  commodity: '#f59e0b',
  credit: '#ec4899',
  utility: '#14b8a6',
  general: '#64748b',
};

const COL_X = { entity: 70, cap: 360, asset: 680 };
const NODE_GAP = 52;
const TOP_PAD = 30;

function colorFor(map: Record<string, string>, key: string): string {
  const lk = (key ?? '').toLowerCase();
  return map[lk] ?? map.general;
}

/** A curved path between two points for edges. */
function edgePath(x1: number, y1: number, x2: number, y2: number): string {
  const mx = (x1 + x2) / 2;
  return `M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`;
}

export function GraphViz({ entities, capabilities, assets, offersEdges }: Props) {
  const [hovered, setHovered] = useState<string | null>(null);

  // Build stableId → asset nodeId lookup
  const assetByStableId = useMemo(() => {
    const m = new Map<string, AssetNode>();
    for (const a of assets) m.set(a.stableId, a);
    return m;
  }, [assets]);

  // Compute y positions for each column
  const entityY = useMemo(() => {
    const m = new Map<string, number>();
    entities.forEach((e, i) => m.set(e.id, TOP_PAD + i * NODE_GAP));
    return m;
  }, [entities]);
  const capY = useMemo(() => {
    const m = new Map<string, number>();
    capabilities.forEach((c, i) => m.set(c.id, TOP_PAD + i * NODE_GAP));
    return m;
  }, [capabilities]);
  const assetY = useMemo(() => {
    const m = new Map<string, number>();
    assets.forEach((a, i) => m.set(a.id, TOP_PAD + i * (NODE_GAP * 0.7)));
    return m;
  }, [assets]);

  const height = Math.max(
    entities.length * NODE_GAP + TOP_PAD,
    capabilities.length * NODE_GAP + TOP_PAD,
    assets.length * NODE_GAP * 0.7 + TOP_PAD,
    200,
  );

  // Build all edges: offers (entity→cap), produces (cap→asset), requires (asset→cap)
  const edges = useMemo(() => {
    const list: { id: string; x1: number; y1: number; x2: number; y2: number; type: 'offers' | 'produces' | 'requires' }[] = [];
    // Entity → Capability (OFFERS)
    for (const e of offersEdges) {
      const y1 = entityY.get(e.from);
      const y2 = capY.get(e.to);
      if (y1 != null && y2 != null) {
        list.push({ id: `o-${e.from}-${e.to}`, x1: COL_X.entity + 14, y1, x2: COL_X.cap - 50, y2, type: 'offers' });
      }
    }
    // Capability → Asset (PRODUCES + REQUIRES)
    for (const c of capabilities) {
      const cy = capY.get(c.id);
      if (cy == null) continue;
      for (const sid of c.produces) {
        const a = assetByStableId.get(sid);
        if (a) {
          const ay = assetY.get(a.id);
          if (ay != null) list.push({ id: `p-${c.id}-${a.id}`, x1: COL_X.cap + 50, y1: cy, x2: COL_X.asset - 10, y2: ay, type: 'produces' });
        }
      }
      for (const sid of c.requires) {
        const a = assetByStableId.get(sid);
        if (a) {
          const ay = assetY.get(a.id);
          if (ay != null) list.push({ id: `r-${c.id}-${a.id}`, x1: COL_X.cap + 50, y1: cy, x2: COL_X.asset - 10, y2: ay, type: 'requires' });
        }
      }
    }
    return list;
  }, [offersEdges, capabilities, entityY, capY, assetY, assetByStableId]);

  // Compute neighbors for hover highlighting
  const neighbors = useMemo(() => {
    const m = new Map<string, Set<string>>();
    const add = (a: string, b: string) => {
      if (!m.has(a)) m.set(a, new Set());
      if (!m.has(b)) m.set(b, new Set());
      m.get(a)!.add(b);
      m.get(b)!.add(a);
    };
    for (const e of offersEdges) add(e.from, e.to);
    for (const c of capabilities) {
      for (const sid of [...c.produces, ...c.requires]) {
        const a = assetByStableId.get(sid);
        if (a) add(c.id, a.id);
      }
    }
    return m;
  }, [offersEdges, capabilities, assetByStableId]);

  const isDimmed = (id: string): boolean => {
    if (!hovered) return false;
    if (id === hovered) return false;
    return !neighbors.get(hovered)?.has(id);
  };
  const isEdgeDimmed = (e: { id: string; type: string }): boolean => {
    if (!hovered) return false;
    // Highlight edges touching the hovered node
    const [a, b] = e.id.replace(/^[opr]-/, '').split('-');
    return a !== hovered && b !== hovered;
  };

  const EDGE_STROKE: Record<string, string> = {
    offers: '#94a3b8',
    produces: '#10b981',
    requires: '#f59e0b',
  };

  return (
    <div className="relative overflow-x-auto rounded-lg border border-border/60 bg-muted/20">
      <svg width={780} height={height} className="block" style={{ minWidth: 780 }}>
        {/* Column labels */}
        <text x={COL_X.entity} y={16} textAnchor="middle" className="fill-muted-foreground text-[10px] font-semibold uppercase tracking-wide">Entities</text>
        <text x={COL_X.cap} y={16} textAnchor="middle" className="fill-muted-foreground text-[10px] font-semibold uppercase tracking-wide">Capabilities</text>
        <text x={COL_X.asset} y={16} textAnchor="middle" className="fill-muted-foreground text-[10px] font-semibold uppercase tracking-wide">Assets</text>

        {/* Edges */}
        <g>
          {edges.map((e) => (
            <path
              key={e.id}
              d={edgePath(e.x1, e.y1, e.x2, e.y2)}
              fill="none"
              stroke={EDGE_STROKE[e.type]}
              strokeWidth={e.type === 'offers' ? 1 : 1.2}
              strokeOpacity={isEdgeDimmed(e) ? 0.06 : e.type === 'offers' ? 0.3 : 0.5}
              markerEnd={e.type === 'requires' ? 'url(#arrow-amber)' : e.type === 'produces' ? 'url(#arrow-emerald)' : undefined}
              style={{ transition: 'stroke-opacity 0.2s' }}
            />
          ))}
        </g>

        {/* Arrow markers */}
        <defs>
          <marker id="arrow-emerald" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
            <path d="M0,0 L6,3 L0,6 Z" fill="#10b981" />
          </marker>
          <marker id="arrow-amber" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
            <path d="M0,0 L6,3 L0,6 Z" fill="#f59e0b" />
          </marker>
        </defs>

        {/* Entity nodes */}
        <g>
          {entities.map((e) => {
            const y = entityY.get(e.id)!;
            const dim = isDimmed(e.id);
            const color = colorFor(ENTITY_COLORS, e.labels?.[0] ?? e.kind);
            return (
              <g
                key={e.id}
                transform={`translate(${COL_X.entity}, ${y})`}
                style={{ cursor: 'pointer', opacity: dim ? 0.2 : 1, transition: 'opacity 0.2s' }}
                onMouseEnter={() => setHovered(e.id)}
                onMouseLeave={() => setHovered(null)}
              >
                <circle r={12} fill={color} fillOpacity={0.15} stroke={color} strokeWidth={1.5} />
                <text x={0} y={3} textAnchor="middle" className="fill-foreground text-[9px] font-bold pointer-events-none">
                  {e.name.slice(0, 2).toUpperCase()}
                </text>
                <text x={-18} y={3} textAnchor="end" className="fill-foreground text-[10px] pointer-events-none">
                  {e.name.length > 18 ? e.name.slice(0, 17) + '…' : e.name}
                </text>
              </g>
            );
          })}
        </g>

        {/* Capability nodes */}
        <g>
          {capabilities.map((c) => {
            const y = capY.get(c.id)!;
            const dim = isDimmed(c.id);
            const color = colorFor(CAP_COLORS, c.category);
            return (
              <g
                key={c.id}
                transform={`translate(${COL_X.cap}, ${y})`}
                style={{ cursor: 'pointer', opacity: dim ? 0.2 : 1, transition: 'opacity 0.2s' }}
                onMouseEnter={() => setHovered(c.id)}
                onMouseLeave={() => setHovered(null)}
              >
                <rect x={-48} y={-11} width={96} height={22} rx={6} fill={color} fillOpacity={0.12} stroke={color} strokeWidth={1.5} />
                <text x={0} y={3} textAnchor="middle" className="fill-foreground text-[9px] font-medium pointer-events-none">
                  {c.name.length > 15 ? c.name.slice(0, 14) + '…' : c.name}
                </text>
              </g>
            );
          })}
        </g>

        {/* Asset nodes */}
        <g>
          {assets.map((a) => {
            const y = assetY.get(a.id)!;
            const dim = isDimmed(a.id);
            const color = colorFor(ASSET_COLORS, a.category);
            return (
              <g
                key={a.id}
                transform={`translate(${COL_X.asset}, ${y})`}
                style={{ cursor: 'pointer', opacity: dim ? 0.2 : 1, transition: 'opacity 0.2s' }}
                onMouseEnter={() => setHovered(a.id)}
                onMouseLeave={() => setHovered(null)}
              >
                <circle r={6} fill={color} fillOpacity={0.2} stroke={color} strokeWidth={1.2} />
                <text x={12} y={3} className="fill-foreground text-[10px] pointer-events-none">
                  {a.name.length > 22 ? a.name.slice(0, 21) + '…' : a.name}
                </text>
              </g>
            );
          })}
        </g>
      </svg>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-border/60 px-4 py-2.5 text-[10px] text-muted-foreground">
        <span className="font-semibold uppercase tracking-wide">Legend:</span>
        <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-slate-400" /> offers</span>
        <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-emerald-500" /> produces</span>
        <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-amber-500" /> requires</span>
        <span className="ml-auto hidden sm:inline">Hover any node to highlight its neighbors</span>
      </div>
    </div>
  );
}
