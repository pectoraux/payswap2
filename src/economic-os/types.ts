/**
 * Economic Operating System — Type Definitions.
 *
 * The next evolution of PaySwap: from "extension system" to "economic OS".
 *
 *   Intent → Economic Compiler → Composition Graph → Autonomous Actors
 *         → Economic Assets → Settlement Kernel → Event Ledger → Digital Twin
 *
 * Key shifts from the extension-system layer (src/economic/):
 *   1. Extensions disappear from the center — they become Actors (autonomous businesses).
 *      The Compiler becomes the heart.
 *   2. Actors declare only 4 things: Produces, Consumes, Capabilities, Policies.
 *      No knowledge of other actors. No direct coupling.
 *   3. Tokens generalize to Assets. Everything implements EconomicAsset.
 *      Assets are typed (Currency, Claim, Credential, Right, Reservation, Debt,
 *      Equity, Insurance, Reputation, Capability, Bandwidth, License, Evidence, Receipt).
 *   4. Composition is discovered by the Intent Compiler (backward-chaining planner),
 *      not hand-written pipelines. Users express Intent; the compiler finds the DAG.
 *   5. Actors have P&L (treasury, balance sheet, revenue, costs, pricing, SLAs).
 *      They trade with each other through the compiler.
 *   6. Capability Marketplace — actors advertise capabilities with pricing + SLAs;
 *      the compiler chooses providers (like liquidity providers today).
 *   7. Economic Optimizer — finds the cheapest composition across cost, latency,
 *      trust, reputation, regulatory policy, geography, treasury health.
 *
 * This module is a NEW layer parallel to src/runtime/, src/economic/, src/claims/.
 * It does NOT modify the Prisma schema (constraint: frozen). All records live in a
 * process-wide singleton on globalThis.
 */

// ═══════════════════════════════════════════════════════════════════════════
// ECONOMIC ASSETS — generalized from tokens. Everything is an asset.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * The type system that lets the compiler reason about assets. Each type has
 * distinct semantics — a Currency is fungible and transferable; a Credential
 * is soulbound; a Reservation is time-limited; Debt is an obligation; etc.
 */
export type EconomicAssetType =
  | 'CURRENCY'      // fungible money (USD, GHS, USDC)
  | 'CLAIM'         // a claim on something (escrow claim, reserve certificate)
  | 'CREDENTIAL'    // a verified attribute (verified identity, skill)
  | 'RIGHT'         // a permission (cashback right, voting right, discount right)
  | 'RESERVATION'   // a held resource (inventory reservation, bandwidth allocation)
  | 'DEBT'          // an obligation (loan, collateral position)
  | 'EQUITY'        // ownership stake
  | 'INSURANCE'     // a policy
  | 'REPUTATION'    // a trust score
  | 'CAPABILITY'    // an ability quota (API quota, compute, storage credits)
  | 'BANDWIDTH'     // liquidity bandwidth
  | 'LICENSE'       // a license to operate
  | 'EVIDENCE'      // compliance evidence
  | 'RECEIPT';      // proof of transaction

export const ALL_ASSET_TYPES: EconomicAssetType[] = [
  'CURRENCY', 'CLAIM', 'CREDENTIAL', 'RIGHT', 'RESERVATION', 'DEBT', 'EQUITY',
  'INSURANCE', 'REPUTATION', 'CAPABILITY', 'BANDWIDTH', 'LICENSE', 'EVIDENCE', 'RECEIPT',
];

export const ASSET_TYPE_META: Record<EconomicAssetType, { label: string; color: string; icon: string; description: string }> = {
  CURRENCY:    { label: 'Currency',    color: 'emerald', icon: 'Coins',       description: 'Fungible money — USD, GHS, USDC, stablecoins.' },
  CLAIM:       { label: 'Claim',       color: 'teal',    icon: 'FileSignature',description: 'A claim on an underlying resource — escrow claim, reserve certificate.' },
  CREDENTIAL:  { label: 'Credential',  color: 'sky',     icon: 'BadgeCheck',  description: 'A verified attribute — identity, skill, accreditation. Often soulbound.' },
  RIGHT:       { label: 'Right',       color: 'violet',  icon: 'Key',         description: 'A permission — cashback right, voting right, discount right.' },
  RESERVATION: { label: 'Reservation', color: 'amber',   icon: 'CalendarClock',description: 'A held resource with time limits — inventory, bandwidth, compute.' },
  DEBT:        { label: 'Debt',        color: 'rose',    icon: 'Landmark',    description: 'An obligation — loan, collateral position, payable.' },
  EQUITY:      { label: 'Equity',      color: 'indigo',  icon: 'PieChart',    description: 'Ownership stake in an asset or entity.' },
  INSURANCE:   { label: 'Insurance',   color: 'cyan',    icon: 'Shield',      description: 'A policy covering risk for a defined period.' },
  REPUTATION:  { label: 'Reputation',  color: 'fuchsia', icon: 'Star',        description: 'A quantified trust score — seller, LP, borrower.' },
  CAPABILITY:  { label: 'Capability',  color: 'orange',  icon: 'Cpu',         description: 'An ability quota — API calls, compute, storage credits.' },
  BANDWIDTH:   { label: 'Bandwidth',   color: 'lime',    icon: 'Radio',       description: 'Liquidity bandwidth allocation per corridor.' },
  LICENSE:     { label: 'License',     color: 'slate',   icon: 'Award',       description: 'A license to operate — regulatory, software, distribution.' },
  EVIDENCE:    { label: 'Evidence',    color: 'purple',  icon: 'FileText',    description: 'Compliance evidence — KYC proof, audit trail, attestation.' },
  RECEIPT:     { label: 'Receipt',     color: 'gray',    icon: 'Receipt',     description: 'Proof of transaction — payment receipt, tuition receipt.' },
};

