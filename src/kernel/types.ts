/**
 * PaySwap Kernel — Type Contract
 * -----------------------------------------------------------------------------
 * Single source of truth for the kernel's data shapes. Consumed by:
 *   - kernel engines        (src/kernel/*)
 *   - API route             (src/app/api/simulate/route.ts)
 *   - Simulator UI          (src/app/page.tsx)
 *
 * The Kernel is Milestone-1 infrastructure. It owns no UI, no merchant logic,
 * no product logic — only the financial primitives every later layer depends on.
 */

/* -------------------------------------------------------------------------- */
/* Currencies & FX                                                            */
/* -------------------------------------------------------------------------- */

export type CurrencyCode = 'KES' | 'GHS' | 'NGN' | 'USD' | 'ZAR' | 'UGX' | 'TZS';

export interface CurrencyMeta {
  code: CurrencyCode;
  symbol: string;
  name: string;
  decimals: number;
  countries: string[];
}

/* -------------------------------------------------------------------------- */
/* Scenario (simulator input)                                                 */
/* -------------------------------------------------------------------------- */

export type RoutingPreference = 'fastest' | 'cheapest' | 'safest';

export interface PartyDescriptor {
  country: string;
  currency: CurrencyCode;
  method: string; // e.g. "M-Pesa", "Bank Transfer", "Mobile Money"
  label: string; // e.g. "Buyer" / "Merchant"
}

export interface ReserveConfig {
  country: string;
  currency: CurrencyCode;
  balance: number;
  minThreshold: number;
}

export interface LiquidityProviderConfig {
  id: string;
  country: string;
  currency: CurrencyCode;
  capacity: number;
  rate: number; // fee percent, e.g. 0.8 => 0.8%
  speedMs: number; // settlement speed contribution
}

export interface SimulationScenario {
  buyer: PartyDescriptor;
  merchant: PartyDescriptor;
  amount: number;
  currency: CurrencyCode; // denomination of `amount` (merchant currency)
  reserves: ReserveConfig[];
  liquidityProviders: LiquidityProviderConfig[];
  preference: RoutingPreference;
}

/* -------------------------------------------------------------------------- */
/* Ledger (double-entry, multi-currency)                                      */
/* -------------------------------------------------------------------------- */

export type AccountType =
  | 'asset'
  | 'liability'
  | 'equity'
  | 'revenue'
  | 'expense';

export interface LedgerAccount {
  id: string;
  label: string;
  currency: CurrencyCode;
  type: AccountType;
  balance: number;
}

export interface LedgerEntry {
  id: string;
  txId: string;
  accountId: string;
  accountLabel: string;
  accountType: AccountType;
  currency: CurrencyCode;
  debit: number; // 0 if credit
  credit: number; // 0 if debit
  balanceAfter: number;
  memo: string;
  frame: number;
  ts: number;
}

/* -------------------------------------------------------------------------- */
/* Twin Token                                                                 */
/* -------------------------------------------------------------------------- */

export type TwinTokenStatus = 'minted' | 'transferred' | 'burned';

export interface TwinTokenRecord {
  id: string;
  symbol: string; // e.g. TWIN-KEN-GHA-0001
  amount: number;
  currency: CurrencyCode;
  fromCountry: string;
  toCountry: string;
  status: TwinTokenStatus;
  mintedAtFrame: number;
  burnedAtFrame: number | null;
  memo: string;
}

/* -------------------------------------------------------------------------- */
/* Events                                                                     */
/* -------------------------------------------------------------------------- */

export interface SimulationEvent {
  id: string;
  type: string; // e.g. "ledger.posted", "twin.minted", "lp.consumed"
  payload: Record<string, unknown>;
  ts: number;
  frame: number;
}

/* -------------------------------------------------------------------------- */
/* Transaction Plan (the routing output)                                      */
/* -------------------------------------------------------------------------- */

export type PlanHopType =
  | 'source'
  | 'payment'
  | 'reserve'
  | 'liquidity'
  | 'fx'
  | 'destination';

export interface PlanHop {
  index: number;
  type: PlanHopType;
  label: string;
  country?: string;
  currency?: CurrencyCode;
  amount?: number;
  detail?: string;
  meta?: Record<string, string | number>;
}

