/**
 * Kernel registry — the manifest of all Milestone-1 engines.
 *
 * Every engine is declared here with its category, version and a one-line
 * description. The simulator surfaces this manifest as the "kernel online"
 * panel. The kernel is centered on GLOBAL LIQUIDITY, not payments.
 */
import type { EngineHealth } from './types';
import { KERNEL_VERSION } from './support';

export const ENGINES: EngineHealth[] = [
  { id: 'ledger', name: 'Ledger Engine', category: 'Accounting', status: 'online', version: KERNEL_VERSION, description: 'Multi-currency double-entry ledger — the single source of truth for balances.' },
  { id: 'liquidity-planner', name: 'Liquidity Planner', category: 'Orchestration', status: 'online', version: KERNEL_VERSION, description: 'Generates immutable Liquidity Execution Plans with explainable AI.' },
  { id: 'plan-executor', name: 'Plan Executor', category: 'Orchestration', status: 'online', version: KERNEL_VERSION, description: 'Executes plans atomically. Sim and production use the exact same engine.' },
  { id: 'transaction', name: 'Transaction Engine', category: 'Orchestration', status: 'online', version: KERNEL_VERSION, description: 'Lifecycle of a liquidity movement: request → plan → execute → audit.' },
  { id: 'reserve', name: 'Reserve Engine', category: 'Liquidity', status: 'online', version: KERNEL_VERSION, description: 'Per-country reserves with available/locked/forecast + thresholds.' },
  { id: 'liquidity', name: 'Liquidity Engine', category: 'Liquidity', status: 'online', version: KERNEL_VERSION, description: '8 liquidity source types (reserve, LP, treasury, cooperative, diaspora...).' },
  { id: 'twin-token', name: 'Twin Token Engine', category: 'Tokens', status: 'online', version: KERNEL_VERSION, description: 'Mints/burns canonical liquidity receipts — not speculative assets.' },
  { id: 'treasury', name: 'Treasury Engine', category: 'Finance', status: 'online', version: KERNEL_VERSION, description: 'Fee accrual + stablecoin/emergency positions.' },
  { id: 'treasury-ai', name: 'Treasury AI', category: 'Intelligence', status: 'online', version: KERNEL_VERSION, description: 'Continuous liquidity recommendations — nothing hidden.' },
  { id: 'fx', name: 'FX Engine', category: 'Markets', status: 'online', version: KERNEL_VERSION, description: 'Currency conversion with transparent spreads.' },
  { id: 'pricing', name: 'Pricing Engine', category: 'Markets', status: 'online', version: KERNEL_VERSION, description: 'Blended cost of a liquidity movement (LP + FX + reserve + treasury).' },
  { id: 'compliance', name: 'Compliance Engine', category: 'Governance', status: 'online', version: KERNEL_VERSION, description: 'KYC/AML, sanctions and corridor authorization.' },
  { id: 'risk', name: 'Risk Engine', category: 'Governance', status: 'online', version: KERNEL_VERSION, description: 'Multi-dimensional 0..1 risk score — every factor explainable.' },
  { id: 'fraud', name: 'Fraud Engine', category: 'Governance', status: 'online', version: KERNEL_VERSION, description: 'Heuristic fraud scoring and recommendation.' },
  { id: 'insurance', name: 'Insurance Engine', category: 'Governance', status: 'online', version: KERNEL_VERSION, description: 'Claims: evidence, community vote, PaySwap vote, appeal, slash/reward.' },
  { id: 'event', name: 'Event Engine', category: 'Infrastructure', status: 'online', version: KERNEL_VERSION, description: 'In-process pub/sub event bus — the kernel\'s nervous system.' },
  { id: 'workflow', name: 'Workflow Engine', category: 'Orchestration', status: 'online', version: KERNEL_VERSION, description: 'Declarative workflows for manual settlement & insurance claims.' },
  { id: 'ai-agent', name: 'AI Agent Engine', category: 'Intelligence', status: 'online', version: KERNEL_VERSION, description: 'Explainable multi-objective optimization across 8 dimensions.' },
  { id: 'extension', name: 'Extension Runtime', category: 'Platform', status: 'online', version: KERNEL_VERSION, description: 'Lifecycle hooks for Milestone-3 extensions (before/after).' },
  { id: 'policy', name: 'Policy Engine', category: 'Governance', status: 'online', version: KERNEL_VERSION, description: 'Declarative rules: concentration, thresholds, cost/risk caps, reserve policy.' },
  { id: 'permission', name: 'Permission Engine', category: 'Security', status: 'online', version: KERNEL_VERSION, description: 'Capability-based access control over kernel mutations.' },
  { id: 'audit', name: 'Audit Engine', category: 'Security', status: 'online', version: KERNEL_VERSION, description: 'Append-only, tamper-evident audit log of every action.' },
  { id: 'simulation', name: 'Digital Twin', category: 'Platform', status: 'online', version: KERNEL_VERSION, description: 'Admin Digital Twin: failure injection, Time Machine, full replay.' },
];

export const ENGINE_COUNT = ENGINES.length;
