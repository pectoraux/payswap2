/**
 * Liquidity Intelligence Engine. (Amendment 1 §7A.)
 *
 * Continuously analyzes the liquidity network and improves it. It does NOT
 * route payments; it improves the network that routing uses. Findings become
 * Evidence for the Decision Engine and inputs to Opportunity Discovery.
 *
 * M-RT-1 ships types + a no-op interface. M-RT-6 implements the real
 * continuous analyzer (reads the Liquidity Graph + Runtime Memory + settlement
 * events).
 */

import type { EvidenceCitation } from '../../types';

export type IntelligenceFindingKind =
  | 'lp_underutilized'
  | 'corridor_expensive'
  | 'reserve_exhausted'
  | 'lp_could_earn_more'
  | 'corridor_no_competition'
  | 'capital_inefficient'
  | 'market_concentrated'
  | 'missed_routing_opportunity';

export interface IntelligenceFinding {
  id: string;
  kind: IntelligenceFindingKind;
  subject: string;          // "lp:Acacia" | "corridor:KE-GH" | "reserve:GHS"
  claim: string;            // "Acacia LP underutilized (12% vs 70% target)"
  evidence: EvidenceCitation[];
  confidence: number;       // 0..1
  severity: 'info' | 'warn' | 'critical';
  ts: number;
}

export interface LPDiagnostics {
  lpId: string;
  utilization: number;
  utilizationTarget: number;
  earnedThisPeriod: number;
  couldEarnMore: number;
  congestedWindows: string[];
  findings: IntelligenceFinding[];
}

export interface CorridorDiagnostics {
  corridorId: string;
  avgCostBps: number;
  avgLatencyMs: number;
  failureRate: number;
  lpCount: number;
  hasCompetition: boolean;
  findings: IntelligenceFinding[];
}

export interface ReserveDiagnostics {
  reserveId: string;
  utilization: number;
  shadowPriceBps: number;
  forecastDepletionMs?: number;
  findings: IntelligenceFinding[];
}

export interface IntelligenceReport {
  generatedAt: number;
  findings: IntelligenceFinding[];
  lpDiagnostics: LPDiagnostics[];
  corridorDiagnostics: CorridorDiagnostics[];
  reserveDiagnostics: ReserveDiagnostics[];
}

/** The Liquidity Intelligence Engine contract. */
export interface LiquidityIntelligenceEngine {
  /** Continuous analysis (on a schedule + on settlement events). */
  analyze(): Promise<IntelligenceReport>;
  /** Per-subject diagnostics (for the Inspector + LP/Treasury dashboards). */
  explainLP(lpId: string): Promise<LPDiagnostics>;
  explainCorridor(corridorId: string): Promise<CorridorDiagnostics>;
  explainReserve(reserveId: string): Promise<ReserveDiagnostics>;
  /** Feed Opportunity Discovery. */
  findings(): Promise<IntelligenceFinding[]>;
}

/**
 * NoOpLiquidityIntelligenceEngine — the M-RT-1 placeholder. Returns empty
 * reports. M-RT-6 replaces this with the real analyzer.
 */
export class NoOpLiquidityIntelligenceEngine implements LiquidityIntelligenceEngine {
  async analyze(): Promise<IntelligenceReport> {
    return { generatedAt: 0, findings: [], lpDiagnostics: [], corridorDiagnostics: [], reserveDiagnostics: [] };
  }
  async explainLP(lpId: string): Promise<LPDiagnostics> {
    return { lpId, utilization: 0, utilizationTarget: 0, earnedThisPeriod: 0, couldEarnMore: 0, congestedWindows: [], findings: [] };
  }
  async explainCorridor(corridorId: string): Promise<CorridorDiagnostics> {
    return { corridorId, avgCostBps: 0, avgLatencyMs: 0, failureRate: 0, lpCount: 0, hasCompetition: false, findings: [] };
  }
  async explainReserve(reserveId: string): Promise<ReserveDiagnostics> {
    return { reserveId, utilization: 0, shadowPriceBps: 0, findings: [] };
  }
  async findings(): Promise<IntelligenceFinding[]> {
    return [];
  }
}
