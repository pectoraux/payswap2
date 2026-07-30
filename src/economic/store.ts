/**
 * Economic Composition Engine — Central Store + Core Service.
 *
 * Mirrors the in-memory store pattern from src/claims/store.ts and
 * src/lp/settlement-store.ts: process-wide singleton on globalThis, idempotent
 * auto-seed, module-level service object (not a class).
 *
 * This is the foundation of the Economic Composition Engine. Extensions are
 * registered here as economic actors; tokens are minted/burned/consumed through
 * here; the economic event bus fires synchronously on every publish and triggers
 * matching pipelines (cascading composition).
 */

import { uid } from '@/runtime/types';
import type {
  TokenDefinition, TokenBalance, TokenOperation, TokenOpType,
  EconomicEvent, EventSubscriber, HolderType,
  ExtensionManifest, EconomicExtension, ExtensionStatus,
  TokenPipeline, PipelineStep, PipelineExecution, PipelineStatus,
  EconomicGraph, GraphNode, GraphEdge,
  EconomicOverview,
} from './types';
import { executePipeline } from './pipeline-engine';
import { buildGraph } from './graph';

// ═══════════════════════════════════════════════════════════════════════════
// STORE SHAPE
// ═══════════════════════════════════════════════════════════════════════════

export interface EconomicStore {
  tokens: Map<string, TokenDefinition>;
  balances: Map<string, TokenBalance>;         // key = `${tokenId}::${holderId}`
  operations: TokenOperation[];
  events: EconomicEvent[];
  extensions: Map<string, EconomicExtension>;
  pipelines: Map<string, TokenPipeline>;
  executions: PipelineExecution[];
  subscribers: Map<string, Set<EventSubscriber>>; // eventType → subscribers
}

function createStore(): EconomicStore {
  return {
    tokens: new Map(),
    balances: new Map(),
    operations: [],
    events: [],
    extensions: new Map(),
    pipelines: new Map(),
    executions: [],
    subscribers: new Map(),
  };
}

// Process-wide singleton (survives Next.js dev hot-reload).
const globalForEconomic = globalThis as unknown as {
  __PAYSWAP_ECONOMIC_STORE__?: EconomicStore;
  __PAYSWAP_ECONOMIC_SEEDED__?: boolean;
};

export const store: EconomicStore =
  globalForEconomic.__PAYSWAP_ECONOMIC_STORE__ ?? createStore();
if (!globalForEconomic.__PAYSWAP_ECONOMIC_STORE__) {
  globalForEconomic.__PAYSWAP_ECONOMIC_STORE__ = store;
}

// ═══════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════

const balanceKey = (tokenId: string, holderId: string) => `${tokenId}::${holderId}`;

/** Resolve a template string like '${event.payload.amount}' against a context. */
export function resolveTemplate(expr: string | number | undefined, ctx: Record<string, unknown>): number {
  if (expr === undefined || expr === null) return 0;
  if (typeof expr === 'number') return expr;
  // numeric literal
  const n = Number(expr);
  if (!Number.isNaN(n) && expr.trim() !== '') return n;
  // template ${path}
  const m = expr.match(/^\$\{([^}]+)\}$/);
  if (m) {
    const path = m[1].split('.');
    let val: unknown = ctx;
    for (const p of path) val = (val as Record<string, unknown>)?.[p];
    const num = Number(val);
    return Number.isNaN(num) ? 0 : num;
  }
  return 0;
}

function touchBalance(tokenId: string, holderId: string, holderType: HolderType, holderLabel: string, delta: number, consumedDelta = 0): TokenBalance {
  const k = balanceKey(tokenId, holderId);
  let b = store.balances.get(k);
  if (!b) {
    b = { tokenId, holderId, holderType, holderLabel, balance: 0, consumed: 0, updatedAt: Date.now() };
    store.balances.set(k, b);
  }
  b.balance += delta;
  b.consumed += consumedDelta;
  b.updatedAt = Date.now();
  // also update the extension's treasury if holder is an extension
  if (holderType === 'EXTENSION') {
    const ext = store.extensions.get(holderId);
    if (ext) ext.treasury[tokenId] = (ext.treasury[tokenId] ?? 0) + delta;
  }
  return b;
}

// ═══════════════════════════════════════════════════════════════════════════
// CORE TOKEN LIFECYCLE — mint / burn / transfer / consume
// Each operation emits an economic event that cascades through the bus.
// ═══════════════════════════════════════════════════════════════════════════

function recordOperation(
  tokenId: string, type: TokenOpType, amount: number, reason: string,
  opts: { from?: string; to?: string; toType?: HolderType; pipelineId?: string; source?: string },
): TokenOperation {
  const token = store.tokens.get(tokenId);
  const symbol = token?.symbol ?? tokenId;
  const op: TokenOperation = {
    id: uid('ecoop'),
    tokenId, tokenSymbol: symbol, type,
    from: opts.from, to: opts.to, toType: opts.toType,
    amount, reason,
    eventId: '',           // filled after event publish
    pipelineId: opts.pipelineId,
    ts: Date.now(),
  };
  store.operations.unshift(op);
  // keep the operations log bounded
  if (store.operations.length > 500) store.operations.length = 500;

  // Emit the economic event — this is the composition trigger.
  const eventType = `token.${type.toLowerCase()}`;
  const event: EconomicEvent = {
    id: uid('eco'),
    type: eventType,
    source: opts.source ?? token?.issuer ?? 'system',
    tokenId, tokenSymbol: symbol,
    payload: { amount, from: opts.from, to: opts.to, reason, operationId: op.id },
    ts: Date.now(),
    reactors: [],
    cascaded: false,
  };
  op.eventId = event.id;
  publishInternal(event);
  return op;
}

/**
 * The internal publish routine. Fires subscribers synchronously and triggers
 * matching pipelines. Guarded against infinite cascades (max depth + max events).
 */
const MAX_CASCADE_DEPTH = 8;
const MAX_CASCADE_EVENTS = 60;
let cascadeDepth = 0;
let cascadeEventBudget = MAX_CASCADE_EVENTS;

