/**
 * Kernel registry — the manifest of all 21 Milestone-1 engines.
 *
 * Every engine is declared here with its category, version and a one-line
 * description. The simulator surfaces this manifest as the "kernel online"
 * panel so it's obvious which primitives are available. Adding an engine in
 * a later milestone means adding a row here plus its implementation module.
 */
import type { EngineHealth } from './types';
import { KERNEL_VERSION } from './support';

export const ENGINES: EngineHealth[] = [
  { id: 'ledger', name: 'Ledger Engine', category: 'Accounting', status: 'online', version: KERNEL_VERSION, description: 'Multi-currency double-entry ledger — the single source of truth for balances.' },
  { id: 'transaction', name: 'Transaction Engine', category: 'Orchestration', status: 'online', version: KERNEL_VERSION, description: 'Lifecycle of a value transfer: intent → authorize → route → settle.' },
  { id: 'routing', name: 'Routing Engine', category: 'Flow', status: 'online', version: KERNEL_VERSION, description: 'Path-finding across reserves and LPs by merchant preference.' },
  { id: 'reserve', name: 'Reserve Engine', category: 'Liquidity', status: 'online', version: KERNEL_VERSION, description: 'Per-country reserves with minimum-threshold protection.' },
  { id: 'liquidity', name: 'Liquidity Engine', category: 'Liquidity', status: 'online', version: KERNEL_VERSION, description: 'Liquidity provider registry, draw and capacity tracking.' },
  { id: 'twin-token', name: 'Twin Token Engine', category: 'Tokens', status: 'online', version: KERNEL_VERSION, description: 'Mints, transfers and burns pegged cross-border obligation tokens.' },
  { id: 'settlement', name: 'Settlement Engine', category: 'Orchestration', status: 'online', version: KERNEL_VERSION, description: 'Executes a routed plan atomically, frame by frame.' },
  { id: 'treasury', name: 'Treasury Engine', category: 'Finance', status: 'online', version: KERNEL_VERSION, description: 'Fee accrual, FX reserves and treasury positions.' },
  { id: 'fx', name: 'FX Engine', category: 'Markets', status: 'online', version: KERNEL_VERSION, description: 'Currency conversion with transparent spreads.' },
  { id: 'pricing', name: 'Pricing Engine', category: 'Markets', status: 'online', version: KERNEL_VERSION, description: 'Blended cost of a routed payment (LP + FX + reserve).' },
  { id: 'compliance', name: 'Compliance Engine', category: 'Governance', status: 'online', version: KERNEL_VERSION, description: 'KYC/AML, sanctions and corridor authorization.' },
  { id: 'risk', name: 'Risk Engine', category: 'Governance', status: 'online', version: KERNEL_VERSION, description: '0..1 risk score from reserves, concentration, FX and path.' },
  { id: 'fraud', name: 'Fraud Engine', category: 'Governance', status: 'online', version: KERNEL_VERSION, description: 'Heuristic fraud scoring and recommendation.' },
  { id: 'event', name: 'Event Engine', category: 'Infrastructure', status: 'online', version: KERNEL_VERSION, description: 'In-process pub/sub event bus — the kernel\'s nervous system.' },
  { id: 'workflow', name: 'Workflow Engine', category: 'Orchestration', status: 'online', version: KERNEL_VERSION, description: 'Declarative multi-step workflows over the kernel.' },
  { id: 'ai-agent', name: 'AI Agent Engine', category: 'Intelligence', status: 'online', version: KERNEL_VERSION, description: 'Deterministic reasoning over routing, pricing and risk.' },
  { id: 'extension', name: 'Extension Runtime', category: 'Platform', status: 'online', version: KERNEL_VERSION, description: 'Lifecycle hooks for Milestone-3 extensions (before/after).' },
  { id: 'policy', name: 'Policy Engine', category: 'Governance', status: 'online', version: KERNEL_VERSION, description: 'Declarative rules: concentration, thresholds, cost & risk caps.' },
  { id: 'permission', name: 'Permission Engine', category: 'Security', status: 'online', version: KERNEL_VERSION, description: 'Capability-based access control over kernel mutations.' },
  { id: 'audit', name: 'Audit Engine', category: 'Security', status: 'online', version: KERNEL_VERSION, description: 'Append-only, tamper-evident audit log of every action.' },
  { id: 'simulation', name: 'Simulation Engine', category: 'Platform', status: 'online', version: KERNEL_VERSION, description: 'Runs scenarios against the production kernel, producing replays.' },
];

export const ENGINE_COUNT = ENGINES.length;
