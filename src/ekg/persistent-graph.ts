/**
 * EKG — Persistent Graph Store (PostgreSQL-backed).
 *
 * Replaces the in-memory Map-based graph with Prisma-backed storage.
 * Nodes and relationships are stored in PostgreSQL, queryable, and
 * survive process restarts.
 *
 * The in-memory store remains as a read-through cache for hot paths.
 * Writes go to PostgreSQL first, then update the cache.
 */

import { db } from '@/lib/db';
import { uid } from '@/runtime/types';
import { appendEvent } from './event-log';
import type { NodeKind, EntityLabel, RelationshipType, GraphNode, GraphRelationship } from './types';

// ═══════════════════════════════════════════════════════════════════════════
// READ-THROUGH CACHE (in-memory, for hot paths)
// ═══════════════════════════════════════════════════════════════════════════

interface Cache {
  nodes: Map<string, GraphNode>;
  relationships: GraphRelationship[];
  loaded: boolean;
}

const globalForCache = globalThis as unknown as { __EKG_CACHE__?: Cache };
const cache: Cache = globalForCache.__EKG_CACHE__ ?? { nodes: new Map(), relationships: [], loaded: false };
if (!globalForCache.__EKG_CACHE__) globalForCache.__EKG_CACHE__ = cache;

/** Load all current nodes + relationships from PostgreSQL into the cache. */
async function loadCache(): Promise<void> {
  if (cache.loaded) return;
  const [nodeRows, relRows] = await Promise.all([
    db.graphNode.findMany({ where: { validTo: null } }),
    db.graphRelationship.findMany({ where: { validTo: null } }),
  ]);
  cache.nodes.clear();
  cache.relationships = [];
  for (const row of nodeRows) {
    cache.nodes.set(row.id, {
      id: row.id,
      kind: row.kind as NodeKind,
      label: row.label,
      labels: row.labels ? JSON.parse(row.labels) as EntityLabel[] : undefined,
      properties: JSON.parse(row.properties),
      validFrom: row.validFrom.getTime(),
      validTo: row.validTo?.getTime(),
      previousVersionId: row.previousVersionId ?? undefined,
    });
  }
  for (const row of relRows) {
    cache.relationships.push({
      id: row.id,
      from: row.fromId,
      to: row.toId,
      type: row.type as RelationshipType,
      properties: JSON.parse(row.properties),
      validFrom: row.validFrom.getTime(),
      validTo: row.validTo?.getTime(),
    });
  }
  cache.loaded = true;
}

/** Invalidate the cache (forces reload on next access). */
export function invalidateCache(): void {
  cache.loaded = false;
}

// ═══════════════════════════════════════════════════════════════════════════
// PERSISTENT GRAPH SERVICE
// ═══════════════════════════════════════════════════════════════════════════