/**
 * An asset definition — a typed economic resource that actors produce/consume.
 * Asset ids are dot-namespaced: `education.credit`, `identity.verified`,
 * `treasury.reserve_certificate`, `carbon.offset`.
 */
export interface EconomicAsset {
  id: string;                  // 'education.credit'
  name: string;                // 'Education Credit'
  type: EconomicAssetType;
  issuer: string;              // actor id that produces this ('education')
  unit: string;                // 'credits', 'USD', 'points', 'tokens'
  fungible: boolean;           // fungible vs unique (NFT)
  transferable: boolean;       // can be moved between holders
  consumable: boolean;         // consumed on use
  timeLimited: boolean;        // expires
  description: string;
  totalSupply: number;
  holderCount: number;
  color: string;               // UI hue
  createdAt: number;
}

/** An asset holding — a balance or instance owned by a holder. */
export interface AssetHolding {
  assetId: string;
  holderId: string;
  holderType: 'ACTOR' | 'USER' | 'MERCHANT' | 'CUSTOMER' | 'TREASURY' | 'LP';
  holderLabel: string;
  balance: number;
  consumed: number;
  expiresAt?: number;
  updatedAt: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// ECONOMIC ACTORS — autonomous businesses (extensions disappear into actors)
// ═══════════════════════════════════════════════════════════════════════════

export type ActorStatus = 'ACTIVE' | 'PAUSED' | 'SUSPENDED';

/**
 * A capability an actor advertises in the marketplace — what it can do, for
 * what price, with what SLA. The compiler chooses between competing providers
 * exactly like it chooses between liquidity providers.
 */
export interface CapabilityAdvertisement {
  id: string;
  actorId: string;
  name: string;                // 'verify_passport'
  description: string;
  produces: string[];          // asset ids this capability produces
  consumes: string[];          // asset ids this capability requires
  pricePerInvocation: number;  // in USD
  priceAsset?: string;         // asset id to charge in (defaults to USD currency)
  latencyMs: number;           // typical latency
  slaSuccessRate: number;      // 0–1
  trustScore: number;          // 0–100
  region: string;              // 'global' | 'GH' | 'NG' | ...
  regulatoryApproved: string[];// jurisdictions where approved
}

/**
 * The four contracts an actor declares. Nothing else.
 * No knowledge of other actors — only of asset types it produces/consumes.
 */
export interface ActorContracts {
  produces: string[];          // asset ids
  consumes: string[];          // asset ids
  capabilities: string[];      // capability names
  policies: ActorPolicy[];
}

export interface ActorPolicy {
  id: string;
  name: string;
  description: string;
  rule: string;                // e.g. 'require_kyc', 'max_exposure_50k', 'geo_block_US'
  enforcement: 'BLOCK' | 'WARN' | 'REQUIRE_APPROVAL';
}

/**
 * An autonomous economic business. Has a treasury, balance sheet, P&L, pricing,
 * SLAs, and policies. Trades with other actors through the compiler.
 */
export interface EconomicActor {
  id: string;
  name: string;
  version: string;
  status: ActorStatus;
  category: string;
  description: string;
  contracts: ActorContracts;

  // ── Business metrics ──
  treasury: Record<string, number>;   // assetId → balance (the actor's own holdings)
  reputation: number;                 // 0–100
  trustScore: number;                 // 0–100

  // ── P&L (profit & loss) ──
  revenue: number;                    // cumulative USD earned
  costs: number;                      // cumulative USD spent
  profit: number;                     // revenue - costs
  balanceSheetAssets: number;         // USD value of holdings
  balanceSheetLiabilities: number;    // USD value of obligations

  // ── Operational metrics ──
  invocations: number;                // times its capabilities were called
  successfulInvocations: number;
  failedInvocations: number;
  avgLatencyMs: number;