function publishInternal(event: EconomicEvent): void {
  store.events.unshift(event);
  if (store.events.length > 500) store.events.length = 500;

  // Fire direct subscribers (extensions reacting to this event type).
  const subs = store.subscribers.get(event.type);
  if (subs) {
    for (const sub of subs) {
      try { sub(event); } catch { /* best-effort */ }
    }
  }

  // Mark which extensions subscribe to this event type (for the reactors list).
  for (const ext of store.extensions.values()) {
    if (ext.status !== 'ACTIVE') continue;
    if (ext.manifest.events.subscribes.includes(event.type)) {
      event.reactors.push(ext.id);
      ext.eventsConsumed++;
    }
  }

  // Trigger matching pipelines (cascade). Guard against runaway recursion.
  if (cascadeDepth < MAX_CASCADE_DEPTH && cascadeEventBudget > 0) {
    cascadeEventBudget--;
    const matching = Array.from(store.pipelines.values()).filter(
      (p) => p.status === 'ACTIVE' && p.trigger === event.type && matchesFilter(event.payload, p.filter),
    );
    if (matching.length > 0) {
      event.cascaded = true;
      cascadeDepth++;
      for (const p of matching) {
        try {
          const exec = executePipeline(p, event, cascadeDepth);
          store.executions.unshift(exec);
          if (store.executions.length > 200) store.executions.length = 200;
        } catch { /* best-effort */ }
      }
      cascadeDepth--;
    }
  }
}

/** Check whether an event payload matches a pipeline's filter (all keys must equal). */
function matchesFilter(payload: Record<string, unknown>, filter?: Record<string, unknown>): boolean {
  if (!filter) return true;
  for (const [k, v] of Object.entries(filter)) {
    if (payload[k] !== v) return false;
  }
  return true;
}

// ═══════════════════════════════════════════════════════════════════════════
// SERVICE OBJECT — the public API of the Economic Composition Engine
// ═══════════════════════════════════════════════════════════════════════════

export interface EconomicEngineService {
  // ── Tokens ──
  listTokens(): TokenDefinition[];
  getToken(id: string): TokenDefinition | undefined;
  registerToken(def: Omit<TokenDefinition, 'totalSupply' | 'holderCount' | 'mintCount' | 'burnCount' | 'consumeCount' | 'createdAt'>): TokenDefinition;
  mint(tokenId: string, to: string, toType: HolderType, toLabel: string, amount: number, reason: string, source?: string, pipelineId?: string): TokenOperation;
  burn(tokenId: string, from: string, amount: number, reason: string, source?: string): TokenOperation;
  transfer(tokenId: string, from: string, to: string, toType: HolderType, toLabel: string, amount: number, reason: string, source?: string): TokenOperation;
  consume(tokenId: string, from: string, amount: number, reason: string, source?: string, pipelineId?: string): TokenOperation;
  balances(filter?: { tokenId?: string; holderId?: string; holderType?: HolderType }): TokenBalance[];
  operations(filter?: { tokenId?: string; limit?: number }): TokenOperation[];

  // ── Extensions ──
  listExtensions(): EconomicExtension[];
  getExtension(id: string): EconomicExtension | undefined;
  registerExtension(manifest: ExtensionManifest, opts?: { reputation?: number }): EconomicExtension;
  setExtensionStatus(id: string, status: ExtensionStatus): EconomicExtension | null;

  // ── Events / Bus ──
  publishEvent(type: string, source: string, payload: Record<string, unknown>, tokenId?: string): EconomicEvent;
  listEvents(filter?: { type?: string; source?: string; limit?: number }): EconomicEvent[];
  subscribe(eventType: string, handler: EventSubscriber): () => void;

  // ── Pipelines ──
  listPipelines(): TokenPipeline[];
  getPipeline(id: string): TokenPipeline | undefined;
  registerPipeline(input: { name: string; description: string; trigger: string; filter?: Record<string, unknown>; steps: PipelineStep[]; status?: PipelineStatus }): TokenPipeline;
  setPipelineStatus(id: string, status: PipelineStatus): TokenPipeline | null;
  triggerPipeline(id: string, payload: Record<string, unknown>): PipelineExecution | null;
  listExecutions(filter?: { pipelineId?: string; limit?: number }): PipelineExecution[];

  // ── Graph + Overview ──
  buildGraph(): EconomicGraph;
  overview(): EconomicOverview;
}

