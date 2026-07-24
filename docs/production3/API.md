# PaySwap Protocol API Reference (PRODUCTION-3)

> All APIs are protocol-layer. The kernel is frozen. Every module below lives in `src/protocol/`.

## Module Index

| Module | Path | Priority |
|--------|------|----------|
| Chain Abstraction Layer | `protocol/chains/` | P1 |
| Double-Entry Ledger | `protocol/ledger/` | P2 |
| Production Connectors | `protocol/connectors-v2/` | P5 |
| Liquidity Network | `protocol/liquidity-network/` | P3 |
| Treasury Operations | `protocol/treasury-v2/` | P4 |
| Operational Readiness | `protocol/ops/` | P6 |
| Security | `protocol/security/` | P7 |
| Disaster Recovery | `protocol/resilience/` | P9 |
| Payouts | `protocol/payouts/` | (PRODUCTION-2) |
| Merchant Platform | `protocol/merchant/` | (PRODUCTION-1) |
| Twin Token | `protocol/twin-token/` | (PRODUCTION-1) |
| Wallets | `protocol/wallets/` | (PRODUCTION-1) |
| Webhooks | `protocol/webhooks/` | (PRODUCTION-1) |

---

## 1. Chain Abstraction Layer (`protocol/chains/`)

### Interface — `ChainAdapter`
Every blockchain implements this. Stellar is the first production implementation; Ethereum/Base/Polygon are interface-complete stubs.

```typescript
interface ChainAdapter {
  chain: string;
  isInitialized: boolean;
  // Account lifecycle
  createAccount(params: { address: string; publicKey?: string; startingBalance: number }): Promise<ChainResult>;
  fundAccount(address: string, nativeAmount: number): Promise<ChainResult>;
  // Asset lifecycle
  registerAsset(params: { code: string; issuer: string; metadata?: Record<string, unknown> }): Promise<ChainResult>;
  issueAsset(params: { assetCode: string; amount: number; issuer: string; to: string }): Promise<ChainResult>;
  burnAsset(params: { assetCode: string; amount: number; from: string }): Promise<ChainResult>;
  // Trustlines
  createTrustline(params: { holder: string; assetCode: string; issuer: string }): Promise<ChainResult>;
  // Transfers
  transfer(params: { assetCode: string; amount: number; from: string; to: string; memo?: ChainMemo }): Promise<ChainResult>;
  pathPayment(params: { sendAsset: string; sendAmount: number; destAsset: string; destMin: number; from: string; to: string }): Promise<ChainResult>;
  // Claimable balances
  createClaimableBalance(params: { assetCode: string; amount: number; source: string; claimant: string; predicate: ClaimPredicate }): Promise<ChainResult>;
  claimBalance(params: { balanceId: string; claimant: string }): Promise<ChainResult>;
  getClaimableBalances(holder: string): Promise<ChainResult>;
  // Escrow
  createEscrowAccount(params: { assetCode: string; amount: number; from: string; escrowId: string; releaseTo: string; unlockAt?: number }): Promise<ChainResult>;
  releaseEscrow(params: { escrowId: string; assetCode: string; amount: number; to: string }): Promise<ChainResult>;
  // Sponsored reserves
  sponsorReserve(params: { sponsor: string; sponsored: string; amount: number }): Promise<ChainResult>;
  // Fee bump
  feeBumpTransaction(params: { txHash: string; feeSource: string; baseFee: number }): Promise<ChainResult>;
  // Multi-signature
  addSigner(params: { account: string; signer: string; weight: number }): Promise<ChainResult>;
  removeSigner(params: { account: string; signer: string }): Promise<ChainResult>;
  setThresholds(params: { account: string; low: number; medium: number; high: number }): Promise<ChainResult>;
  // Verification
  verifyTransaction(txHash: string): Promise<ChainResult>;
  getTransaction(txHash: string): Promise<ChainResult>;
  // Ledger sync
  getLatestLedger(): Promise<ChainResult>;
  streamLedgers(callback: (ledger: number) => void): () => void;  // returns unsubscribe
  getLedgerEntry(key: string): Promise<ChainResult>;
  // Sequence
  getSequence(address: string): Promise<ChainResult>;
  incrementSequence(address: string): Promise<ChainResult>;
  // Balance
  getBalance(params: { address: string; assetCode: string }): Promise<ChainResult>;
  getBalances(address: string): Promise<ChainResult>;
  // Health
  healthCheck(): Promise<{ healthy: boolean; latencyMs: number }>;
}
```

