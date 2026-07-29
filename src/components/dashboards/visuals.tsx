'use client';

/**
 * Shared visual primitives for the 6 flagship dashboards.
 *
 * Pure CSS / SVG — no external chart library.
 * Designed to feel like a Bloomberg terminal: compact, dense, color-coded.
 */

import * as React from 'react';
import { cn } from '@/lib/utils';

// ─── Format helpers ────────────────────────────────────────────────────────

export function fmtUsd(n: number, max = 0): string {
  if (!Number.isFinite(n)) return '—';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    notation: n >= 1_000_000 ? 'compact' : 'standard',
    maximumFractionDigits: max,
  }).format(n);
}

export function fmtNum(n: number, max = 0): string {
  if (!Number.isFinite(n)) return '—';
  return new Intl.NumberFormat('en-US', {
    notation: Math.abs(n) >= 1_000_000 ? 'compact' : 'standard',
    maximumFractionDigits: max,
  }).format(n);
}

export function fmtPct(n: number, max = 1): string {
  if (!Number.isFinite(n)) return '—';
  return `${(n * 100).toFixed(max)}%`;
}

export function fmtX(n: number, max = 2): string {
  if (!Number.isFinite(n)) return '—';
  return `${n.toFixed(max)}×`;
}

export function fmtDate(ms?: number): string {
  if (!ms) return '—';
  return new Date(ms).toLocaleString('en-US', {
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// ─── StackedBar — multi-segment horizontal bar (e.g. fiat vs stablecoin) ────

export interface StackedSegment {
  label: string;
  value: number;
  colorClass: string;
  hint?: string;
}

export function StackedBar({
  segments,
  total,
  className,
  height = 'h-3',
}: {
  segments: StackedSegment[];
  total?: number;
  className?: string;
  height?: string;
}) {
  const sum = total ?? segments.reduce((s, x) => s + x.value, 0);
  const safeSum = sum > 0 ? sum : 1;
  return (
    <div className={cn('flex w-full overflow-hidden rounded-md bg-muted/40', height, className)}>
      {segments.map((seg, i) => {
        const w = (seg.value / safeSum) * 100;
        if (w <= 0) return null;
        return (
          <div
            key={i}
            className={cn('h-full transition-all', seg.colorClass)}
            style={{ width: `${w}%` }}
            title={seg.hint ?? `${seg.label}: ${fmtNum(seg.value)}`}
          />
        );
      })}
    </div>
  );
}

// ─── Bar — simple single-value horizontal bar against a max ────────────────

export function Bar({
  value,
  max,
  colorClass = 'bg-emerald-500',
  className,
  height = 'h-2',
}: {
  value: number;
  max: number;
  colorClass?: string;
  className?: string;
  height?: string;
}) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div className={cn('w-full overflow-hidden rounded-full bg-muted/50', height, className)}>
      <div
        className={cn('h-full rounded-full transition-all', colorClass)}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

// ─── Gauge — circular SVG gauge for ratios (0..1.5+) ───────────────────────

export function Gauge({
  value,
  label,
  sublabel,
  size = 160,
  thresholds = [0.5, 1.0, 1.2],
  format = (v: number) => fmtX(v, 2),
}: {
  value: number;
  label?: string;
  sublabel?: string;
  size?: number;
  thresholds?: number[];
  format?: (v: number) => string;
}) {
  // Map value [0..1.5] → [0..270°] (3/4 arc)
  const MAX = 1.5;
  const clamped = Math.max(0, Math.min(MAX, value));
  const angle = (clamped / MAX) * 270;

  const radius = size / 2 - 14;
  const cx = size / 2;
  const cy = size / 2;
  const startAngle = 135;
  const endAngle = startAngle + 270;

  const polar = (deg: number, r: number) => {
    const rad = ((deg - 90) * Math.PI) / 180;
    return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)];
  };

  const [sx, sy] = polar(startAngle, radius);
  const [ex, ey] = polar(endAngle, radius);
  const [vx, vy] = polar(startAngle + angle, radius);

  const arc = (from: number, to: number, r: number, color: string, key: string) => {
    const [fx, fy] = polar(from, r);
    const [tx, ty] = polar(to, r);
    const large = to - from > 180 ? 1 : 0;
    return (
      <path
        key={key}
        d={`M ${fx} ${fy} A ${r} ${r} 0 ${large} 1 ${tx} ${ty}`}
        stroke={color}
        strokeWidth={8}
        fill="none"
        strokeLinecap="round"
      />
    );
  };

  // Color thresholds — translate [0..1.5] into colored arcs.
  const seg = (lo: number, hi: number, color: string, key: string) =>
    arc(startAngle + (lo / MAX) * 270, startAngle + (hi / MAX) * 270, radius, color, key);

  const valColor =
    value >= thresholds[2]
      ? '#10b981' // emerald
      : value >= thresholds[1]
        ? '#14b8a6' // teal
        : value >= thresholds[0]
          ? '#f59e0b' // amber
          : '#f43f5e'; // rose

  return (
    <div className="flex flex-col items-center">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        {seg(0, 0.5, '#f43f5e', 'rose')}
        {seg(0.5, 1.0, '#f59e0b', 'amber')}
        {seg(1.0, 1.2, '#14b8a6', 'teal')}
        {seg(1.2, MAX, '#10b981', 'emerald')}
        <line
          x1={cx}
          y1={cy}
          x2={vx}
          y2={vy}
          stroke={valColor}
          strokeWidth={3}
          strokeLinecap="round"
        />
        <circle cx={cx} cy={cy} r={5} fill={valColor} />
        <text x={cx} y={cy - 4} textAnchor="middle" className="fill-foreground" style={{ fontSize: size * 0.16, fontWeight: 700 }}>
          {format(value)}
        </text>
        {label && (
          <text x={cx} y={cy + size * 0.16} textAnchor="middle" className="fill-muted-foreground" style={{ fontSize: size * 0.07, fontWeight: 500 }}>
            {label}
          </text>
        )}
      </svg>
      {sublabel && <div className="mt-1 text-[11px] text-muted-foreground">{sublabel}</div>}
    </div>
  );
}

// ─── MaturityMeter — vertical progress meter for reserve maturity ──────────

const MATURITY_STAGES = [
  { key: 'stablecoin_only', label: 'Stablecoin-only', color: 'bg-rose-500' },
  { key: 'hybrid', label: 'Hybrid', color: 'bg-amber-500' },
  { key: 'mostly_fiat', label: 'Mostly-fiat', color: 'bg-cyan-500' },
  { key: 'fully_fiat', label: 'Fully-fiat', color: 'bg-emerald-500' },
  { key: 'reserve_exporter', label: 'Reserve-exporter', color: 'bg-violet-500' },
] as const;

export function MaturityMeter({
  maturity,
  progress,
}: {
  maturity: string;
  progress: number;
}) {
  const idx = MATURITY_STAGES.findIndex((s) => s.key === maturity);
  const reached = idx < 0 ? 0 : idx;
  return (
    <div className="flex items-center gap-1">
      {MATURITY_STAGES.map((s, i) => (
        <div
          key={s.key}
          className={cn(
            'h-1.5 flex-1 rounded-full',
            i < reached ? s.color : i === reached ? s.color : 'bg-muted/50',
          )}
          style={i === reached ? { opacity: 0.6 + 0.4 * progress } : undefined}
          title={s.label}
        />
      ))}
    </div>
  );
}

export function maturityLabel(maturity: string): string {
  return MATURITY_STAGES.find((s) => s.key === maturity)?.label ?? maturity;
}

// ─── HealthBadge — colored badge for digital twin health states ────────────

export function HealthBadge({ health }: { health: string }) {
  const map: Record<string, string> = {
    healthy: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
    growing: 'bg-teal-500/15 text-teal-600 dark:text-teal-400',
    constrained: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
    critical: 'bg-rose-500/15 text-rose-600 dark:text-rose-400',
    emerging: 'bg-violet-500/15 text-violet-600 dark:text-violet-400',
  };
  return (
    <span className={cn('inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase', map[health] ?? 'bg-muted text-muted-foreground')}>
      {health}
    </span>
  );
}

// ─── SectionLabel — tiny header label used inside cards ────────────────────

export function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
      {children}
    </div>
  );
}