export const economicEngine: EconomicEngineService = {
  // ────────────── Tokens ──────────────
  listTokens() {
    return Array.from(store.tokens.values()).sort((a, b) => a.id.localeCompare(b.id));
  },
  getToken(id) {
    return store.tokens.get(id);
  },
  registerToken(def) {
    const t: TokenDefinition = {
      ...def,
      totalSupply: 0, holderCount: 0, mintCount: 0, burnCount: 0, consumeCount: 0,
      createdAt: Date.now(),
    };
    store.tokens.set(t.id, t);
    return t;
  },
  mint(tokenId, to, toType, toLabel, amount, reason, source, pipelineId) {
    const token = store.tokens.get(tokenId);
    if (!token) throw new Error(`Unknown token: ${tokenId}`);
    if (amount <= 0) throw new Error('mint amount must be > 0');
    touchBalance(tokenId, to, toType, toLabel, amount);
    token.totalSupply += amount;
    token.mintCount++;
    token.holderCount = countHolders(tokenId);
    if (toType === 'EXTENSION') {
      const ext = store.extensions.get(to);
      if (ext) ext.tokensMinted += amount;
    }
    return recordOperation(tokenId, 'MINT', amount, reason, { to, toType, source, pipelineId });
  },
  burn(tokenId, from, amount, reason, source) {
    const token = store.tokens.get(tokenId);
    if (!token) throw new Error(`Unknown token: ${tokenId}`);
    if (amount <= 0) throw new Error('burn amount must be > 0');
    const k = balanceKey(tokenId, from);
    const b = store.balances.get(k);
    if (!b || b.balance < amount) throw new Error(`Insufficient balance of ${tokenId} for ${from}`);
    touchBalance(tokenId, from, b.holderType, b.holderLabel, -amount);
    token.totalSupply -= amount;
    token.burnCount++;
    return recordOperation(tokenId, 'BURN', amount, reason, { from, source });
  },
  transfer(tokenId, from, to, toType, toLabel, amount, reason, source) {
    const token = store.tokens.get(tokenId);
    if (!token) throw new Error(`Unknown token: ${tokenId}`);
    if (amount <= 0) throw new Error('transfer amount must be > 0');
    const k = balanceKey(tokenId, from);
    const b = store.balances.get(k);
    if (!b || b.balance < amount) throw new Error(`Insufficient balance of ${tokenId} for ${from}`);
    touchBalance(tokenId, from, b.holderType, b.holderLabel, -amount);
    touchBalance(tokenId, to, toType, toLabel, amount);
    token.holderCount = countHolders(tokenId);
    return recordOperation(tokenId, 'TRANSFER', amount, reason, { from, to, toType, source });
  },
  consume(tokenId, from, amount, reason, source, pipelineId) {
    const token = store.tokens.get(tokenId);
    if (!token) throw new Error(`Unknown token: ${tokenId}`);
    if (!token.consumable) throw new Error(`Token ${tokenId} is not consumable`);
    if (amount <= 0) throw new Error('consume amount must be > 0');
    const k = balanceKey(tokenId, from);
    const b = store.balances.get(k);
    if (!b || b.balance < amount) throw new Error(`Insufficient balance of ${tokenId} for ${from}`);
    touchBalance(tokenId, from, b.holderType, b.holderLabel, -amount, amount);
    token.consumeCount++;
    if (b.holderType === 'EXTENSION') {
      const ext = store.extensions.get(from);
      if (ext) ext.tokensConsumed += amount;
    }
    return recordOperation(tokenId, 'CONSUME', amount, reason, { from, source, pipelineId });
  },
  balances(filter) {
    let rows = Array.from(store.balances.values());
    if (filter?.tokenId) rows = rows.filter((b) => b.tokenId === filter.tokenId);
    if (filter?.holderId) rows = rows.filter((b) => b.holderId === filter.holderId);
    if (filter?.holderType) rows = rows.filter((b) => b.holderType === filter.holderType);
    return rows.sort((a, b) => b.balance - a.balance);
  },
  operations(filter) {
    let rows = store.operations;
    if (filter?.tokenId) rows = rows.filter((o) => o.tokenId === filter.tokenId);
    if (filter?.limit) rows = rows.slice(0, filter.limit);
    return rows;
  },

  // ────────────── Extensions ──────────────
  listExtensions() {
    return Array.from(store.extensions.values()).sort((a, b) => a.registeredAt - b.registeredAt);
  },
  getExtension(id) {
    return store.extensions.get(id);
  },
  registerExtension(manifest, opts) {
    const existing = store.extensions.get(manifest.id);
    const ext: EconomicExtension = existing ?? {
      id: manifest.id,
      name: manifest.name,
      version: manifest.version,
      status: 'ACTIVE',
      category: manifest.category,
      description: manifest.description,
      manifest,
      reputation: opts?.reputation ?? 50,
      treasury: {},
      eventsPublished: 0,
      eventsConsumed: 0,
      tokensMinted: 0,
      tokensConsumed: 0,
      registeredAt: Date.now(),
    };
    if (existing) {
      ext.manifest = manifest;
      ext.name = manifest.name;
      ext.version = manifest.version;
      ext.description = manifest.description;
    }
    store.extensions.set(ext.id, ext);
    // register subscriber stubs so this extension's subscribed events increment counters
    // (actual reactions are simulated via the reactors list in publishInternal).
    return ext;
  },
  setExtensionStatus(id, status) {
    const ext = store.extensions.get(id);
    if (!ext) return null;
    ext.status = status;
    return ext;
  },

  // ────────────── Events / Bus ──────────────
  publishEvent(type, source, payload, tokenId) {
    const event: EconomicEvent = {
      id: uid('eco'),
      type, source, tokenId,
      payload, ts: Date.now(),
      reactors: [], cascaded: false,
    };
    if (tokenId) {
      const t = store.tokens.get(tokenId);
      if (t) event.tokenSymbol = t.symbol;
    }
    // reset cascade budget for a top-level publish
    cascadeDepth = 0;
    cascadeEventBudget = MAX_CASCADE_EVENTS;
    publishInternal(event);
    // increment publisher's counter
    const ext = store.extensions.get(source);
    if (ext) ext.eventsPublished++;
    return event;
  },
  listEvents(filter) {
    let rows = store.events;
    if (filter?.type) rows = rows.filter((e) => e.type === filter.type);
    if (filter?.source) rows = rows.filter((e) => e.source === filter.source);
    if (filter?.limit) rows = rows.slice(0, filter.limit);
    return rows;
  },
  subscribe(eventType, handler) {
    let set = store.subscribers.get(eventType);
    if (!set) { set = new Set(); store.subscribers.set(eventType, set); }
    set.add(handler);
    return () => { set!.delete(handler); };
  },

  // ────────────── Pipelines ──────────────
  listPipelines() {
    return Array.from(store.pipelines.values()).sort((a, b) => a.createdAt - b.createdAt);
  },
  getPipeline(id) {
    return store.pipelines.get(id);
  },
  registerPipeline(input) {
    const p: TokenPipeline = {
      id: uid('ecop'),
      name: input.name,
      description: input.description,
      trigger: input.trigger,
      filter: input.filter,
      steps: input.steps,
      status: input.status ?? 'ACTIVE',
      executions: 0, successes: 0, failures: 0,
      createdAt: Date.now(),
    };
    store.pipelines.set(p.id, p);
    return p;
  },
  setPipelineStatus(id, status) {
    const p = store.pipelines.get(id);
    if (!p) return null;
    p.status = status;
    return p;
  },
  triggerPipeline(id, payload) {
    const p = store.pipelines.get(id);
    if (!p || p.status !== 'ACTIVE') return null;
    const event: EconomicEvent = {
      id: uid('eco'),
      type: p.trigger,
      source: 'manual',
      payload,
      ts: Date.now(),
      reactors: [], cascaded: false,
    };
    cascadeDepth = 0;
    cascadeEventBudget = MAX_CASCADE_EVENTS;
    // record the event first
    store.events.unshift(event);
    if (store.events.length > 500) store.events.length = 500;
    const exec = executePipeline(p, event, 1);
    store.executions.unshift(exec);
    if (store.executions.length > 200) store.executions.length = 200;
    return exec;
  },
  listExecutions(filter) {
    let rows = store.executions;
    if (filter?.pipelineId) rows = rows.filter((e) => e.pipelineId === filter.pipelineId);
    if (filter?.limit) rows = rows.slice(0, filter.limit);
    return rows;
  },

  // ────────────── Graph + Overview ──────────────
  buildGraph() {
    return buildGraph();
  },
  overview(): EconomicOverview {
    const exts = Array.from(store.extensions.values());
    const pipes = Array.from(store.pipelines.values());
    const execs = store.executions;
    return {
      extensionCount: exts.length,
      activeExtensionCount: exts.filter((e) => e.status === 'ACTIVE').length,
      tokenCount: store.tokens.size,
      totalSupply: Array.from(store.tokens.values()).reduce((s, t) => s + t.totalSupply, 0),
      pipelineCount: pipes.length,
      activePipelineCount: pipes.filter((p) => p.status === 'ACTIVE').length,
      totalExecutions: execs.length,
      successfulExecutions: execs.filter((e) => e.status === 'COMPLETED').length,
      failedExecutions: execs.filter((e) => e.status === 'FAILED').length,
      eventCount: store.events.length,
      cascadedEvents: store.events.filter((e) => e.cascaded).length,
      operationCount: store.operations.length,
    };
  },
};

