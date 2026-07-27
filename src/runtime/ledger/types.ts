/**
 * Canonical Economic Ledger — Types. (M-ECO-35.)
 *
 * The Economic Ledger is the single source of economic truth. It derives
 * the network's balance sheet from events — it never owns state.
 *
 *   Events → Economic Ledger Projection → Network Balance Sheet
 *
 * Everything can be rebuilt. Exactly like every other projection.
 *
 * The ledger answers:
 *   "Where did every unit of value originate?"
 *   "What is every twin token backed by?"
 *   "Which LP ultimately financed this settlement?"
 *   "Which reserve pool absorbed this redemption?"
 *   "What is the network's real-time balance sheet?"
 *
 * Assets = Liabilities + Equity (after every event, always)
 */

// ─── Balance Sheet ─────────────────────────────────────────────────────────

/** The network's canonical balance sheet. */
export interface BalanceSheet {
  // Assets (what PaySwap owns/controls).
  assets: {
    fiatReserves: number;
    stablecoinReserves: number;
    escrow: number;
    receivables: number;
    treasuryInventory: number;
    outstandingLPAdvances: number;
    totalAssets: number;
  };
  // Liabilities (what PaySwap owes).
  liabilities: {
    twinTokensOutstanding: number;
    pendingSettlements: number;
    pendingRedemptions: number;
    lpRewards: number;
    treasuryObligations: number;
    totalLiabilities: number;
  };
  // Equity (what PaySwap has earned).
  equity: {
    retainedEarnings: number;
    feesCollected: number;
    treasuryProfit: number;
    fxGainLoss: number;
    lpIncentiveExpense: number;
    totalEquity: number;
  };
  // The fundamental accounting identity: Assets = Liabilities + Equity.
  isBalanced: boolean;
  imbalance: number; // assets - (liabilities + equity) — should be 0
  generatedAt: number;
}

// ─── Journal Entries ───────────────────────────────────────────────────────

/** A double-entry accounting journal entry. */
export interface JournalEntry {
  entryId: string;
  eventId: string;           // the event that generated this entry
  timestamp: number;
  description: string;
  debits: JournalLine[];
  credits: JournalLine[];
  isBalanced: boolean;       // sum(debits) === sum(credits)
}

/** A single line in a journal entry (debit or credit). */
export interface JournalLine {
  account: string;           // e.g., "reserve:fiat:KE", "liability:twin_tokens:KES"
  amount: number;
  description: string;
}

// ─── Solvency ──────────────────────────────────────────────────────────────

/** Network solvency report. */
export interface SolvencyReport {
  reserveCoverage: number;       // fiatReserves / twinTokensOutstanding
  twinCoverage: number;          // totalReserves / twinTokensOutstanding
  stablecoinCoverage: number;    // stablecoinReserves / twinTokensOutstanding
  escrowCoverage: number;        // escrow / pendingSettlements
  settlementExposure: number;    // pendingSettlements / totalAssets
  lpExposure: number;            // outstandingLPAdvances / totalAssets
  countryExposure: Record<string, number>; // country → % of total reserves
  networkSolvent: boolean;       // twinCoverage >= 1.0 && reserveCoverage >= min
  solvencyRatio: number;         // totalAssets / totalLiabilities
  generatedAt: number;
}

// ─── Proof of Reserves ─────────────────────────────────────────────────────

/** Proof that reserves exist and are sufficient. */
export interface ProofOfReserves {
  fiatReserves: Record<string, number>;   // currency → amount
  stablecoinReserves: Record<string, number>;
  totalFiat: number;
  totalStablecoins: number;
  totalReserves: number;
  generatedAt: number;
}

/** Proof that twin tokens are fully backed. */
export interface ProofOfTwinTokens {
  twinTokenSupply: Record<string, number>;  // currency → amount
  totalSupply: number;
  backedByFiat: number;
  backedByStablecoins: number;
  totalBacking: number;
  backingRatio: number;                     // totalBacking / totalSupply (≥ 1.0)
  isFullyBacked: boolean;
  generatedAt: number;
}

// ─── LP Capital Ledger ─────────────────────────────────────────────────────

/** Per-LP capital ledger. */
export interface LPCapitalLedger {
  lpId: string;
  capitalDeposited: number;
  bandwidth: number;
  escrow: number;
  feesEarned: number;
  slashed: number;
  currentExposure: number;
  netPosition: number;           // capitalDeposited + feesEarned - slashed - currentExposure
}

// ─── Corridor Ledger ───────────────────────────────────────────────────────

/** Per-corridor balance sheet. */
export interface CorridorLedger {
  fromCountry: string;
  toCountry: string;
  currency: string;
  volume: number;
  liquidity: number;
  profit: number;
  reserveUtilization: number;
  settlementDelay: number;
  failureRate: number;
  capitalEfficiency: number;
}

// ─── Treasury Ledger ───────────────────────────────────────────────────────

/** Treasury's own balance sheet. */
export interface TreasuryLedger {
  // What we own.
  totalAssets: number;
  fiatReserves: number;
  stablecoinReserves: number;
  escrow: number;
  // What belongs to others.
  customerFunds: number;         // twin tokens outstanding
  lpFunds: number;              // LP advances + rewards
  lockedFunds: number;          // escrow + pending settlements
  freeFunds: number;            // available for operations
  yieldingFunds: number;        // deployed in LP/marketplace
  // What we've earned.
  netProfit: number;
  generatedAt: number;
}

// ─── Regulator Export ──────────────────────────────────────────────────────

/** Complete regulator-ready export. */
export interface RegulatorExport {
  balanceSheet: BalanceSheet;
  solvencyReport: SolvencyReport;
  proofOfReserves: ProofOfReserves;
  proofOfTwinTokens: ProofOfTwinTokens;
  treasuryLedger: TreasuryLedger;
  lpLedgers: LPCapitalLedger[];
  corridorLedgers: CorridorLedger[];
  journalEntries: JournalEntry[];
  generatedAt: number;
}

// ─── Economic Ledger Inputs ────────────────────────────────────────────────

/** Inputs from the runtime (read-only). */
export interface EconomicLedgerInputs {
  getTreasuryAccounts: () => Array<{
    id: string; kind: string; currency: string;
    availableBalance: number; reservedBalance: number; reference: string | null;
  }>;
  getTwinTokenPositions: () => Array<{
    accountId: string; tokenType: string; currency: string; balance: number;
  }>;
  getBandwidthPositions: () => Array<{
    owner: string; country: string; capacity: number;
    available: number; escrow: number; bond: number; used: number;
  }>;
  getSettlementContracts: () => Array<{
    contractId: string; amount: number; currency: string;
    status: string; escrowLocked: boolean;
  }>;
  getEventCount: () => number;
}
