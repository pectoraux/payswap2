'use client';

import { useCallback, useEffect, useState } from 'react';

// ── Public economic state (from /api/public) ──
export interface PublicState {
  ok: boolean;
  network: string;
  totalReserves: number;
  fiatReserves: number;
  stablecoinReserves: number;
  twinTokenSupply: number;
  twinTokenBackingRatio: number;
  totalBandwidth: number;
  activeLPs: number;
  activeCorridors: number;
  settlementLatencyMs: number;
  solvencyRatio: number;
  reserveGrowth30d: number;
  liquidityGrowth30d: number;
  twinTokenGrowth30d: number;
  health: {
    globalScore: number;
    reserveCoverage: number;
    settlementSuccessRate: number;
    twinTokenBacking: number;
    solvencyRatio: number;
    countries: { healthy: number; watch: number; critical: number; total: number };
  };
  verification: {
    allInvariantsHold: boolean;
    invariants: { name: string; holds: boolean }[];
  };
}

// ── Showcase snapshot (from /api/showcase) ──
export interface EkgOverview {
  nodeCount: number; relationshipCount: number; entityCount: number;
  capabilityCount: number; assetCount: number; goalCount: number;
  policyCount: number; jurisdictionCount: number; memoryCount: number;
  proofCount: number; settledProofCount: number; versionedCount: number;
  avgSuccessRate: number;
}
export interface Goal { id: string; name: string; description: string; targetAsset: string }
export interface CapabilityNode {
  id: string; name: string; category: string; produces: string[]; requires: string[];
}
export interface EntityNode { id: string; name: string; labels: string[]; kind: string }
export interface AssetNode { id: string; name: string; category: string; stableId: string }
export interface OffersEdge { from: string; to: string }

export interface ExtensionCert {
  level: 'CERTIFIED' | 'CONDITIONAL' | 'REJECTED';
  score: number; passed: number; failed: number; warnings: number; totalChecks: number;
  badgeFingerprint: string; issuedAt: number; expiresAt: number;
}
export interface ExtensionInfo {
  id: string; name: string; version: string; category: string;
  description: string; publisher: string; publisherVerified: boolean;
  license: string; capabilityCount: number; tags: string[]; certification: ExtensionCert;
}

export interface CertCheck {
  id: string; name: string; category: string;
  result: 'PASS' | 'FAIL' | 'WARN' | 'SKIP'; detail: string;
}
export interface CertificationReport {
  extensionId: string; extensionName: string; version: string;
  level: 'CERTIFIED' | 'CONDITIONAL' | 'REJECTED';
  score: number; passed: number; failed: number; warnings: number; totalChecks: number;
  checks: CertCheck[];
  badge: { level: string; score: number; fingerprint: string; issuedAt: number; expiresAt: number };
}

export interface ParcelOverview {
  totalDeliveries: number; pendingDeliveries: number; inTransitDeliveries: number;
  deliveredToday: number; cancelledToday: number; totalSpent: string; totalCarbon: number;
  avgDeliveryTimeHours: number; onTimeRate: number; damageRate: number;
}
export interface TransitNode {
  id: string; name: string; type: string; address: string;
  lat: number; lng: number; capacityKg: number; currentLoadKg: number;
  congestionLevel: number; rating: number; active: boolean;
}
export interface ProviderInfo {
  id: string; name: string; label: string; description: string;
  enabled: boolean; jurisdictions: string[]; carbonPerInvocation: number;
}
export interface CourierInfo { id: string; name: string; rating: number; totalDeliveries: number; active: boolean }

export interface ShowcaseData {
  ok: boolean;
  generatedAt: number;
  ekg: {
    overview: EkgOverview;
    goals: Goal[];
    capabilities: CapabilityNode[];
    entities: EntityNode[];
    assets: AssetNode[];
    offersEdges: OffersEdge[];
  };
  extensions: ExtensionInfo[];
  certifications: CertificationReport[];
  parcel: {
    dashboard?: {
      overview: ParcelOverview;
      deliveriesByStatus: Record<string, number>;
      deliveriesByPriority: Record<string, number>;
      topCouriers: { id: string; name: string; rating: number; deliveries: number }[];
      costBreakdown: {
        deliveryCosts: string; insuranceCosts: string; auctionSavings: string;
        bundleSavings: string; carbonOffsetCosts: string;
      };
      carbonFootprint: { totalKgCO2: number; offsetKgCO2: number; netKgCO2: number };
      routeOptimizationStats: { routesOptimized: number; avgSavingsPercent: number; multiHopRoutesUsed: number };
    };
    transitNodes?: TransitNode[];
    vehicles?: { id: string; courierId: string; type: string; capacityKg: number; carbonPerKm: number; avgSpeedKmh: number; active: boolean }[];
    providers?: ProviderInfo[];
    couriers?: CourierInfo[];
    learning?: {
      totalRecords: number; avgDeliverySuccessRate: number; avgDamageRate: number; avgReturnRate: number;
      routeReliabilityCount: number; courierReliabilityCount: number; hubCongestionCount: number;
    };
    error?: string;
  };
}