export interface TransactionPlan {
  hops: PlanHop[];
  totalHops: number;
  lpUsage: LpUsage[];
  twinTokenSymbol: string;
}

export interface LpUsage {
  lpId: string;
  drawn: number;
  rate: number;
  fee: number;
  exhausted: boolean;
  remaining: number;
}

/* -------------------------------------------------------------------------- */
/* Metrics                                                                    */
/* -------------------------------------------------------------------------- */

export interface SimulationMetrics {
  settlementTimeMs: number;
  settlementTimeLabel: string; // "2m 34s"
  costPercent: number; // blended, e.g. 0.82
  costAmount: number; // in merchant currency
  riskScore: number; // 0..1
  riskLabel: string; // "Low" | "Moderate" | "Elevated"
  confidence: number; // 0..100
  fxRate: number; // source->target
  fxSpreadBps: number;
  totalFees: number;
  reserveUtilization: number; // 0..100
  liquidityUtilization: number; // 0..100
}

/* -------------------------------------------------------------------------- */
/* AI Agent reasoning                                                         */
/* -------------------------------------------------------------------------- */

export interface AIDecision {
  step: string;
  rationale: string;
}

export interface AIReasoning {
  strategy: string;
  steps: string[];
  decisions: AIDecision[];
  narrative: string; // LLM-enhanced paragraph (falls back to deterministic)
  llmPowered: boolean;
}

/* -------------------------------------------------------------------------- */
/* Replay frames                                                              */
/* -------------------------------------------------------------------------- */

export type ReplayFrameType =
  | 'debit'
  | 'credit'
  | 'mint'
  | 'burn'
  | 'ledger'
  | 'events'
  | 'ai'
  | 'settlement';

export interface ReplayFrame {
  index: number;
  key: string;
  title: string;
  description: string;
  type: ReplayFrameType;
  ledgerEntries?: LedgerEntry[];
  twinToken?: TwinTokenRecord;
  events?: SimulationEvent[];
  decisions?: AIDecision[];
  summary?: string;
}

/* -------------------------------------------------------------------------- */
/* Audit                                                                      */
/* -------------------------------------------------------------------------- */

export interface AuditEntry {
  ts: number;
  action: string;
  detail: string;
  actor: string;
}

export interface AuditTrace {
  runId: string;
  actor: string;
  entries: AuditEntry[];
}

/* -------------------------------------------------------------------------- */
/* Engine health (Kernel registry)                                            */
/* -------------------------------------------------------------------------- */

export type EngineStatus = 'online' | 'degraded' | 'offline';

export interface EngineHealth {
  id: string;
  name: string;
  category: string;
  status: EngineStatus;
  version: string;
  description: string;
}

/* -------------------------------------------------------------------------- */
/* Resulting world state after simulation                                     */
/* -------------------------------------------------------------------------- */

export interface ReserveStateResult {
  country: string;
  currency: CurrencyCode;
  balanceBefore: number;
  balanceAfter: number;
  minThreshold: number;
  delta: number;
  healthy: boolean;
}

export interface LpStateResult {
  lpId: string;
  country: string;
  currency: CurrencyCode;
  capacity: number;
  used: number;
  remaining: number;
  rate: number;
}

export interface WorldStateResult {
  reserves: ReserveStateResult[];
  liquidityProviders: LpStateResult[];
}

/* -------------------------------------------------------------------------- */
/* Simulation Result (the full API contract)                                  */
/* -------------------------------------------------------------------------- */

export interface SimulationResult {
  runId: string;
  createdAt: number;
  kernelVersion: string;
  scenario: SimulationScenario;
  plan: TransactionPlan;
  metrics: SimulationMetrics;
  reasoning: AIReasoning;
  replay: ReplayFrame[];
  ledger: LedgerEntry[];
  events: SimulationEvent[];
  twinTokens: TwinTokenRecord[];
  worldState: WorldStateResult;
  audit: AuditTrace;
  engines: EngineHealth[];
}

/* -------------------------------------------------------------------------- */
/* Internal world (in-memory kernel state used during a simulation)          */
/* -------------------------------------------------------------------------- */

export interface WorldState {
  accounts: Map<string, LedgerAccount>;
  reserves: ReserveConfig[]; // mutable copy
  liquidityProviders: LiquidityProviderConfig[]; // mutable copy
}