export const persistentGraph = {
  // ── Node operations ──

  async addNode(kind: NodeKind, label: string, properties: Record<string, unknown> = {}, labels?: EntityLabel[]): Promise<string> {
    const id = uid('ekg');
    const now = new Date();
    await db.graphNode.create({
      data: {
        id, kind, label,
        labels: labels ? JSON.stringify(labels) : null,
        properties: JSON.stringify(properties),
        validFrom: now,
      },
    });
    // Update cache
    cache.nodes.set(id, { id, kind, label, labels, properties, validFrom: now.getTime() });
    // Emit event
    appendEvent('NodeCreated', { kind: 'NodeCreated', nodeId: id, nodeKind: kind, label, labels, properties, validFrom: now.getTime() });
    return id;
  },

  async getNode(id: string): Promise<GraphNode | undefined> {
    await loadCache();
    return cache.nodes.get(id);
  },

  async updateNode(id: string, propertyChanges: Record<string, unknown>): Promise<string | undefined> {
    await loadCache();
    const node = cache.nodes.get(id);
    if (!node) return undefined;
    const now = new Date();
    const newId = uid('ekg');
    const mergedProperties = { ...node.properties, ...propertyChanges };

    // Close old version
    await db.graphNode.update({ where: { id }, data: { validTo: now } });
    // Create new version
    await db.graphNode.create({
      data: {
        id: newId, kind: node.kind, label: node.label,
        labels: node.labels ? JSON.stringify(node.labels) : null,
        properties: JSON.stringify(mergedProperties),
        validFrom: now,
        previousVersionId: id,
      },
    });
    // Update cache
    cache.nodes.delete(id);
    cache.nodes.set(newId, { ...node, id: newId, properties: mergedProperties, validFrom: now.getTime(), validTo: undefined, previousVersionId: id });
    // Emit event
    appendEvent('NodeVersioned', { kind: 'NodeVersioned', oldNodeId: id, newNodeId: newId, propertyChanges, validFrom: now.getTime(), validTo: now.getTime() });
    return newId;
  },

  async listNodes(filter?: { kind?: NodeKind; label?: EntityLabel }): Promise<GraphNode[]> {
    await loadCache();
    let rows = Array.from(cache.nodes.values()).filter((n) => !n.validTo);
    if (filter?.kind) rows = rows.filter((n) => n.kind === filter.kind);
    if (filter?.label) rows = rows.filter((n) => n.labels?.includes(filter.label as EntityLabel));
    return rows;
  },

  // ── Relationship operations ──

  async addRelationship(from: string, to: string, type: RelationshipType, properties: Record<string, unknown> = {}): Promise<string> {
    const id = uid('ekgr');
    const now = new Date();
    await db.graphRelationship.create({
      data: { id, fromId: from, toId: to, type, properties: JSON.stringify(properties), validFrom: now },
    });
    // Update cache
    cache.relationships.push({ id, from, to, type, properties, validFrom: now.getTime() });
    // Emit event
    appendEvent('RelationshipCreated', { kind: 'RelationshipCreated', relId: id, from, to, type, properties, validFrom: now.getTime() });
    return id;
  },

  async getRelationships(nodeId: string, direction: 'in' | 'out' | 'both' = 'both'): Promise<GraphRelationship[]> {
    await loadCache();
    return cache.relationships.filter((r) => !r.validTo &&
      ((direction === 'out' || direction === 'both') && r.from === nodeId ||
       (direction === 'in' || direction === 'both') && r.to === nodeId));
  },

  async getRelationshipsByType(nodeId: string, type: RelationshipType, direction: 'in' | 'out' | 'both' = 'out'): Promise<GraphRelationship[]> {
    await loadCache();
    return cache.relationships.filter((r) => r.type === type && !r.validTo &&
      ((direction === 'out' || direction === 'both') ? r.from === nodeId : false) ||
      ((direction === 'in' || direction === 'both') ? r.to === nodeId : false));
  },

  // ── Traversal (uses cache for hot paths) ──

  async traverse(fromId: string, type: RelationshipType): Promise<GraphNode[]> {
    await loadCache();
    return cache.relationships
      .filter((r) => r.from === fromId && r.type === type && !r.validTo)
      .map((r) => cache.nodes.get(r.to))
      .filter((n): n is GraphNode => !!n && !n.validTo);
  },

  async findCapabilitiesProducing(assetId: string): Promise<GraphNode[]> {
    await loadCache();
    const rels = cache.relationships.filter((r) => r.type === 'PRODUCES' && r.to === assetId && !r.validTo);
    return rels.map((r) => cache.nodes.get(r.from)).filter((n): n is GraphNode => !!n && !n.validTo);
  },

  async findEntitiesOffering(capabilityId: string): Promise<GraphNode[]> {
    await loadCache();
    const rels = cache.relationships.filter((r) => r.type === 'OFFERS' && r.to === capabilityId && !r.validTo);
    return rels.map((r) => cache.nodes.get(r.from)).filter((n): n is GraphNode => !!n && !n.validTo);
  },

  async findGoals(): Promise<GraphNode[]> {
    return persistentGraph.listNodes({ kind: 'GOAL' });
  },

  // ── Overview ──

  async overview() {
    await loadCache();
    const nodes = Array.from(cache.nodes.values()).filter((n) => !n.validTo);
    const rels = cache.relationships.filter((r) => !r.validTo);
    const entities = nodes.filter((n) => n.kind === 'ENTITY');
    const labels = new Set<EntityLabel>();
    for (const e of entities) for (const l of e.labels ?? []) labels.add(l);
    return {
      nodeCount: nodes.length,
      relationshipCount: rels.length,
      entityCount: entities.length,
      entityLabelCount: labels.size,
      capabilityCount: nodes.filter((n) => n.kind === 'CAPABILITY').length,
      assetCount: nodes.filter((n) => n.kind === 'ASSET').length,
      goalCount: nodes.filter((n) => n.kind === 'GOAL').length,
      policyCount: nodes.filter((n) => n.kind === 'POLICY').length,
      jurisdictionCount: nodes.filter((n) => n.kind === 'JURISDICTION').length,
      memoryCount: nodes.filter((n) => n.kind === 'MEMORY').length,
    };
  },

  // ── Cache management ──

  invalidateCache,
  isCacheLoaded: () => cache.loaded,
};
