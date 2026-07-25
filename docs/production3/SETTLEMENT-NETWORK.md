# PaySwap PRODUCTION-3 — Settlement Network

> **How money moves end-to-end**: payments, payouts, reconciliation, and the
> Stellar operations that anchor them.

## 1. The payment flow

A payment is the conversion of inbound fiat (a customer paying a merchant) into
Twin Tokens that the merchant can later redeem. The full lifecycle is:

```
(1) intent         (2) route              (3) escrow           (4) settle           (5) confirm         (6) release
   │                  │                      │                    │                    │                   │
   ▼                  ▼                      ▼                    ▼                    ▼                   ▼
 merchant      liquidity-network       settlement/escrow     twin-token engine    stellar adapter     twin-token engine
 creates a     finds a route           freezes the           burns TWINGHS        verifies the        credits the LP
 payment       through LPs             merchant's TWINGHS    from the merchant    burn tx on-chain    with the released
 intent        (cheapest first)        + escrows against     + releases escrow    + emits Evidence    TWINGHS (or fiat
               the settlement id       to the LP             with source=         equivalent)
                                                              on_chain_state
```

### Ledger entries at each step

| Step             | Journal entry                                                                                     | Description |
| ---------------- | ------------------------------------------------------------------------------------------------- | ----------- |
| (1) intent       | (no entry — intent is a request, not a movement)                                                  | Recorded as `payout.requested` event only |
| (2) route        | (no entry — quote is a calculation)                                                               | Emits `liquidity.route_executed` |
| (3) escrow       | DR `twintoken:escrowed:TWINGHS` 100<br/>CR `twintoken:circulating:TWINGHS` 100                    | Locks 100 TWINGHS for settlement |
| (4) settle       | DR `twin:backing:GHS` 100<br/>CR `twintoken:circulating:TWINGHS` 100                              | Burn reverses the backing liability |
| (5) confirm      | (no ledger entry — confirmation is on-chain verification)                                         | Emits Evidence with `txHash` + `ledger` |
| (6) release      | DR `twintoken:circulating:TWINGHS` 100<br/>CR `twintoken:escrowed:TWINGHS` 100                    | Releases the escrowed tokens to the LP |

(For the full event → journal mapping, see `src/protocol/ledger/projection.ts`.)

### Key invariant: backing reconciliation

After every settlement, the ledger must satisfy:

```
twintoken:circulating:TWINGHS  +  twintoken:escrowed:TWINGHS  ==  twin:backing:GHS
```

`reconcileTwinTokenBacking()` in `src/protocol/reconciliation.ts` verifies this
invariant for every Twin Token asset and reports any discrepancy as a
`backing_mismatch` alert.

## 2. The payout flow

A payout is the conversion of a merchant's accumulated Twin Token balance back
into fiat (or on-chain tokens) delivered to the merchant's bank account,
mobile-money wallet, or external wallet.

```
(1) request         (2) quote                 (3) process             (4) burn / transfer       (5) evidence
   │                   │                          │                       │                          │
   ▼                   ▼                          ▼                       ▼                          ▼
 merchant         payout-service             payout-service           twin-token engine         stellar adapter
 requests a       quotes FX rate + fee       calls the appropriate    burns TWINGHS (fiat)      returns Evidence
 payout           via the FX connector       connector                OR transfers (onchain)    with source=on_chain_state
                                           (open-banking / mpesa)
```

### Ledger entries for a bank payout of 200 TWINGHS (gross), 199 net, 1 fee

| Account                                | Debit | Credit | Description |
| -------------------------------------- | ----: | -----: | ----------- |
| `merchant:payable:m1`                  | 200   |        | Debit the merchant's payable |
| `cash:bank:GHS`                        |       | 199    | Credit the bank cash out |
| `revenue:fees:bank`                    |       | 1      | Credit fee revenue |

### Methods + fee schedule

| Method          | Fee (bps) | ETA         | Connector |
| --------------- | --------: | ----------- | --------- |
| `bank`          | 50        | T+1 (24h)   | Open Banking (PSD2) |
| `mobile_money`  | 75        | ~1 minute   | M-Pesa (Daraja) |
| `onchain`       | 10        | ~5 seconds  | Stellar Horizon (transfer) |

### Evidence chain

Every payout produces an `Evidence` object whose payload includes the
connector's signed attestation. For a bank payout the source is
`open_banking` with `verificationLevel=institutional`. For an on-chain payout
the source is `on_chain_state` with `verificationLevel=cryptographic`. The
evidence is stored on the `Payout` record and is queryable via the merchant
dashboard.

