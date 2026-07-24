/**
 * PaySwap Runtime — Projection Engine.
 *
 * Everything derived is a projection. Instead of storing reputation, exposure,
 * capacity, risk, confidence all over the protocol, the Projection Engine folds
 * events into read models.
 *
 *   Events → Projection → Current Reputation, Exposure, Capacity, Risk, Confidence
 *
 * This keeps the write model tiny. There are no mutable derived values in
 * storage — only events. Every derived value is computed on demand.
 */
import { round } from './support';

export interface WorldEvent {
  type: string;
  payload: Record<string, unknown>;
  ts: number;
  entityId?: string;
  frame?: number;
}

export interface Projection<T> {
  name: string;
  compute: (events: WorldEvent[], entityId: string) => T;
}

/** Reputation projection — fold(events) → reputation score (0..1). */
export const reputationProjection: Projection<number> = {
  name: 'reputation',
  compute: (events: WorldEvent[], entityId: string): number => {
    const entityEvents = events.filter(
      (e) => e.entityId === entityId || e.payload.entityId === entityId,
    );
    if (entityEvents.length === 0) return 0.5;

    let success = 0, fail = 0, disputeLoss = 0;
    for (const evt of entityEvents) {
      if (evt.type.includes('drawn') || evt.type.includes('completed') || evt.type.includes('confirmed')) success++;
      if (evt.type.includes('failed')) fail++;
      if (evt.type === 'dispute.resolved' && (evt.payload.outcome === 'merchant_wins' || evt.payload.outcome === 'collateral_slash')) disputeLoss++;
    }
    const total = success + fail + disputeLoss;
    if (total === 0) return 0.5;
    return round(Math.max(0, Math.min(1, (success / total) * 0.7 + 0.3 - disputeLoss * 0.1)), 4);
  },
};

/** Exposure projection — fold(events) → current allocated exposure. */
export const exposureProjection: Projection<{ allocated: number; available: number }> = {
  name: 'exposure',
  compute: (events: WorldEvent[], entityId: string): { allocated: number; available: number } => {
    let allocated = 0;
    let released = 0;
    for (const evt of events) {
      if (evt.entityId !== entityId && evt.payload.entityId !== entityId) continue;
      if (evt.type.includes('reserved') || evt.type.includes('leased')) allocated += (evt.payload.amount as number) ?? 0;
      if (evt.type.includes('released') || evt.type.includes('consumed') || evt.type.includes('transferred')) released += (evt.payload.amount as number) ?? 0;
    }
    return { allocated: round(allocated - released, 2), available: round(Math.max(0, (allocated * 2) - allocated + released), 2) };
  },
};

/** Settlement rate projection — fold(events) → success rate (0..1). */
export const settlementRateProjection: Projection<number> = {
  name: 'settlement_rate',
  compute: (events: WorldEvent[], entityId: string): number => {
    const entityEvents = events.filter(
      (e) => e.entityId === entityId || e.payload.entityId === entityId,
    );
    const successes = entityEvents.filter((e) => e.type.includes('completed') || e.type.includes('confirmed')).length;
    const failures = entityEvents.filter((e) => e.type.includes('failed') || e.type.includes('breached')).length;
    const total = successes + failures;
    return total === 0 ? 1.0 : round(successes / total, 4);
  },
};

/** Risk score projection — fold(events) → current risk (0..1, lower is safer). */
export const riskProjection: Projection<number> = {
  name: 'risk',
  compute: (events: WorldEvent[], entityId: string): number => {
    const entityEvents = events.filter(
      (e) => e.entityId === entityId || e.payload.entityId === entityId,
    );
    let risk = 0;
    for (const evt of entityEvents) {
      if (evt.type.includes('failed')) risk += 0.05;
      if (evt.type.includes('disputed')) risk += 0.08;
      if (evt.type.includes('breached')) risk += 0.15;
      if (evt.type.includes('slash')) risk += 0.20;
    }
    return round(Math.min(1, risk), 4);
  },
};

/** Capacity projection — fold(events) → current available capacity. */
export const capacityProjection: Projection<{ total: number; used: number; available: number }> = {
  name: 'capacity',
  compute: (events: WorldEvent[], entityId: string): { total: number; used: number; available: number } => {
    let total = 0, used = 0;
    for (const evt of events) {
      if (evt.entityId !== entityId && evt.payload.entityId !== entityId) continue;
      if (evt.type.includes('registered') || evt.type.includes('staked')) total += (evt.payload.amount as number) ?? 0;
      if (evt.type.includes('reserved') || evt.type.includes('drawn') || evt.type.includes('consumed')) used += (evt.payload.amount as number) ?? 0;
      if (evt.type.includes('released') || evt.type.includes('unstaked')) used -= (evt.payload.amount as number) ?? 0;
    }
    return { total, used: round(Math.max(0, used), 2), available: round(Math.max(0, total - used), 2) };
  },
};

/**
 * Projection Engine — computes any projection on demand.
 * No derived values are stored. Everything is a fold over events.
 */
export class ProjectionEngine {
  private projections: Map<string, Projection<any>> = new Map();

  constructor() {
    this.register(reputationProjection);
    this.register(exposureProjection);
    this.register(settlementRateProjection);
    this.register(riskProjection);
    this.register(capacityProjection);
  }

  register<T>(projection: Projection<T>): void {
    this.projections.set(projection.name, projection);
  }

  project<T>(name: string, events: WorldEvent[], entityId: string): T | null {
    const projection = this.projections.get(name);
    if (!projection) return null;
    return projection.compute(events, entityId) as T;
  }

  /** Project all registered projections for an entity. */
  projectAll(events: WorldEvent[], entityId: string): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const [name, projection] of this.projections) {
      result[name] = projection.compute(events, entityId);
    }
    return result;
  }

  list(): string[] {
    return [...this.projections.keys()];
  }
}

export const projectionEngine = new ProjectionEngine();
