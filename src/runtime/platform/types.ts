/**
 * Platform Experience — Types. (M-PLATFORM-38.)
 *
 * The runtime kernel is COMPLETE. This module exposes the kernel through
 * an inspectable, debuggable, extensible, and production-safe platform.
 *
 * The UI is only another surface over the runtime. No duplicated logic.
 *
 * 4 parts:
 *   1. Runtime Simulator (scenario builder + timeline + graph + inspectors)
 *   2. Live/Test Mode (Stripe-style environments)
 *   3. Extension Platform (lifecycle + permissions + marketplace)
 *   4. UX Refactor (progressive disclosure + role switching + task navigation)
 */

// ─── PART 1: Runtime Simulator ─────────────────────────────────────────────

export interface SimulationScenario {
  scenarioId: string;
  name: string;
  description: string;
  fromCountry: string;
  toCountry: string;
  amount: number;
  currency: string;
  senderHasReserve: boolean;
  receiverHasReserve: boolean;
  isLocal: boolean;
  // Optional failure injections.
  lpTimeout?: boolean;
  recipientNeverConfirms?: boolean;
  stablecoinDepeg?: boolean;
  reserveDepletion?: boolean;
  // Metadata.
  createdAt: number;
  createdBy: string;
}

export interface SimulationResult {
  scenarioId: string;
  // Execution trace (every step of the pipeline).
  timeline: SimulationStep[];
  // The execution plan produced by the Liquidity Policy Engine.
  executionPlan: {
    strategy: string;
    treasuryActions: number;
    liquidityActions: number;
    settlementActions: number;
    requiredBandwidth: number;
    requiredEscrow: number;
    fallbackGraph: { primary: string; fallbacks: number; finalFallback: string };
  };
  // Events produced.
  eventsProduced: number;
  // Ledger state after execution.
  ledgerSnapshot: {
    totalAssets: number;
    totalLiabilities: number;
    totalEquity: number;
    isBalanced: boolean;
  };
  // Council decision (if council was convened).
  councilDecision?: {
    outcome: string;
    supportWeight: number;
    opposeWeight: number;
    rationale: string;
  };
  // Constitutional review.
  constitutionalReview: { passed: boolean; violations: string[] };
  // Final status.
  status: 'completed' | 'failed' | 'rolled_back';
  error?: string;
  durationMs: number;
}

export interface SimulationStep {
  step: number;
  stage: string;
  description: string;
  durationMs: number;
  status: 'ok' | 'skipped' | 'failed';
  details?: Record<string, unknown>;
}

// ─── AI Runtime Assistant ──────────────────────────────────────────────────

export interface AIAssistantQuery {
  queryId: string;
  question: string;
  context?: {
    scenarioId?: string;
    transactionId?: string;
    eventRange?: { from: number; to: number };
  };
}

export interface AIAssistantResponse {
  queryId: string;
  question: string;
  answer: string;
  reasoning: string[];
  relevantEvents?: string[];
  relevantDecisions?: string[];
  suggestedActions?: string[];
  confidence: number;
}

// ─── PART 2: Live/Test Mode ────────────────────────────────────────────────

export type PlatformEnvironment = 'live' | 'test';

export interface EnvironmentState {
  active: PlatformEnvironment;
  environments: {
    live: { eventCount: number; treasuryAccounts: number; twinTokens: number; isReady: boolean };
    test: { eventCount: number; treasuryAccounts: number; twinTokens: number; isReady: boolean };
  };
  isolationVerified: boolean;
}

// ─── PART 3: Extension Platform ────────────────────────────────────────────

export type ExtensionStatus =
  | 'draft' | 'sandbox' | 'submitted' | 'review' | 'approved'
  | 'published' | 'installed' | 'enabled' | 'disabled' | 'deprecated' | 'archived';

export type ExtensionCategory =
  | 'accounting' | 'analytics' | 'crm' | 'marketing' | 'inventory'
  | 'loyalty' | 'payroll' | 'tax' | 'savings' | 'erp' | 'insurance' | 'ai';

export type ExtensionPermission =
  | 'payments' | 'wallets' | 'transactions' | 'customer_data'
  | 'analytics' | 'treasury' | 'marketplace' | 'notifications' | 'reports';

export interface Extension {
  extensionId: string;
  name: string;
  description: string;
  developerId: string;
  category: ExtensionCategory;
  status: ExtensionStatus;
  version: string;
  permissions: ExtensionPermission[];
  installCount: number;
  rating: number;
  createdAt: number;
  publishedAt: number | null;
}

export interface ExtensionMarketplace {
  featured: Extension[];
  popular: Extension[];
  byCategory: Record<string, Extension[]>;
  total: number;
}

export interface DeveloperConsole {
  developerId: string;
  sandbox: {
    eventCount: number;
    treasuryAccounts: number;
    walletCount: number;
    apiKeys: string[];
  };
  extensions: Extension[];
  apiKeys: APIKey[];
}

export interface APIKey {
  keyId: string;
  name: string;
  environment: PlatformEnvironment;
  permissions: ExtensionPermission[];
  createdAt: number;
  lastUsed: number | null;
}

// ─── PART 4: UX Refactor ───────────────────────────────────────────────────

export type UserRole =
  | 'merchant' | 'lp' | 'customer' | 'developer'
  | 'treasury_operator' | 'support' | 'admin' | 'council';

export interface RoleContext {
  role: UserRole;
  displayName: string;
  availableTasks: TaskItem[];
  healthScore: number;
  onboardingComplete: boolean;
}

export interface TaskItem {
  taskId: string;
  category: string;
  label: string;
  description: string;
  icon: string;
  primaryAction?: string;
}

export interface PlatformNavigation {
  tasks: TaskItem[];
  roles: UserRole[];
  activeRole: UserRole;
  environment: PlatformEnvironment;
}