### Registry
```typescript
import { chainRegistry, stellarChainAdapter } from '@/protocol/chains';
chainRegistry.register(stellarChainAdapter);
chainRegistry.get('stellar');     // → StellarAdapter
chainRegistry.default();          // → StellarAdapter
chainRegistry.healthReport();     // → per-chain health
```

### Settlement helpers (`protocol/chains/stellar/settlement.ts`)
```typescript
settleTwinTokenTransfer({ from, to, assetCode, amount, memo }): Promise<{ success; evidence; txHash }>;
settleTwinTokenBurn({ from, assetCode, amount }): Promise<...>;
settleTwinTokenMint({ to, assetCode, amount, issuer }): Promise<...>;
settleWithClaimableBalance({ from, assetCode, amount, claimant, predicate }): Promise<...>;
verifySettlement(txHash): Promise<{ confirmed; evidence }>;
```

---

## 2. Double-Entry Ledger (`protocol/ledger/`)

```typescript
import { ledgerEngine, snapshotStore, rebuildLedgerFromEvents, reconcileTwinTokenBacking, dailyReconciliation, generateDailyTreasuryReport } from '@/protocol/ledger';

// Post a balanced journal entry
const entry = createJournalEntry({
  txId: 'tx_1',
  description: 'Mint 1000 TWINGHS',
  entries: [
    { accountCode: 'twintoken:circulating:TWINGHS', debit: 1000, credit: 0, currency: 'GHS', memo: 'mint' },
    { accountCode: 'twin:backing:GHS', debit: 0, credit: 1000, currency: 'GHS', memo: 'mint' },
  ],
});
ledgerEngine.post(entry);

// Query
ledgerEngine.getAccountBalance('twintoken:circulating:TWINGHS');  // → 1000
ledgerEngine.getTrialBalance();      // → { totalDebits: 1000, totalCredits: 1000, balanced: true }
ledgerEngine.getBalanceSheet();      // → { assets, liabilities, equity, balanced: true }
ledgerEngine.verifyIntegrity();      // → { balanced: true, discrepancy: 0 }

// Rebuild from events (deterministic)
const events = eventEngine.read();
const rebuilt = rebuildLedgerFromEvents(events);
rebuilt.verifyIntegrity();           // → balanced: true

// Reconciliation
reconcileTwinTokenBacking(ledgerEngine, twinTokenEngine);
// → { reconciled: true, assets: [{ code: 'TWINGHS', circulating: 1000, escrowed: 0, backingLiability: 1000, discrepancy: 0 }] }

dailyReconciliation(Date.now(), { twinTokenEngine, ledgerEngine, payoutService, ... });
```

---

## 3. Production Connectors (`protocol/connectors-v2/`)

```typescript
import { productionConnectorRegistry } from '@/protocol/connectors-v2';

const res = await productionConnectorRegistry.query('open_banking', {
  id: 'req_1',            // idempotency key
  operation: 'getBalance',
  params: { accountId: 'GH000123', currency: 'GHS' },
});
// → { success: true, evidence: Evidence, data: { balance: 50000 }, latencyMs: 12, attempts: 1 }

productionConnectorRegistry.healthReport();   // → per-connector health
productionConnectorRegistry.metricsReport();  // → per-connector metrics (p50/p99)
productionConnectorRegistry.auditReport({ connectorId: 'open_banking', limit: 100 });
```

Every connector inherits: idempotency caching, token-bucket rate limiting, exponential-backoff retry, HMAC-signed evidence, health tracking, metrics, and audit logging.

---

## 4. Liquidity Network (`protocol/liquidity-network/`)

```typescript
import { liquidityNetwork } from '@/protocol/liquidity-network';

liquidityNetwork.registerLP({
  id: 'lp_1', name: 'Acacia LP', country: 'Kenya',
  corridors: [{ fromCurrency: 'GHS', toCurrency: 'KES' }],
  capacity: { 'GHS→KES': 200000 }, reputation: 0.85, tier: 'trusted',
  feeBps: 80, settlementSpeedMs: 50000,
});

const plan = liquidityNetwork.getQuote({ fromCurrency: 'GHS', toCurrency: 'KES' }, 50000);
// → { id, corridor, amount, route: [{ lpId, share, amount, feeBps }], totalFeeBps, confidence, ... }

const reservations = liquidityNetwork.executeRoute(plan, 'res_1');
liquidityNetwork.settleRoute(plan, 'res_1', [{ lpId: 'lp_1', success: true, latencyMs: 48000 }]);

liquidityNetwork.networkStatus();
// → { totalLPs, activeLPs, capacityByCorridor, avgScore, shortfalls }
```

