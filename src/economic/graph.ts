/**
 * Economic Composition Engine — Dependency Graph Builder.
 *
 * Derives the economic composition topology from the registered extension
 * manifests + pipelines. The graph is what makes the architecture "loosely
 * coupled": extensions never depend on each other, only on contracts (tokens
 * and events). The graph visualizes those contracts.
 *
 * Node kinds: EXTENSION, TOKEN, EVENT, PIPELINE
 * Edge kinds: EMITS, CONSUMES, PUBLISHES, SUBSCRIBES, TRIGGERS
 */

import { store } from './store';
import type { EconomicGraph, GraphNode, GraphEdge, GraphNodeKind } from './types';

const TOKEN_COLORS: Record<string, string> = {
  identity: 'sky', marketplace: 'emerald', lending: 'amber', treasury: 'teal',
  ai: 'violet', storage: 'cyan', bandwidth: 'rose', rewards: 'fuchsia',
  insurance: 'indigo', carbon: 'lime', education: 'orange', employment: 'orange',
};

const CATEGORY_COLORS: Record<string, string> = {
  identity: 'sky', marketplace: 'emerald', lending: 'amber', treasury: 'teal',
  ai: 'violet', storage: 'cyan', bandwidth: 'rose', rewards: 'fuchsia',
  insurance: 'indigo', carbon: 'lime', education: 'orange', employment: 'orange',
};

export function buildGraph(): EconomicGraph {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const nodeIndex = new Set<string>();

  function addNode(id: string, kind: GraphNodeKind, label: string, sublabel?: string, group?: string, color?: string) {
    if (nodeIndex.has(id)) return;
    nodeIndex.add(id);
    nodes.push({ id, kind, label, sublabel, group, color });
  }

  // Extension nodes
  for (const ext of store.extensions.values()) {
    addNode(ext.id, 'EXTENSION', ext.name, `${ext.category} · v${ext.version}`, ext.category, CATEGORY_COLORS[ext.category] ?? 'slate');
  }

  // Token nodes + EMITS/CONSUMES edges
  for (const token of store.tokens.values()) {
    addNode(token.id, 'TOKEN', token.symbol, token.name, token.issuer, TOKEN_COLORS[token.issuer] ?? 'slate');
    const issuer = store.extensions.get(token.issuer);
    if (issuer) {
      edges.push({ from: token.issuer, to: token.id, kind: 'EMITS' });
    }
  }
  for (const ext of store.extensions.values()) {
    for (const tokenId of ext.manifest.tokens.consumes) {
      if (nodeIndex.has(tokenId)) {
        edges.push({ from: ext.id, to: tokenId, kind: 'CONSUMES' });
      }
    }
  }

  // Event nodes + PUBLISHES/SUBSCRIBES edges
  const eventTypes = new Set<string>();
  for (const ext of store.extensions.values()) {
    for (const e of ext.manifest.events.publishes) eventTypes.add(e);
    for (const e of ext.manifest.events.subscribes) eventTypes.add(e);
  }
  for (const p of store.pipelines.values()) {
    eventTypes.add(p.trigger);
    for (const s of p.steps) {
      if (s.action === 'publish' || s.action === 'notify') {
        if (s.event) eventTypes.add(s.event);
      }
    }
  }
  for (const e of eventTypes) {
    addNode(`event:${e}`, 'EVENT', e, 'event', 'event', 'slate');
  }
  for (const ext of store.extensions.values()) {
    for (const e of ext.manifest.events.publishes) {
      edges.push({ from: ext.id, to: `event:${e}`, kind: 'PUBLISHES' });
    }
    for (const e of ext.manifest.events.subscribes) {
      edges.push({ from: ext.id, to: `event:${e}`, kind: 'SUBSCRIBES' });
    }
  }

  // Pipeline nodes + TRIGGERS edges (event → pipeline)
  for (const p of store.pipelines.values()) {
    addNode(p.id, 'PIPELINE', p.name, `${p.steps.length} steps`, 'pipeline', 'emerald');
    edges.push({ from: `event:${p.trigger}`, to: p.id, kind: 'TRIGGERS' });
  }

  return { nodes, edges };
}