function countHolders(tokenId: string): number {
  let n = 0;
  for (const b of store.balances.values()) {
    if (b.tokenId === tokenId && b.balance > 0) n++;
  }
  return n;
}

// ═══════════════════════════════════════════════════════════════════════════
// SEED — 12 extensions, 18 tokens, 5 pipelines, execution history
// Demonstrates the cross-extension composition vision: identity → marketplace
// → credit → treasury → rewards cascades via tokens + events.
// ═══════════════════════════════════════════════════════════════════════════

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
function ago(ms: number) { return Date.now() - ms; }

interface SeedToken { id: string; symbol: string; name: string; issuer: string; kind: TokenDefinition['kind']; consumable: boolean; color: string; description: string; }
interface SeedExt { id: string; name: string; version: string; category: string; description: string; reputation: number; emits: string[]; consumes: string[]; publishes: string[]; subscribes: string[]; capabilities: string[]; }

const SEED_TOKENS: SeedToken[] = [
  { id: 'identity.verified',     symbol: 'VID', name: 'Verified Identity Token',  issuer: 'identity',    kind: 'SOULBOUND',    consumable: true,  color: 'sky',      description: 'Proof of KYC-verified identity. Consumed by marketplace, lending, insurance, travel.' },
  { id: 'identity.trust',        symbol: 'TRT', name: 'Trust Score Token',         issuer: 'identity',    kind: 'FUNGIBLE',     consumable: false, color: 'sky',      description: 'Quantified identity trust score (0–100).' },
  { id: 'marketplace.reward',    symbol: 'MRP', name: 'Marketplace Reward Token',  issuer: 'marketplace', kind: 'FUNGIBLE',     consumable: true,  color: 'emerald',  description: 'Earned on completed marketplace sales. Consumed by rewards.' },
  { id: 'marketplace.reputation',symbol: 'SRT', name: 'Seller Reputation Token',   issuer: 'marketplace', kind: 'FUNGIBLE',     consumable: false, color: 'emerald',  description: 'Accumulated seller reputation. Subscribed by lending.' },
  { id: 'lending.collateral',    symbol: 'COL', name: 'Collateral Token',          issuer: 'lending',     kind: 'FUNGIBLE',     consumable: true,  color: 'amber',    description: 'Locked collateral backing a loan.' },
  { id: 'lending.credit',        symbol: 'CRD', name: 'Credit Score Token',        issuer: 'lending',     kind: 'FUNGIBLE',     consumable: false, color: 'amber',    description: 'Credit score increment. Subscribed by treasury.' },
  { id: 'treasury.reserve',      symbol: 'RC',  name: 'Reserve Certificate',       issuer: 'treasury',    kind: 'FUNGIBLE',     consumable: false, color: 'teal',     description: '1:1 backing certificate for fiat reserves. Subscribed by bandwidth.' },
  { id: 'treasury.solvency',     symbol: 'SOL', name: 'Solvency Proof Token',      issuer: 'treasury',    kind: 'SOULBOUND',    consumable: false, color: 'teal',     description: 'Proof of solvency at a point in time.' },
  { id: 'ai.inference_credit',   symbol: 'AIC', name: 'Inference Credit',          issuer: 'ai',          kind: 'FUNGIBLE',     consumable: true,  color: 'violet',   description: 'Prepaid AI inference credit. Consumed on each model call.' },
  { id: 'storage.credit',        symbol: 'STC', name: 'Storage Credit',            issuer: 'storage',     kind: 'FUNGIBLE',     consumable: true,  color: 'cyan',     description: 'Prepaid decentralized storage credit.' },
  { id: 'bandwidth.liquidity',   symbol: 'LBT', name: 'Liquidity Bandwidth Token', issuer: 'bandwidth',   kind: 'FUNGIBLE',     consumable: true,  color: 'rose',     description: 'LP liquidity bandwidth allocation per corridor.' },
  { id: 'rewards.points',        symbol: 'RWP', name: 'Rewards Points',            issuer: 'rewards',     kind: 'FUNGIBLE',     consumable: false, color: 'fuchsia',  description: 'Customer loyalty points. Subscribed by analytics.' },
  { id: 'rewards.loyalty',       symbol: 'LYP', name: 'Loyalty Tier Token',        issuer: 'rewards',     kind: 'NON_FUNGIBLE', consumable: false, color: 'fuchsia',  description: 'Tiered loyalty badge (bronze/silver/gold/platinum).' },
  { id: 'insurance.policy',      symbol: 'POL', name: 'Insurance Policy Token',    issuer: 'insurance',   kind: 'NON_FUNGIBLE', consumable: false, color: 'indigo',   description: 'Active insurance policy NFT. Requires VID.' },
  { id: 'carbon.offset',         symbol: 'COF', name: 'Carbon Offset Token',       issuer: 'carbon',      kind: 'FUNGIBLE',     consumable: false, color: 'lime',     description: 'Verified carbon offset credit per sale.' },
  { id: 'education.credit',      symbol: 'EDC', name: 'Education Credit',          issuer: 'education',   kind: 'FUNGIBLE',     consumable: true,  color: 'orange',   description: 'Credit for completed coursework. Consumed by employment.' },
  { id: 'employment.skill',      symbol: 'SKL', name: 'Skill Token',               issuer: 'employment',  kind: 'NON_FUNGIBLE', consumable: false, color: 'orange',   description: 'Verified skill credential NFT. Subscribed by lending.' },
  { id: 'marketplace.cashback',  symbol: 'MCB', name: 'Merchant Cashback Token',   issuer: 'marketplace', kind: 'FUNGIBLE',     consumable: false, color: 'emerald',  description: 'Cashback issued to merchants on settled sales.' },
];