## 3. Reconciliation — daily report walkthrough

`dailyReconciliation()` in `src/protocol/ledger/reconciliation.ts` runs every
sub-reconciliation and produces a `DailyReconciliationReport`:

```typescript
{
  asOfTs,
  reconciled: boolean,        // true iff every sub-check passed
  trialBalance: { balanced, totalDebits, totalCredits, discrepancy },
  twinTokenBacking: { reconciled, assets: [...] },
  escrow: { reconciled, entries: [...], ledgerTotalEscrowed, moduleTotalEscrowed, totalDiscrepancy },
  payouts: { reconciled, payouts: [...], totalCompletedSource, totalFees, ledgerFeeRevenue },
  treasury: { reconciled, ledgerTreasury, bondSum, feeRevenue, expectedTreasury, discrepancy },
  merchants: [...],
  lps: [...],
  failedCount,
  durationMs,
}
```

### Reading the report

1. **`trialBalance.balanced`** — the universal invariant. If false, the ledger
   is corrupted; do not trust any other number until it's true.
2. **`twinTokenBacking.reconciled`** — circulating + escrowed must equal
   backing. If false, a mint or burn was recorded without updating the reserve
   (or vice versa).
3. **`payouts.reconciled`** — every completed payout must have a matching
   journal entry with the right gross/net/fee amounts.
4. **`treasury.reconciled`** — `equity:treasury` must equal the sum of merchant
   bonds; combined with fee revenue, must equal bond sum + fee revenue.
5. **`failedCount`** — number of sub-reconciliations that failed. Should be 0
   on a healthy system.

### How to run it

```typescript
import { ledgerEngine, dailyReconciliation } from '@/protocol/ledger';
import { twinTokenEngine } from '@/protocol/twin-token/engine';
import { payoutService } from '@/protocol/payouts/payout-service';
import { merchantPlatform } from '@/protocol/merchant/platform';
import { lpLifecycle } from '@/protocol/lp-lifecycle-manager';
import { escrowModule } from '@/protocol/settlement/escrow';
import { collateralVault } from '@/protocol/settlement/collateral-vault';

const report = dailyReconciliation({
  ledger: ledgerEngine,
  twinTokenEngine,
  escrowModule,
  collateralVault,
  payoutService,
  merchantPlatform,
  lpLifecycle,
});
console.log(report.reconciled ? 'OK' : 'DISCREPANCY');
```

In production this runs as a cron job at 02:00 UTC every day. The result is
written to the audit log + an alert is raised if `failedCount > 0`.

## 4. Stellar operations

The Stellar adapter (`src/protocol/chains/stellar/adapter.ts`) is the
production-grade implementation of the `ChainAdapter` interface. It runs
against an in-process simulated Stellar network that mirrors Horizon's
behavior — accounts, assets, trustlines, transactions, claimable balances,
escrow accounts, AMM pools, and ledger close events.

### Trustlines

A Stellar trustline is required before an account can hold a non-native asset.
The adapter enforces this:

```typescript
await adapter.createTrustline({ holder, assetCode: 'USDC', issuer });
// holder can now receive USDC
await adapter.issueAsset({ assetCode: 'USDC', issuer, amount: 100, to: holder });
```

**Issuer exemption**: the issuer of an asset is exempt from the trustline
requirement for its own asset (matches real Stellar — the issuer implicitly
holds unlimited own asset).

### Path payments

Path payments route through the Stellar DEX (automated market makers). The
adapter simulates a constant-product AMM (`x * y = k`) with a 30 bps fee:

```typescript
const result = await adapter.pathPayment({
  sendAsset: makeAsset('TWINGHS', issuer),
  sendMax: 1000,
  destAsset: nativeAsset(),
  destAmount: 990,
  from: sender, to: recipient,
});
// result.receivedAmount = 996.5 (after 30 bps AMM fee on 1000)
```

### Claimable balances

Claimable balances let a sender pre-fund a payment that the recipient can
claim later. The predicate can be `unconditional`, `before(time)`,
`after(time)`, `and`, `or`, `not` — the full Stellar `ClaimPredicate` union.

```typescript
const cb = await adapter.createClaimableBalance({
  asset: nativeAsset(), amount: 25, from: sender, claimant: recipient,
  predicate: { kind: 'before', time: Date.now() + 60_000 }, // claimable for 60s
});
// ... later ...
const claim = await adapter.claimBalance({ balanceId: cb.balanceId!, claimant: recipient });
```

### Escrow accounts

