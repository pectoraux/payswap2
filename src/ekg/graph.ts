/**
 * Economic Knowledge Graph — The Graph Store.
 *
 * A unified typed property graph. Everything is a node: entities, capabilities,
 * assets, goals, policies, jurisdictions, memory, observations, evidence,
 * contracts, risks, time. Relationships are typed (OFFERS, REQUIRES, PRODUCES,
 * SATISFIES, CONSTRAINED_BY, LOCATED_IN, TRUSTS, GOVERNS, OWNS, HOLDS, ...).
 *
 * Every node + relationship is temporally versioned. When a node's properties
 * change, the old version is closed (validTo = now) and a new version is created
 * (validFrom = now). This enables:
 *   - replay: stateAt(time) returns the graph as it existed at that time
 *   - simulation: project changes without committing them
 *   - forecasting: extrapolate forward
 *   - counterfactuals: "what if we had done X instead?"
 *
 * The graph supports:
 *   - getNode(id), getRelationships(nodeId), traverse(nodeId, type)
 *   - findEntities(label), findCapabilities(producesAsset), findGoals()
 *   - pathSearch(from, to, relationshipTypes) — graph traversal
 *   - stateAt(time) — temporal query
 */

import { uid } from '@/runtime/types';
import type {
  EconomicKnowledgeGraph, GraphNode, GraphRelationship, RelationshipType,
  NodeKind, EntityLabel,
} from './types';
import { appendEvent } from './event-log';
import { invalidateProofsForNode } from './proof-cache';

// ═══════════════════════════════════════════════════════════════════════════
// STORE
// ═══════════════════════════════════════════════════════════════════════════

const globalForEKG = globalThis as unknown as {
  __PAYSWAP_EKG__?: EconomicKnowledgeGraph;
  __PAYSWAP_EKG_SEEDED__?: boolean;
};

export const graph: EconomicKnowledgeGraph =
  globalForEKG.__PAYSWAP_EKG__ ?? { nodes: new Map(), relationships: [] };
if (!globalForEKG.__PAYSWAP_EKG__) {
  globalForEKG.__PAYSWAP_EKG__ = graph;
}

// ═══════════════════════════════════════════════════════════════════════════
// GRAPH OPERATIONS
// ═══════════════════════════════════════════════════════════════════════════

export interface GraphService {
  // ── Node CRUD ──
  addNode(kind: NodeKind, label: string, properties?: Record<string, unknown>, labels?: EntityLabel[]): string;
  getNode(id: string): GraphNode | undefined;
  updateNode(id: string, properties: Record<string, unknown>): void;  // creates a new version
  listNodes(filter?: { kind?: NodeKind; label?: EntityLabel }): GraphNode[];

  // ── Relationship CRUD ──
  addRelationship(from: string, to: string, type: RelationshipType, properties?: Record<string, unknown>): string;
  getRelationships(nodeId: string, direction?: 'in' | 'out' | 'both'): GraphRelationship[];
  getRelationshipsByType(nodeId: string, type: RelationshipType, direction?: 'in' | 'out'): GraphRelationship[];

  // ── Traversal + search ──
  traverse(fromId: string, type: RelationshipType): GraphNode[];   // one hop
  findPath(fromId: string, toId: string, types?: RelationshipType[]): GraphNode[] | null;
  findEntities(label?: EntityLabel): GraphNode[];
  findCapabilitiesProducing(assetId: string): GraphNode[];
  findEntitiesOffering(capabilityId: string): GraphNode[];
  findGoals(): GraphNode[];

  // ── Temporal ──
  stateAt(time: number): { nodes: GraphNode[]; relationships: GraphRelationship[] };
  versionedCount(): number;

  // ── Overview ──
  overview(): import('./types').EKGOverview;
}