const SEED_EXTENSIONS: SeedExt[] = [
  { id: 'identity',   name: 'Identity Extension',   version: '2.1.0', category: 'identity',   reputation: 92, description: 'KYC + identity verification. Mints VID (soulbound) and TRT (trust score). Foundation of the trust graph — every other extension depends on identity.verified as a consumable contract.', emits: ['identity.verified', 'identity.trust'], consumes: [], publishes: ['identity.verified', 'identity.trust_updated'], subscribes: [], capabilities: ['identity.verify', 'identity.kyc', 'identity.score'] },
  { id: 'marketplace',name: 'Marketplace Extension',version: '3.4.2', category: 'marketplace',reputation: 88, description: 'Peer-to-peer merchant marketplace. Mints SRT (reputation) + MRP (rewards) + MCB (cashback). Consumes VID to gate premium listings. Publishes sale.completed on every transaction.', emits: ['marketplace.reward', 'marketplace.reputation', 'marketplace.cashback'], consumes: ['identity.verified'], publishes: ['sale.completed', 'review.created'], subscribes: ['payment.completed'], capabilities: ['marketplace.list', 'marketplace.buy', 'marketplace.review'] },
  { id: 'lending',    name: 'Lending Extension',    version: '1.8.0', category: 'lending',    reputation: 79, description: 'Undercollateralized lending backed by reputation. Mints COL (collateral) + CRD (credit score). Consumes VID. Subscribes to marketplace.reputation mints and identity.verified to raise credit limits.', emits: ['lending.collateral', 'lending.credit'], consumes: ['identity.verified'], publishes: ['loan.originated', 'credit.score_increased'], subscribes: ['token.minted', 'identity.verified'], capabilities: ['lending.originate', 'lending.score', 'lending.liquidate'] },
  { id: 'treasury',   name: 'Treasury Extension',   version: '4.2.1', category: 'treasury',   reputation: 95, description: 'Protocol-layer reserve management. Mints RC (reserve certificates, 1:1 fiat-backed) + SOL (solvency proofs). Subscribes to payment.completed to mint reserves. The economic backbone.', emits: ['treasury.reserve', 'treasury.solvency'], consumes: [], publishes: ['treasury.reserve_minted', 'settlement.confirmed'], subscribes: ['payment.completed'], capabilities: ['treasury.mint_reserve', 'treasury.audit', 'treasury.freeze'] },
  { id: 'ai',         name: 'AI Director',          version: '1.3.0', category: 'ai',         reputation: 81, description: 'Autonomous economic intelligence. Mints AIC (inference credits). Subscribes to payment.completed and sale.completed to detect fraud, optimize routing, and publish ai.insight events.', emits: ['ai.inference_credit'], consumes: [], publishes: ['ai.insight', 'ai.fraud_alert'], subscribes: ['payment.completed', 'sale.completed'], capabilities: ['ai.detect_fraud', 'ai.route', 'ai.score'] },
  { id: 'storage',    name: 'Storage Extension',    version: '2.0.0', category: 'storage',    reputation: 74, description: 'Decentralized document + receipt storage. Mints STC (storage credits). Subscribes to sale.completed to auto-archive invoices and settlement proofs.', emits: ['storage.credit'], consumes: [], publishes: ['document.archived'], subscribes: ['sale.completed'], capabilities: ['storage.archive', 'storage.retrieve', 'storage.pin'] },
  { id: 'bandwidth',  name: 'Bandwidth Extension',  version: '1.5.0', category: 'bandwidth',  reputation: 83, description: 'LP liquidity bandwidth allocation. Mints LBT (bandwidth tokens) per corridor. Subscribes to treasury.reserve_minted to expand LP capacity as reserves grow.', emits: ['bandwidth.liquidity'], consumes: [], publishes: ['bandwidth.allocated'], subscribes: ['treasury.reserve_minted'], capabilities: ['bandwidth.allocate', 'bandwidth.rebalance'] },
  { id: 'rewards',    name: 'Rewards Extension',    version: '2.7.0', category: 'rewards',    reputation: 86, description: 'Customer loyalty engine. Mints RWP (points) + LYP (tier NFTs). Consumes marketplace.reward. Subscribes to sale.completed and settlement.confirmed to issue points and promote tiers.', emits: ['rewards.points', 'rewards.loyalty'], consumes: ['marketplace.reward'], publishes: ['loyalty.updated', 'tier.promoted'], subscribes: ['sale.completed', 'settlement.confirmed'], capabilities: ['rewards.issue', 'rewards.redeem', 'rewards.tier'] },
  { id: 'insurance',  name: 'Insurance Extension',  version: '1.2.0', category: 'insurance',  reputation: 77, description: 'On-chain parametric insurance. Mints POL (policy NFTs). Consumes VID (no insurance without verified identity). Subscribes to sale.completed to offer policy upsells.', emits: ['insurance.policy'], consumes: ['identity.verified'], publishes: ['policy.issued', 'claim.payout'], subscribes: ['sale.completed'], capabilities: ['insurance.issue', 'insurance.claim', 'insurance.price'] },
  { id: 'carbon',     name: 'Carbon Offset Extension',version: '1.1.0',category: 'carbon',     reputation: 72, description: 'Verified carbon offset credits. Mints COF per sale. Subscribes to sale.completed to auto-offset transaction footprint. No identity requirement — purely reactive.', emits: ['carbon.offset'], consumes: [], publishes: ['carbon.offset_issued'], subscribes: ['sale.completed'], capabilities: ['carbon.offset', 'carbon.measure', 'carbon.retire'] },
  { id: 'education',  name: 'Education Extension',  version: '1.0.0', category: 'education',  reputation: 68, description: ' accredited learning + credentialing. Mints EDC (education credits) on tuition payment. Subscribed by employment. Demonstrates cross-domain composition: payment → education → employment → credit.', emits: ['education.credit'], consumes: [], publishes: ['education.completed', 'learning.milestone'], subscribes: ['payment.completed'], capabilities: ['education.accredit', 'education.issue_credit'] },
  { id: 'employment', name: 'Employment Extension', version: '1.0.0', category: 'employment', reputation: 70, description: 'Verified employment + skill credentialing. Mints SKL (skill NFTs). Consumes education.credit. Subscribed by lending (skills raise credit). Completes the tuition → skill → credit cascade.', emits: ['employment.skill'], consumes: ['education.credit'], publishes: ['skill.verified', 'employment.confirmed'], subscribes: ['education.completed'], capabilities: ['employment.verify', 'employment.skill'] },
];