Escrow accounts are 2-of-2 multisig time-locked accounts. The adapter creates
the escrow account, funds it with the base reserve + trustline reserve from
the sender, credits the escrowed asset, and configures the signers + thresholds.

```typescript
const esc = await adapter.createEscrowAccount({
  asset: makeAsset('TWINGHS', issuer), amount: 500,
  from: sender, signer1: sender, signer2: recipient,
  unlockTime: Date.now() + 86_400_000, // 24h
});
// ... after unlockTime ...
await adapter.releaseEscrow({ escrowAddress: esc.escrowAddress!, to: recipient });
```

### Sponsored reserves

Stellar's sponsored reserves let one account pay the base reserve for another.
Useful for creating wallet accounts without the recipient needing to hold XLM:

```typescript
await adapter.sponsorReserve({ sponsor: treasuryAccount, sponsored: newUser, reserveAmount: 1 });
```

### Fee bump

A sponsor can fee-bump an inner transaction to give it higher priority (or to
pay the fee on behalf of the user):

```typescript
await adapter.feeBumpTransaction({ innerTxHash: tx, sponsor: sponsorAccount, fee: 1000 });
```

### Multi-sig

The adapter supports `addSigner`, `removeSigner`, `setThresholds` for full
Stellar-style multisig. Adding a signer consumes a reserve entry (just like
real Stellar).

### Ledger streaming

```typescript
const unsubscribe = adapter.streamLedgers((ledger) => {
  console.log('ledger closed', ledger.ledger, 'txs=', ledger.txCount);
});
// later:
unsubscribe();
```

The stream mirrors Horizon's SSE ledger stream contract — the callback receives
a `LedgerResult` per close. `submitTransaction` auto-closes the ledger (real
Stellar closes every 5-7s).

## 5. End-to-end worked example

> A merchant in Ghana receives a 100 GHS payment from a customer. The
> settlement uses LP `Acacia` (Kenya) to deliver KES to the customer's M-Pesa
> wallet. The merchant later requests a bank payout of 200 TWINGHS.

### Step-by-step ledger entries

```
T=0s   Customer pays 100 GHS via M-Pesa (inbound fiat)
         DR cash:mmo:GHS 100  CR user:wallet:customer_wallet 100

T=1s   Payment intent created + routed to LP Acacia (GHS→KES corridor)
         DR twintoken:escrowed:TWINGHS 100  CR twintoken:circulating:TWINGHS 100

T=2s   Settlement: LP Acacia delivers KES to customer; merchant's TWINGHS burned
         DR twin:backing:GHS 100  CR twintoken:circulating:TWINGHS 100

T=3s   Escrow released to LP
         DR twintoken:circulating:TWINGHS 100  CR twintoken:escrowed:TWINGHS 100

T=1d   Merchant requests bank payout of 200 TWINGHS (gross), 199 net, 1 fee
         DR merchant:payable:m_ghana 200  CR cash:bank:GHS 199  CR revenue:fees:bank 1
```

After all five steps, the trial balance sums to zero per currency, the
treasury's `equity:treasury` reflects accumulated bond + fee revenue, and
every ledger entry cites the Evidence that produced it (via `evidenceId`).

## 6. Connectors + settlement

The settlement orchestrator (`src/protocol/payments/settlement-orchestrator.ts`)
calls into the appropriate production connector based on the payout method:

- **Bank payout** → `OpenBankingConnector.initiateTransfer` (PSD2 shape)
- **Mobile-money payout** → `MpesaConnector.sendB2C` (Daraja B2C)
- **On-chain payout** → `StellarHorizonConnector.submitTransaction` → adapter's
  `transfer` operation

Every connector response carries signed Evidence (HMAC-SHA256 over the
canonical payload). The settlement orchestrator attaches the evidence to the
`Payout` record so the merchant dashboard can display it.

## 7. Recovery from partial settlement

When a payment is settled across MULTIPLE LPs and some LPs settle while others
fail, the payment is left in a PARTIAL state. The
`PartialSettlementRecovery` engine (in `src/protocol/resilience/`) records the
state and attempts recovery:

1. **`retry_remaining`** — re-route the remaining amount through OTHER LPs via
   the liquidity network.
2. **`reverse_all`** — if no alternate LPs available, reverse the settled
   portion (full refund) so the payment ends in a consistent state.
3. **`manual_review`** — if both retry and reverse fail, flag for human
   intervention.

**Invariant**: a partial settlement is either RECOVERED or FULLY REVERSED —
never left half-done.

See `OPERATIONS.md` for the runbook procedure when a partial settlement is
flagged for manual review.