// ── POST action responses ──
export interface ProofInfo {
  id: string; plannerScore: number; totalCost: number; totalLatencyMs: number;
  trustScore: number; carbon: number; risk: number;
  capabilityCount: number; entityCount: number; entityLabels: string[];
  status: string; memoryHits: number; predictedSuccessRate: number;
}
export interface ProofStepNode {
  kind: string; goalName?: string; capabilityName?: string; entityName?: string;
  entityLabel?: string; produces: string[]; consumes: string[]; depth: number;
  children: ProofStepNode[];
}
export interface ProveResult {
  ok: boolean; goal: { id: string; name: string; description: string; targetAsset: string };
  constraints: Record<string, unknown>; proofCount: number;
  proofs: ProofInfo[];
  best: { root: ProofStepNode; [k: string]: unknown };
  message: string;
}
export interface CertifyResult {
  ok: boolean; extension: { id: string; name: string; version: string };
  report: CertificationReport; message: string;
}
export interface VerifyBadgeResult {
  ok: boolean; extensionId: string; valid: boolean; error?: string; message: string;
}
export interface PlanRouteResult {
  ok: boolean; priority: string; deliveryCount: number;
  route: {
    id: string; hops: {
      sequence: number; transitNodeName?: string; transitNodeType?: string;
      address: string; lat: number; lng: number; action: string;
      distanceFromPreviousKm: number; durationFromPreviousHours: number;
    }[];
    totalDistanceKm: number; estimatedDurationHours: number; estimatedCost: string;
    estimatedCarbon: number; vehicleType: string; optimizedFor: string; transitNodesUsed: string[];
  };
  message: string;
}

// ── Live test results ──
export interface LiveTestResult<T = Record<string, unknown>> {
  provider: string;
  operation: string;
  success: boolean;
  status: number;
  latencyMs: number;
  environment: string;
  timestamp: string;
  data?: T;
  summary: string;
  error?: string;
  rawResponse?: unknown;
  requestPreview?: Record<string, unknown>;
}
export interface LiveProviderResult {
  ok: boolean;
  provider: string;
  message: string;
  result: Record<string, LiveTestResult>;
}

// ── Consolidated live report ──
export interface LiveReportTest {
  operation: string; success: boolean; latencyMs: number; status: number;
  summary: string; error?: string;
}
export interface LiveReportProvider {
  name: string;
  passed: number; failed: number; total: number;
  tests: LiveReportTest[];
}
export interface LiveReport {
  ok: boolean;
  reportId: string;
  generatedAt: string;
  totalLatencyMs: number;
  summary: { totalTests: number; passed: number; failed: number; passRate: number; providersTested: number };
  providers: LiveReportProvider[];
  message: string;
}

// ── Real-maps route plan ──
export interface PlanRouteLiveResult {
  ok: boolean;
  priority: string;
  route: {
    id: string;
    hops: Array<{
      sequence: number; transitNodeName?: string; transitNodeType?: string;
      address: string; action: string;
      haversineKm: number; realKm: number; realDurationHours: number; realStatus: string;
    }>;
    haversineTotalKm: number;
    realTotalKm: number;
    realTotalDurationHours: number;
    differenceKm: number;
    differencePct: number;
    vehicleType: string;
    optimizedFor: string;
  };
  message: string;
}

// ── Hooks ──
export function useShowcase() {
  const [data, setData] = useState<ShowcaseData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const refetch = useCallback(() => {
    setLoading(true);
    setRefreshKey((k) => k + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/showcase')
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const json = (await r.json()) as ShowcaseData;
        if (!cancelled) { setData(json); setError(null); }
      })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : 'fetch failed'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [refreshKey]);

  return { data, loading, error, refetch };
}

export function usePublicState() {
  const [data, setData] = useState<PublicState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/public')
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const json = (await r.json()) as PublicState;
        if (!cancelled) { setData(json); setError(null); }
      })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : 'fetch failed'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  return { data, loading, error };
}

export async function postShowcase<T>(body: Record<string, unknown>): Promise<T> {
  const r = await fetch('/api/showcase', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await r.json();
  if (!r.ok && !json.ok) throw new Error(json.error || `HTTP ${r.status}`);
  return json as T;
}

// ── Helpers ──
export function levelColor(level: string): string {
  switch (level) {
    case 'CERTIFIED': return 'border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400';
    case 'CONDITIONAL': return 'border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400';
    case 'REJECTED': return 'border-rose-500/40 bg-rose-500/10 text-rose-600 dark:text-rose-400';
    default: return 'border-border bg-muted text-muted-foreground';
  }
}
export function checkResultColor(result: string): string {
  switch (result) {
    case 'PASS': return 'border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400';
    case 'FAIL': return 'border-rose-500/40 bg-rose-500/10 text-rose-600 dark:text-rose-400';
    case 'WARN': return 'border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400';
    default: return 'border-border bg-muted text-muted-foreground';
  }
}
export function pct(n: number): string {
  return `${(n * 100).toFixed(n * 100 < 10 ? 2 : 1)}%`;
}
export function relTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