const SEED_PIPELINES: Array<{ name: string; description: string; trigger: string; filter?: Record<string, unknown>; steps: PipelineStep[] }> = [
  {
    name: 'Payment Settlement Cascade',
    description: 'On any payment completion: mint treasury reserves, issue rewards points, notify analytics, and publish a loyalty update. The canonical composition cascade.',
    trigger: 'payment.completed',
    steps: [
      { action: 'mint', token: 'treasury.reserve', amount: '${payload.amount}', target: 'treasury', targetType: 'TREASURY', label: 'Mint reserve certificates (1:1)' },
      { action: 'mint', token: 'rewards.points', amount: '${payload.amount}', target: '${payload.customerId}', targetType: 'CUSTOMER', label: 'Issue rewards points to customer' },
      { action: 'mint', token: 'marketplace.cashback', amount: 1, target: '${payload.merchantId}', targetType: 'MERCHANT', label: 'Issue merchant cashback' },
      { action: 'notify', event: 'analytics.transaction', payload: { settled: true }, label: 'Notify analytics layer' },
      { action: 'publish', event: 'loyalty.updated', payload: { source: 'payment' }, label: 'Publish loyalty.updated' },
    ],
  },
  {
    name: 'Identity Verification Cascade',
    description: 'On identity verification: marketplace consumes VID to unlock premium listings, lending consumes VID to raise credit, treasury reduces reserve requirements. One event → four extensions react.',
    trigger: 'identity.verified',
    steps: [
      { action: 'consume', token: 'identity.verified', amount: 1, label: 'Marketplace consumes VID (unlock premium)' },
      { action: 'mint', token: 'marketplace.reputation', amount: 5, target: '${payload.merchantId}', targetType: 'MERCHANT', label: 'Mint seller reputation boost' },
      { action: 'consume', token: 'identity.verified', amount: 1, label: 'Lending consumes VID (raise credit limit)' },
      { action: 'mint', token: 'lending.credit', amount: 10, target: '${payload.userId}', targetType: 'USER', label: 'Increase credit score' },
      { action: 'publish', event: 'risk.reduced', payload: { reason: 'verified_identity' }, label: 'Publish risk.reduced' },
    ],
  },
  {
    name: 'Sale Composition Pipeline',
    description: 'On a marketplace sale: mint merchant rewards, mint carbon offsets, issue customer points, notify analytics, publish loyalty update. Six-token cascade from one sale event.',
    trigger: 'sale.completed',
    steps: [
      { action: 'mint', token: 'marketplace.reward', amount: '${payload.amount}', target: '${payload.merchantId}', targetType: 'MERCHANT', label: 'Mint marketplace rewards to merchant' },
      { action: 'mint', token: 'carbon.offset', amount: 1, target: '${payload.merchantId}', targetType: 'MERCHANT', label: 'Auto-offset carbon footprint' },
      { action: 'mint', token: 'rewards.points', amount: '${payload.amount}', target: '${payload.customerId}', targetType: 'CUSTOMER', label: 'Issue customer rewards points' },
      { action: 'notify', event: 'analytics.sale', payload: { type: 'marketplace' }, label: 'Notify analytics' },
      { action: 'publish', event: 'loyalty.updated', payload: { source: 'sale' }, label: 'Publish loyalty.updated' },
    ],
  },
  {
    name: 'Tuition Learning Pipeline',
    description: 'On a tuition payment: mint education credits, publish education.completed (which triggers employment to mint skills), mint credit score increase, issue learning points. Demonstrates cross-domain composition: payment → education → employment → credit → rewards.',
    trigger: 'payment.completed',
    filter: { category: 'tuition' },
    steps: [
      { action: 'mint', token: 'education.credit', amount: 3, target: '${payload.customerId}', targetType: 'CUSTOMER', label: 'Mint education credits to student' },
      { action: 'publish', event: 'education.completed', payload: { studentId: '${payload.customerId}' }, label: 'Publish education.completed (triggers employment)' },
      { action: 'mint', token: 'lending.credit', amount: 15, target: '${payload.customerId}', targetType: 'CUSTOMER', label: 'Credit score increase (educated borrower)' },
      { action: 'mint', token: 'rewards.points', amount: 50, target: '${payload.customerId}', targetType: 'CUSTOMER', label: 'Learning milestone rewards' },
      { action: 'publish', event: 'learning.milestone', payload: { type: 'tuition_paid' }, label: 'Publish learning.milestone' },
    ],
  },
  {
    name: 'Reserve Liquidity Cascade',
    description: 'On treasury reserve minting: expand LP bandwidth capacity, notify treasury ops, publish liquidity.expanded. Shows how the treasury backbone propagates to the LP network.',
    trigger: 'treasury.reserve_minted',
    steps: [
      { action: 'mint', token: 'bandwidth.liquidity', amount: '${payload.amount}', target: 'lp-pool', targetType: 'LP', label: 'Expand LP bandwidth capacity' },
      { action: 'notify', event: 'treasury.ops', payload: { action: 'liquidity_expanded' }, label: 'Notify treasury operations' },
      { action: 'publish', event: 'liquidity.expanded', payload: { source: 'reserve' }, label: 'Publish liquidity.expanded' },
    ],
  },
];