// ─── StatTile — small KPI tile with label/value/hint ───────────────────────

export function StatTile({
  label,
  value,
  hint,
  tone = 'default',
  icon,
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
  tone?: 'default' | 'emerald' | 'amber' | 'rose' | 'teal' | 'cyan' | 'violet';
  icon?: React.ReactNode;
}) {
  const toneMap: Record<string, string> = {
    default: '',
    emerald: 'text-emerald-600 dark:text-emerald-400',
    amber: 'text-amber-600 dark:text-amber-400',
    rose: 'text-rose-600 dark:text-rose-400',
    teal: 'text-teal-600 dark:text-teal-400',
    cyan: 'text-cyan-600 dark:text-cyan-400',
    violet: 'text-violet-600 dark:text-violet-400',
  };
  return (
    <div className="rounded-lg border bg-card/60 p-4">
      <div className="flex items-center justify-between">
        <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </div>
        {icon && <span className={toneMap[tone]}>{icon}</span>}
      </div>
      <div className={cn('mt-1.5 text-xl font-bold tabular-nums', toneMap[tone])}>{value}</div>
      {hint && <div className="mt-0.5 text-[10px] text-muted-foreground">{hint}</div>}
    </div>
  );
}

// ─── Timeline — horizontal stage tracker with completed/current/pending ────