---

## 5. Treasury Operations (`protocol/treasury-v2/`)

```typescript
import { treasuryEngine, reserveMonitor, mintLimitEngine, backingVerifier, emergencyFreezeEngine, alertEngine } from '@/protocol/treasury-v2';

// Pre-mint hook (called by twin-token engine before minting)
const { allowed, reason } = treasuryEngine.preMintHook('TWINGHS', 5000);
if (!allowed) throw new Error(reason);

// Emergency freeze
emergencyFreezeEngine.freezeAsset('TWINGHS', 'Compliance investigation', 'treasury_admin');
// → all mint/burn/transfer for TWINGHS now blocked

// Daily report
const report = treasuryEngine.dailyReport();
// → { reserves, backingVerified, mintUsage, burnUsage, alerts, yields, capitalEfficiency, corridors, frozenAssets }
```

---

## 6. Operational Readiness (`protocol/ops/`)

```typescript
import { metricsRegistry, logger, withCorrelation, withSpan, alertManager, sloManager, systemOverview } from '@/protocol/ops';

// Metrics (Prometheus text format)
metricsRegistry.expose();  // → string for /api/metrics

// Correlation + tracing
await withCorrelation({ traceId: newTraceId(), spanId: newSpanId() }, async () => {
  logger.info('payment received', { paymentId: 'pay_1' });
  await withSpan('payment.settle', async () => { /* ... */ });
});

// Alerts + SLOs
alertManager.active();     // → active alerts
sloManager.evaluate(metricsRegistry);  // → SLO status with error budgets

// Dashboards
systemOverview();          // → { kpis, alerts, slos }
```

---

## 7. Security (`protocol/security/`)

```typescript
import { authService, jwtService, secretsVault, auditLog, rateLimiterRegistry } from '@/protocol/security';

// Authenticate
const ctx = authService.requireAuth(request);  // throws 401 if invalid
authService.authorize(ctx, 'payout:approve');   // throws 403 if denied (audit-logged)

// JWT
const token = jwtService.sign({ sub: 'user_1', scope: ['payments:write'], role: 'admin' });
const { valid, payload } = jwtService.verify(token);

// Secrets
secretsVault.set('stripe_key', 'sk_live_xxx');
secretsVault.get('stripe_key');  // → 'sk_live_xxx'

// Rate limiting
const { allowed, remaining, resetAt } = rateLimiterRegistry.get('api:per_key').consume('psk_live_1');
```

---

## 8. Disaster Recovery (`protocol/resilience/`)

```typescript
import { circuitBreakerRegistry, dedupStore, deadLetterQueue, eventReplayEngine, recoveryEngine, healthCheck } from '@/protocol/resilience';

// Circuit breaker
circuitBreakerRegistry.stateOf('open_banking');  // → 'closed' | 'open' | 'half_open'
await circuitBreakerRegistry.execute('open_banking', () => connector.query(...));

// Dedup (idempotency)
const result = await dedupStore.checkOrMark('pay:hash_abc', () => processPayment(), 86400000);

// Dead-letter queue
deadLetterQueue.list({ queue: 'webhook' });
await deadLetterQueue.replay('dlq_1');

// Event replay (deterministic rebuild)
const { deterministic } = eventReplayEngine.verifyReplayDeterminism(events);
await recoveryEngine.executeRebuildFromEvents();

// Health
healthCheck();  // → { overall: 'healthy', components: [...], outages: [], circuits: [...] }
```

---

## HTTP API Endpoints (added in integration step)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/ops/overview` | System overview (KPIs, alerts, SLOs) |
| GET | `/api/ops/metrics` | Prometheus text format |
| GET | `/api/ops/health` | Health check (k8s probe) |
| GET | `/api/ops/dashboards/connectors` | Connector dashboard |
| GET | `/api/ops/dashboards/settlement` | Settlement dashboard |
| GET | `/api/ops/dashboards/lp` | LP dashboard |
| GET | `/api/ops/dashboards/treasury` | Treasury dashboard |
| GET | `/api/ledger/trial-balance` | Trial balance |
| GET | `/api/ledger/balance-sheet` | Balance sheet |
| GET | `/api/ledger/reconciliation` | Daily reconciliation report |
| GET | `/api/treasury/status` | Treasury status |
| POST | `/api/treasury/freeze` | Emergency freeze (admin) |
| GET | `/api/resilience/health` | Resilience health |
| GET | `/api/resilience/dlq` | Dead-letter queue |

All admin/treasury endpoints require JWT auth with `treasury:admin` or `admin:*` scope.