export const ekg: GraphService = {
  addNode(kind, label, properties = {}, labels) {
    const id = uid('ekg');
    const now = Date.now();
    const node: GraphNode = { id, kind, label, labels, properties, validFrom: now };
    graph.nodes.set(id, node);
    // PHASE 1.4: emit event — the graph is a projection of the event log
    appendEvent('NodeCreated', { kind: 'NodeCreated', nodeId: id, nodeKind: kind, label, labels, properties, validFrom: now });
    // Write-through to PostgreSQL (fire-and-forget, best-effort)
    persistNode(id, kind, label, properties, labels, now).catch(() => {});
    return id;
  },
  getNode(id) { return graph.nodes.get(id); },
  updateNode(id, properties) {
    const node = graph.nodes.get(id);
    if (!node) return;
    const now = Date.now();
    // Close the current version
    node.validTo = now;
    // Create a new version
    const newId = uid('ekg');
    const newNode: GraphNode = {
      id: newId, kind: node.kind, label: node.label, labels: node.labels,
      properties: { ...node.properties, ...properties },
      validFrom: now, previousVersionId: node.id,
    };
    graph.nodes.set(newId, newNode);
    // PHASE 1.4: emit event — temporal versioning is event-sourced
    appendEvent('NodeVersioned', { kind: 'NodeVersioned', oldNodeId: id, newNodeId: newId, propertyChanges: properties, validFrom: now, validTo: now });
    // Invalidate proof cache for this node
    invalidateProofsForNode(id).catch(() => {});
    // Write-through to PostgreSQL
    persistNodeVersion(id, newId, node, newNode, properties, now).catch(() => {});
    return newId as unknown as void;
  },
  listNodes(filter) {
    let rows = Array.from(graph.nodes.values()).filter((n) => !n.validTo); // current versions only
    if (filter?.kind) rows = rows.filter((n) => n.kind === filter.kind);
    if (filter?.label) rows = rows.filter((n) => n.labels?.includes(filter.label as EntityLabel));
    return rows;
  },

  addRelationship(from, to, type, properties = {}) {
    const id = uid('ekgr');
    const now = Date.now();
    const rel: GraphRelationship = { id, from, to, type, properties, validFrom: now };
    graph.relationships.push(rel);
    // PHASE 1.4: emit event
    appendEvent('RelationshipCreated', { kind: 'RelationshipCreated', relId: id, from, to, type, properties, validFrom: now });
    // Write-through to PostgreSQL
    persistRelationship(id, from, to, type, properties, now).catch(() => {});
    return id;
  },
  getRelationships(nodeId, direction = 'both') {
    return graph.relationships.filter((r) =>
      (direction === 'out' || direction === 'both') && r.from === nodeId && !r.validTo ||
      (direction === 'in' || direction === 'both') && r.to === nodeId && !r.validTo
    );
  },
  getRelationshipsByType(nodeId: string, type: RelationshipType, direction: 'in' | 'out' | 'both' = 'out'): GraphRelationship[] {
    return graph.relationships.filter((r) => r.type === type && !r.validTo &&
      ((direction === 'out' || direction === 'both') ? r.from === nodeId : false) ||
      ((direction === 'in' || direction === 'both') ? r.to === nodeId : false));
  },

  traverse(fromId, type) {
    return graph.relationships
      .filter((r) => r.from === fromId && r.type === type && !r.validTo)
      .map((r) => graph.nodes.get(r.to))
      .filter((n): n is GraphNode => !!n);
  },
  findPath(fromId, toId, types) {
    // BFS
    const visited = new Set<string>([fromId]);
    const queue: Array<{ id: string; path: string[] }> = [{ id: fromId, path: [fromId] }];
    while (queue.length) {
      const { id, path } = queue.shift()!;
      if (id === toId) return path.map((pid) => graph.nodes.get(pid)!).filter(Boolean);
      const rels = graph.relationships.filter((r) => r.from === id && !r.validTo && (!types || types.includes(r.type)));
      for (const r of rels) {
        if (visited.has(r.to)) continue;
        visited.add(r.to);
        queue.push({ id: r.to, path: [...path, r.to] });
      }
    }
    return null;
  },
  findEntities(label) {
    return ekg.listNodes({ kind: 'ENTITY', label });
  },
  findCapabilitiesProducing(assetId) {
    // Capability ──PRODUCES──► Asset
    const rels = graph.relationships.filter((r) => r.type === 'PRODUCES' && r.to === assetId && !r.validTo);
    return rels.map((r) => graph.nodes.get(r.from)).filter((n): n is GraphNode => !!n && !n.validTo);
  },
  findEntitiesOffering(capabilityId) {
    // Entity ──OFFERS──► Capability
    const rels = graph.relationships.filter((r) => r.type === 'OFFERS' && r.to === capabilityId && !r.validTo);
    return rels.map((r) => graph.nodes.get(r.from)).filter((n): n is GraphNode => !!n && !n.validTo);
  },
  findGoals() {
    return ekg.listNodes({ kind: 'GOAL' });
  },

  stateAt(time) {
    return {
      nodes: Array.from(graph.nodes.values()).filter((n) => n.validFrom <= time && (!n.validTo || n.validTo > time)),
      relationships: graph.relationships.filter((r) => r.validFrom <= time && (!r.validTo || r.validTo > time)),
    };
  },
  versionedCount() {
    return Array.from(graph.nodes.values()).filter((n) => n.validTo).length;
  },

  overview() {
    const nodes = Array.from(graph.nodes.values()).filter((n) => !n.validTo);
    const entities = nodes.filter((n) => n.kind === 'ENTITY');
    const labels = new Set<EntityLabel>();
    for (const e of entities) for (const l of e.labels ?? []) labels.add(l);
    return {
      nodeCount: nodes.length,
      relationshipCount: graph.relationships.filter((r) => !r.validTo).length,
      entityCount: entities.length,
      entityLabelCount: labels.size,
      capabilityCount: nodes.filter((n) => n.kind === 'CAPABILITY').length,
      assetCount: nodes.filter((n) => n.kind === 'ASSET').length,
      goalCount: nodes.filter((n) => n.kind === 'GOAL').length,
      policyCount: nodes.filter((n) => n.kind === 'POLICY').length,
      jurisdictionCount: nodes.filter((n) => n.kind === 'JURISDICTION').length,
      memoryCount: nodes.filter((n) => n.kind === 'MEMORY').length,
      proofCount: 0, // filled by the proof store
      settledProofCount: 0,
      versionedCount: ekg.versionedCount(),
      avgSuccessRate: 0, // filled by the proof store
    };
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// WRITE-THROUGH PERSISTENCE (fire-and-forget to PostgreSQL)
// ═══════════════════════════════════════════════════════════════════════════

async function persistNode(id: string, kind: string, label: string, properties: Record<string, unknown>, labels: EntityLabel[] | undefined, now: number): Promise<void> {
  try {
    const { db } = await import('@/lib/db');
    await db.graphNode.create({
      data: {
        id, kind, label,
        labels: labels ? JSON.stringify(labels) : null,
        properties: JSON.stringify(properties),
        validFrom: new Date(now),
      },
    });
  } catch { /* best-effort — might already exist or DB unavailable */ }
}

async function persistNodeVersion(oldId: string, newId: string, oldNode: GraphNode, newNode: GraphNode, changes: Record<string, unknown>, now: number): Promise<void> {
  try {
    const { db } = await import('@/lib/db');
    const date = new Date(now);
    await db.graphNode.update({ where: { id: oldId }, data: { validTo: date } });
    await db.graphNode.create({
      data: {
        id: newId, kind: newNode.kind, label: newNode.label,
        labels: newNode.labels ? JSON.stringify(newNode.labels) : null,
        properties: JSON.stringify(newNode.properties),
        validFrom: date,
        previousVersionId: oldId,
      },
    });
  } catch { /* best-effort */ }
}

async function persistRelationship(id: string, from: string, to: string, type: string, properties: Record<string, unknown>, now: number): Promise<void> {
  try {
    const { db } = await import('@/lib/db');
    await db.graphRelationship.create({
      data: {
        id, fromId: from, toId: to, type,
        properties: JSON.stringify(properties),
        validFrom: new Date(now),
      },
    });
  } catch { /* best-effort — might already exist or DB unavailable */ }
}

// Re-export types
export type {
  EconomicKnowledgeGraph, GraphNode, GraphRelationship, RelationshipType,
  NodeKind, EntityLabel,
} from './types';