/** Pre-seed a few completed executions so the trace viewer has data on first paint. */
function seedExecutionHistory() {
  const sample = SEED_PIPELINES[0]; // Payment Settlement Cascade
  const executions: PipelineExecution[] = [
    {
      id: uid('ecoexec'),
      pipelineId: 'seed-pipeline-1',
      pipelineName: sample.name,
      trigger: sample.trigger,
      triggerEvent: { type: 'payment.completed', source: 'system', payload: { amount: 250, customerId: 'cust_demo_001', merchantId: 'merch_demo_001', category: 'retail' }, ts: ago(2 * HOUR) },
      steps: sample.steps.map((s, i) => ({ stepIndex: i, action: s.action, label: s.label, status: 'SUCCESS' as const, detail: stepDetail(s), ts: ago(2 * HOUR) + i * 40 })),
      status: 'COMPLETED',
      startedAt: ago(2 * HOUR),
      completedAt: ago(2 * HOUR) + 600,
      durationMs: 612,
      cascadeDepth: 1,
    },
    {
      id: uid('ecoexec'),
      pipelineId: 'seed-pipeline-2',
      pipelineName: SEED_PIPELINES[2].name,
      trigger: SEED_PIPELINES[2].trigger,
      triggerEvent: { type: 'sale.completed', source: 'marketplace', payload: { amount: 120, customerId: 'cust_demo_042', merchantId: 'merch_demo_007' }, ts: ago(5 * HOUR) },
      steps: SEED_PIPELINES[2].steps.map((s, i) => ({ stepIndex: i, action: s.action, label: s.label, status: 'SUCCESS' as const, detail: stepDetail(s), ts: ago(5 * HOUR) + i * 38 })),
      status: 'COMPLETED',
      startedAt: ago(5 * HOUR),
      completedAt: ago(5 * HOUR) + 480,
      durationMs: 488,
      cascadeDepth: 1,
    },
    {
      id: uid('ecoexec'),
      pipelineId: 'seed-pipeline-1',
      pipelineName: sample.name,
      trigger: sample.trigger,
      triggerEvent: { type: 'payment.completed', source: 'system', payload: { amount: 1800, customerId: 'cust_demo_120', merchantId: 'merch_demo_022', category: 'tuition' }, ts: ago(1 * DAY) },
      steps: sample.steps.map((s, i) => ({ stepIndex: i, action: s.action, label: s.label, status: i === 2 ? 'FAILED' as const : 'SUCCESS' as const, detail: i === 2 ? 'merchantId missing in payload' : stepDetail(s), ts: ago(1 * DAY) + i * 42 })),
      status: 'FAILED',
      startedAt: ago(1 * DAY),
      completedAt: ago(1 * DAY) + 540,
      durationMs: 540,
      cascadeDepth: 1,
    },
    {
      id: uid('ecoexec'),
      pipelineId: 'seed-pipeline-1',
      pipelineName: sample.name,
      trigger: sample.trigger,
      triggerEvent: { type: 'payment.completed', source: 'system', payload: { amount: 75, customerId: 'cust_demo_008', merchantId: 'merch_demo_003', category: 'retail' }, ts: ago(3 * HOUR) },
      steps: sample.steps.map((s, i) => ({ stepIndex: i, action: s.action, label: s.label, status: 'SUCCESS' as const, detail: stepDetail(s), ts: ago(3 * HOUR) + i * 41 })),
      status: 'COMPLETED',
      startedAt: ago(3 * HOUR),
      completedAt: ago(3 * HOUR) + 590,
      durationMs: 590,
      cascadeDepth: 1,
    },
  ];
  for (const e of executions) store.executions.push(e);
}

function stepDetail(s: PipelineStep): string {
  switch (s.action) {
    case 'mint': return `minted ${s.amount} ${tokenSym(s.token)}`;
    case 'burn': return `burned ${s.amount} ${tokenSym(s.token)}`;
    case 'consume': return `consumed ${s.amount} ${tokenSym(s.token)}`;
    case 'transfer': return `transferred ${s.amount} ${tokenSym(s.token)}`;
    case 'publish': return `published ${s.event}`;
    case 'notify': return `notified ${s.event}`;
    case 'wait': return `waited`;
    case 'condition': return `condition: ${s.condition}`;
  }
}
function tokenSym(id?: string): string {
  if (!id) return '?';
  const t = SEED_TOKENS.find((x) => x.id === id);
  return t?.symbol ?? id;
}