  registeredAt: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// INTENTS — what users express. The compiler discovers the composition.
// ═══════════════════════════════════════════════════════════════════════════

export interface AssetBinding {
  assetId: string;
  amount: number;
  holderId?: string;           // who provides/holds this
}

export interface IntentConstraints {
  maxCost?: number;            // USD
  maxLatencyMs?: number;
  minTrust?: number;           // 0–100
  region?: string;
  regulatoryJurisdiction?: string;
  preferCheapest?: boolean;
  preferFastest?: boolean;
  preferMostTrusted?: boolean;
}

/**
 * An intent — a goal the user expresses. The compiler expands it into a
 * composition DAG by walking Produces/Consumes contracts across actors.
 * No pipeline is written; the compiler discovers it.
 */
export interface Intent {
  id: string;
  name: string;                // 'Pay tuition'
  description: string;
  goal: string;                // the asset id to ultimately produce ('education.credit')
  inputs: AssetBinding[];      // assets the user brings (money, identity)
  desiredOutputs?: string[];   // additional side-effect assets hoped for
  constraints?: IntentConstraints;
  category: string;            // 'payment' | 'education' | 'insurance' | ...
  createdAt: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// COMPOSITION GRAPH — the DAG the compiler discovers
// ═══════════════════════════════════════════════════════════════════════════

export type CompositionNodeKind = 'INPUT' | 'ACTOR' | 'OUTPUT' | 'OPPORTUNISTIC';

export type CompositionNodeStatus = 'pending' | 'selected' | 'executing' | 'completed' | 'failed' | 'skipped';

/**
 * A node in the discovered composition graph. Either an input (user-provided
 * asset), an actor invocation (performs a capability), an output (the goal
 * asset), or an opportunistic attachment (an actor that reacts to a produced
 * asset to add value — e.g. carbon offset after a purchase).
 */
export interface CompositionNode {
  id: string;
  kind: CompositionNodeKind;
  actorId?: string;
  actorName?: string;
  capability?: string;
  capabilityAdId?: string;     // which marketplace advertisement was chosen
  produces: AssetBinding[];
  consumes: AssetBinding[];
  cost: number;                // USD
  latencyMs: number;
  trustScore: number;
  reasoning?: string;          // why the optimizer chose this provider
  status: CompositionNodeStatus;
  alternatives?: Array<{ actorId: string; actorName: string; cost: number; latencyMs: number; trustScore: number; reason: string }>;
}

export interface CompositionEdge {
  from: string;                // node id
  to: string;                  // node id
  assetId: string;
  amount: number;
}

export type CompositionGraphStatus = 'compiled' | 'executing' | 'settled' | 'failed' | 'policy_blocked';

/**
 * The discovered composition — a DAG of actor invocations that, when executed
 * in topological order, settles the intent.
 */
export interface CompositionGraph {
  id: string;
  intentId: string;
  intentName: string;
  nodes: CompositionNode[];
  edges: CompositionEdge[];
  totalCost: number;
  totalLatencyMs: number;
  trustScore: number;
  actorCount: number;
  opportunisticCount: number;
  status: CompositionGraphStatus;
  policyViolations?: PolicyViolation[];
  compiledAt: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// POLICY ENGINE — constraints the compiler must respect
// ═══════════════════════════════════════════════════════════════════════════

export interface PolicyViolation {
  policyId: string;
  policyName: string;
  actorId: string;
  rule: string;
  severity: 'BLOCK' | 'WARN' | 'REQUIRE_APPROVAL';
  message: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// SETTLEMENT — executing the compiled graph atomically, recording P&L
// ═══════════════════════════════════════════════════════════════════════════

export interface SettlementStep {
  nodeId: string;
  actorId?: string;
  actorName?: string;
  capability?: string;
  status: 'SUCCESS' | 'FAILED' | 'SKIPPED';
  producedAssets: AssetBinding[];
  consumedAssets: AssetBinding[];
  revenue: number;             // USD charged by this actor
  cost: number;                // USD paid by this actor (to upstream actors)
  detail: string;
  ts: number;
}

export interface SettlementExecution {
  id: string;
  graphId: string;
  intentId: string;
  intentName: string;
  steps: SettlementStep[];
  status: 'RUNNING' | 'SETTLED' | 'FAILED';
  totalRevenue: number;
  totalCost: number;
  startedAt: number;
  completedAt?: number;
  durationMs?: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// OVERVIEW
// ═══════════════════════════════════════════════════════════════════════════

export interface EconomicOSOverview {
  actorCount: number;
  activeActorCount: number;
  assetTypeCount: number;
  assetCount: number;
  intentCount: number;
  capabilityCount: number;
  compilationCount: number;
  settlementCount: number;
  settledCount: number;
  totalRevenue: number;
  totalProfit: number;
  totalTreasuryValue: number;
}
