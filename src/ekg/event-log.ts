/**
 * Economic Knowledge Graph — Event Log.
 *
 * PHASE 1.4: The graph becomes event-sourced. Every mutation emits an event:
 *   NodeCreated, RelationshipCreated, NodeVersioned, CapabilityOffered,
 *   CapabilityRetired, ProviderRated, PolicyChanged.
 *
 * The event log is the source of truth. The in-memory graph (nodes Map +
 * relationships array) is a PROJECTION — disposable, rebuildable from events.
 *
 *   Delete all graph state → replay events → graph is fully reconstructed.
 *
 * PHASE 1.3: Projections are disposable. If the graph can't be rebuilt from
 * events, there's hidden state.
 *
 * The event log is append-only, monotonic (seq numbers), and globally ordered.
 * Each event records: seq, type, ts, payload, causationId (what caused it).
 */

import { uid } from '@/runtime/types';
import type { NodeKind, EntityLabel, RelationshipType, GraphNode, EconomicKnowledgeGraph, GraphRelationship } from './types';
import { graph as liveGraph } from './graph';

// ═══════════════════════════════════════════════════════════════════════════
// EVENT TYPES
// ═══════════════════════════════════════════════════════════════════════════

export type GraphEventType =
  | 'NodeCreated'
  | 'RelationshipCreated'
  | 'NodeVersioned'        // temporal versioning — old closed, new created
  | 'CapabilityOffered'    // Entity ──OFFERS──► Capability (a specialized RelationshipCreated)
  | 'CapabilityRetired'
  | 'ProviderRated'        // trust/reliability score updated
  | 'PolicyChanged';

export interface GraphEvent {
  /** Monotonic sequence number — globally ordered. */
  seq: number;
  /** The event type. */
  type: GraphEventType;
  /** When the event occurred (epoch ms). */
  ts: number;
  /** The event payload — type-specific. */
  payload: GraphEventPayload;
  /** What caused this event (a proof id, an API call, a seed, etc.). */
  causationId?: string;
  /** A deterministic id for idempotency — if two events have the same id, the second is a no-op. */
  idempotencyKey?: string;
}

export type GraphEventPayload =
  | { kind: 'NodeCreated'; nodeId: string; nodeKind: NodeKind; label: string; labels?: EntityLabel[]; properties: Record<string, unknown>; validFrom: number }
  | { kind: 'RelationshipCreated'; relId: string; from: string; to: string; type: RelationshipType; properties: Record<string, unknown>; validFrom: number }
  | { kind: 'NodeVersioned'; oldNodeId: string; newNodeId: string; propertyChanges: Record<string, unknown>; validFrom: number; validTo: number }
  | { kind: 'CapabilityOffered'; entityId: string; capabilityId: string; relId: string; price: number; latencyMs: number; slaSuccessRate: number; region: string }
  | { kind: 'CapabilityRetired'; relId: string; validTo: number }
  | { kind: 'ProviderRated'; entityId: string; trustScore: number; reliabilityScore: number; trend: string }
  | { kind: 'PolicyChanged'; policyId: string; changes: Record<string, unknown> };

// ═══════════════════════════════════════════════════════════════════════════
// EVENT STORE
// ═══════════════════════════════════════════════════════════════════════════

const globalForEKGEvents = globalThis as unknown as {
  __PAYSWAP_EKG_EVENTS__?: GraphEvent[];
  __PAYSWAP_EKG_NEXT_SEQ__?: number;
};

/** The append-only event log. Source of truth. Persists across hot-reloads. */
export const eventLog: GraphEvent[] = globalForEKGEvents.__PAYSWAP_EKG_EVENTS__ ?? [];
if (!globalForEKGEvents.__PAYSWAP_EKG_EVENTS__) {
  globalForEKGEvents.__PAYSWAP_EKG_EVENTS__ = eventLog;
}

/** Idempotency key index — prevents duplicate events. Persists across hot-reloads. */
const globalForIdempotencyIdx = globalThis as unknown as { __PAYSWAP_EKG_IDEMPOTENCY_IDX__?: Set<string> };
const idempotencyIndex: Set<string> = globalForIdempotencyIdx.__PAYSWAP_EKG_IDEMPOTENCY_IDX__ ?? new Set();
if (!globalForIdempotencyIdx.__PAYSWAP_EKG_IDEMPOTENCY_IDX__) {
  globalForIdempotencyIdx.__PAYSWAP_EKG_IDEMPOTENCY_IDX__ = idempotencyIndex;
}

/** Next sequence number. Must persist across hot-reloads (else getCurrentSeq() returns 0). */
let nextSeq: number = globalForEKGEvents.__PAYSWAP_EKG_NEXT_SEQ__ ?? 1;
function persistNextSeq() { globalForEKGEvents.__PAYSWAP_EKG_NEXT_SEQ__ = nextSeq; }

/** Append an event to the log. Idempotent — if idempotencyKey was seen, returns the existing seq. */
export function appendEvent(type: GraphEventType, payload: GraphEventPayload, opts?: { causationId?: string; idempotencyKey?: string }): number {
  // Idempotency check
  if (opts?.idempotencyKey) {
    if (idempotencyIndex.has(opts.idempotencyKey)) {
      // Return the seq of the existing event
      const existing = eventLog.find((e) => e.idempotencyKey === opts.idempotencyKey);
      return existing?.seq ?? -1;
    }
    idempotencyIndex.add(opts.idempotencyKey);
  }
  const event: GraphEvent = {
    seq: nextSeq++,
    type,
    ts: Date.now(),
    payload,
    causationId: opts?.causationId,
    idempotencyKey: opts?.idempotencyKey,
  };
  eventLog.push(event);
  persistNextSeq();
  return event.seq;
}