function seedInitialBalances() {
  // Give some holders initial token balances so the ledger has data on first paint.
  const initial: Array<[string, string, HolderType, string, number]> = [
    ['identity.verified', 'cust_demo_001', 'CUSTOMER', 'Aba Kwesi', 1],
    ['identity.verified', 'cust_demo_042', 'CUSTOMER', 'Mara Diallo', 1],
    ['identity.verified', 'cust_demo_120', 'CUSTOMER', 'Sade Okoro', 1],
    ['identity.trust', 'cust_demo_001', 'CUSTOMER', 'Aba Kwesi', 78],
    ['identity.trust', 'cust_demo_042', 'CUSTOMER', 'Mara Diallo', 85],
    ['marketplace.reputation', 'merch_demo_001', 'MERCHANT', 'Accra Coffee Co', 240],
    ['marketplace.reputation', 'merch_demo_007', 'MERCHANT', 'Lome Market', 180],
    ['marketplace.reputation', 'merch_demo_022', 'MERCHANT', 'Nairobi Tech Hub', 95],
    ['treasury.reserve', 'treasury', 'TREASURY', 'Treasury Reserve', 850000],
    ['rewards.points', 'cust_demo_001', 'CUSTOMER', 'Aba Kwesi', 1240],
    ['rewards.points', 'cust_demo_042', 'CUSTOMER', 'Mara Diallo', 3420],
    ['rewards.loyalty', 'cust_demo_042', 'CUSTOMER', 'Mara Diallo', 1],
    ['lending.credit', 'cust_demo_001', 'CUSTOMER', 'Aba Kwesi', 620],
    ['lending.credit', 'cust_demo_042', 'CUSTOMER', 'Mara Diallo', 710],
    ['bandwidth.liquidity', 'lp-pool', 'LP', 'LP Pool (GH/XOF)', 420000],
    ['ai.inference_credit', 'ai', 'EXTENSION', 'AI Director', 50000],
    ['storage.credit', 'storage', 'EXTENSION', 'Storage Extension', 120000],
    ['carbon.offset', 'merch_demo_001', 'MERCHANT', 'Accra Coffee Co', 340],
    ['carbon.offset', 'merch_demo_007', 'MERCHANT', 'Lome Market', 220],
    ['education.credit', 'cust_demo_120', 'CUSTOMER', 'Sade Okoro', 9],
    ['employment.skill', 'cust_demo_120', 'CUSTOMER', 'Sade Okoro', 2],
    ['marketplace.cashback', 'merch_demo_001', 'MERCHANT', 'Accra Coffee Co', 18],
    ['marketplace.cashback', 'merch_demo_003', 'MERCHANT', 'Takoradi Logistics', 7],
  ];
  for (const [tokenId, holderId, holderType, holderLabel, balance] of initial) {
    const token = store.tokens.get(tokenId);
    if (!token) continue;
    touchBalance(tokenId, holderId, holderType, holderLabel, balance);
    token.totalSupply += balance;
    token.holderCount = countHolders(tokenId);
  }
}

/** Idempotent auto-seed on first import. */
export function seedEconomicStore(): void {
  if (globalForEconomic.__PAYSWAP_ECONOMIC_SEEDED__) return;
  globalForEconomic.__PAYSWAP_ECONOMIC_SEEDED__ = true;

  // 1. Tokens
  for (const t of SEED_TOKENS) {
    store.tokens.set(t.id, {
      id: t.id, symbol: t.symbol, name: t.name, issuer: t.issuer, kind: t.kind,
      consumable: t.consumable, description: t.description, color: t.color,
      totalSupply: 0, holderCount: 0, mintCount: 0, burnCount: 0, consumeCount: 0,
      createdAt: ago(30 * DAY),
    });
  }

  // 2. Extensions
  for (const e of SEED_EXTENSIONS) {
    const manifest: ExtensionManifest = {
      id: e.id, name: e.name, version: e.version, description: e.description, category: e.category,
      tokens: { emits: e.emits, consumes: e.consumes },
      events: { publishes: e.publishes, subscribes: e.subscribes },
      capabilities: e.capabilities,
    };
    store.extensions.set(e.id, {
      id: e.id, name: e.name, version: e.version, status: 'ACTIVE',
      category: e.category, description: e.description, manifest,
      reputation: e.reputation, treasury: {},
      eventsPublished: 0, eventsConsumed: 0, tokensMinted: 0, tokensConsumed: 0,
      registeredAt: ago(28 * DAY),
    });
  }

  // 3. Pipelines
  for (const p of SEED_PIPELINES) {
    const id = `seed-pipeline-${SEED_PIPELINES.indexOf(p) + 1}`;
    store.pipelines.set(id, {
      id, name: p.name, description: p.description, trigger: p.trigger, filter: p.filter,
      steps: p.steps, status: 'ACTIVE',
      executions: 0, successes: 0, failures: 0,
      createdAt: ago(20 * DAY),
    });
  }

  // 4. Initial balances (so the ledger isn't empty)
  seedInitialBalances();

  // 5. Execution history
  seedExecutionHistory();

  // 6. A few seeded events
  const seedEvents: EconomicEvent[] = [
    { id: uid('eco'), type: 'payment.completed', source: 'system', payload: { amount: 250, customerId: 'cust_demo_001', merchantId: 'merch_demo_001', category: 'retail' }, ts: ago(2 * HOUR), reactors: ['treasury', 'ai', 'marketplace', 'rewards', 'education'], cascaded: true },
    { id: uid('eco'), type: 'sale.completed', source: 'marketplace', payload: { amount: 120, customerId: 'cust_demo_042', merchantId: 'merch_demo_007' }, ts: ago(5 * HOUR), reactors: ['rewards', 'ai', 'storage', 'insurance', 'carbon'], cascaded: true },
    { id: uid('eco'), type: 'identity.verified', source: 'identity', tokenId: 'identity.verified', tokenSymbol: 'VID', payload: { userId: 'cust_demo_120' }, ts: ago(8 * HOUR), reactors: ['marketplace', 'lending', 'insurance'], cascaded: true },
    { id: uid('eco'), type: 'treasury.reserve_minted', source: 'treasury', tokenId: 'treasury.reserve', tokenSymbol: 'RC', payload: { amount: 850000 }, ts: ago(1 * DAY), reactors: ['bandwidth'], cascaded: true },
    { id: uid('eco'), type: 'loyalty.updated', source: 'rewards', payload: { source: 'sale' }, ts: ago(5 * HOUR), reactors: [], cascaded: false },
    { id: uid('eco'), type: 'token.minted', source: 'marketplace', tokenId: 'marketplace.reward', tokenSymbol: 'MRP', payload: { amount: 120, to: 'merch_demo_007' }, ts: ago(5 * HOUR), reactors: ['rewards'], cascaded: true },
  ];
  for (const e of seedEvents) store.events.push(e);
}
seedEconomicStore();

// Re-export types for convenience.
export type {
  TokenDefinition, TokenBalance, TokenOperation, TokenOpType,
  EconomicEvent, EventSubscriber, HolderType,
  ExtensionManifest, EconomicExtension, ExtensionStatus,
  TokenPipeline, PipelineStep, PipelineExecution, PipelineStatus,
  EconomicGraph, GraphNode, GraphEdge,
  EconomicOverview,
} from './types';