export interface TimelineStage {
  key: string;
  label: string;
  state: 'completed' | 'current' | 'pending';
  timestamp?: number;
  detail?: string;
}

export function Timeline({ stages }: { stages: TimelineStage[] }) {
  return (
    <div className="flex items-start gap-0 overflow-x-auto pb-2">
      {stages.map((s, i) => (
        <div key={s.key} className="flex min-w-[110px] flex-1 items-start">
          <div className="flex flex-col items-center" style={{ minWidth: 80 }}>
            <div
              className={cn(
                'flex h-6 w-6 items-center justify-center rounded-full border-2 text-[10px] font-bold',
                s.state === 'completed' && 'border-emerald-500 bg-emerald-500 text-white',
                s.state === 'current' && 'border-amber-500 bg-amber-500/15 text-amber-600 dark:text-amber-400 ring-2 ring-amber-500/30',
                s.state === 'pending' && 'border-muted bg-background text-muted-foreground',
              )}
            >
              {s.state === 'completed' ? '✓' : i + 1}
            </div>
            <div
              className={cn(
                'mt-1.5 text-[10px] font-semibold uppercase',
                s.state === 'completed' && 'text-emerald-600 dark:text-emerald-400',
                s.state === 'current' && 'text-amber-600 dark:text-amber-400',
                s.state === 'pending' && 'text-muted-foreground',
              )}
            >
              {s.label}
            </div>
            {s.timestamp && (
              <div className="mt-0.5 text-[9px] text-muted-foreground">
                {fmtDate(s.timestamp)}
              </div>
            )}
            {s.detail && (
              <div className="mt-0.5 max-w-[120px] text-center text-[9px] text-muted-foreground">
                {s.detail}
              </div>
            )}
          </div>
          {i < stages.length - 1 && (
            <div
              className={cn(
                'mx-1 mt-3 h-0.5 flex-1 rounded',
                s.state === 'completed' ? 'bg-emerald-500/60' : 'bg-muted',
              )}
            />
          )}
        </div>
      ))}
    </div>
  );
}