/** Get events from the log, optionally from a given sequence. */
export function getEvents(fromSeq = 0, limit = 1000): GraphEvent[] {
  return eventLog.filter((e) => e.seq > fromSeq).slice(0, limit);
}

/** Get the current highest sequence number. */
export function getCurrentSeq(): number {
  return nextSeq - 1;
}

/** Total event count. */
export function eventCount(): number {
  return eventLog.length;
}

// ═══════════════════════════════════════════════════════════════════════════
// PROJECTION REBUILD — the graph is disposable; replay events to reconstruct
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Replay events from the log to rebuild the graph projection.
 * PHASE 1.3: Projections are disposable. Delete all graph state, replay events,
 * the graph is fully reconstructed. If this fails, there's hidden state.
 *
 * @param upToSeq Replay events up to (and including) this sequence. If omitted, replay all.
 * @returns A fresh graph projection { nodes, relationships }.
 */
export function replayProjection(upToSeq?: number): { nodes: Map<string, GraphNode>; relationships: import('./types').GraphRelationship[] } {
  const nodes = new Map<string, GraphNode>();
  const relationships: import('./types').GraphRelationship[] = [];
  const limit = upToSeq ?? getCurrentSeq();

  for (const event of eventLog) {
    if (event.seq > limit) break;

    // Use event.type (always set correctly) rather than event.payload.kind
    // to avoid any discriminated-union narrowing issues at runtime.
    const p = event.payload as Record<string, unknown>;

    switch (event.type) {
      case 'NodeCreated': {
        nodes.set(p.nodeId as string, {
          id: p.nodeId as string, kind: p.nodeKind as NodeKind, label: p.label as string,
          labels: p.labels as EntityLabel[] | undefined,
          properties: p.properties as Record<string, unknown>, validFrom: p.validFrom as number,
        });
        break;
      }
      case 'RelationshipCreated': {
        relationships.push({
          id: p.relId as string, from: p.from as string, to: p.to as string,
          type: p.type as RelationshipType,
          properties: p.properties as Record<string, unknown>, validFrom: p.validFrom as number,
        });
        break;
      }
      case 'NodeVersioned': {
        const oldNode = nodes.get(p.oldNodeId as string);
        if (oldNode) {
          oldNode.validTo = p.validTo as number;
          nodes.set(p.newNodeId as string, {
            id: p.newNodeId as string, kind: oldNode.kind, label: oldNode.label, labels: oldNode.labels,
            properties: { ...oldNode.properties, ...(p.propertyChanges as Record<string, unknown>) },
            validFrom: p.validFrom as number, previousVersionId: p.oldNodeId as string,
          });
        }
        break;
      }
      case 'CapabilityOffered': {
        relationships.push({
          id: p.relId as string, from: p.entityId as string, to: p.capabilityId as string, type: 'OFFERS',
          properties: { pricePerInvocation: p.price, latencyMs: p.latencyMs, slaSuccessRate: p.slaSuccessRate, capacity: 1000, region: p.region } as Record<string, unknown>,
          validFrom: event.ts,
        });
        break;
      }
      case 'CapabilityRetired': {
        const rel = relationships.find((r) => r.id === p.relId);
        if (rel) rel.validTo = p.validTo as number;
        break;
      }
      case 'ProviderRated': {
        for (const node of nodes.values()) {
          if (node.id === p.entityId) {
            node.properties = { ...node.properties, trustScore: p.trustScore, reliabilityScore: p.reliabilityScore, reliabilityTrend: p.trend };
          }
        }
        break;
      }
      case 'PolicyChanged': {
        const node = nodes.get(p.policyId as string);
        if (node) node.properties = { ...node.properties, ...(p.changes as Record<string, unknown>) };
        break;
      }
    }
  }

  return { nodes, relationships };
}

/**
 * Verify that the projection is disposable: rebuild from events and check it
 * matches the live graph. Returns true if the replayed graph matches.
 */
export function verifyDisposable(): { match: boolean; liveNodes: number; replayedNodes: number; liveRels: number; replayedRels: number; discrepancies: string[] } {
  const replayed = replayProjection();

  const discrepancies: string[] = [];

  // Compare node counts (current versions only)
  const liveNodes = Array.from(liveGraph.nodes.values()).filter((n) => !n.validTo);
  const replayedNodes = Array.from(replayed.nodes.values()).filter((n) => !n.validTo);
  if (liveNodes.length !== replayedNodes.length) {
    discrepancies.push(`Node count mismatch: live=${liveNodes.length} replayed=${replayedNodes.length}`);
  }

  // Compare relationship counts
  const liveRels = liveGraph.relationships.filter((r) => !r.validTo);
  const replayedRels = replayed.relationships.filter((r) => !r.validTo);
  if (liveRels.length !== replayedRels.length) {
    discrepancies.push(`Relationship count mismatch: live=${liveRels.length} replayed=${replayedRels.length}`);
  }

  return {
    match: discrepancies.length === 0,
    liveNodes: liveNodes.length,
    replayedNodes: replayedNodes.length,
    liveRels: liveRels.length,
    replayedRels: replayedRels.length,
    discrepancies,
  };
}

/** Time-travel: get the graph state at a given sequence number. */
export function stateAtSeq(seq: number): { nodes: GraphNode[]; relationships: import('./types').GraphRelationship[]; seq: number } {
  const { nodes, relationships } = replayProjection(seq);
  return {
    nodes: Array.from(nodes.values()),
    relationships,
    seq,
  };
}
