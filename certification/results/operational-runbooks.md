# Operational Runbooks

> **Purpose**: What operations teams will actually use to run PaySwap in production.
> **Last Updated**: 2026-07-25

---

## 1. Support Runbook

### 1.1 Merchant Reports "Payment Not Settling"

**Triage** (≤2 minutes):
1. Check `/api/ops/health` — is the system healthy?
2. Check `/api/resilience/health` — are any circuit breakers open?
3. Get the payment ID from the merchant
4. Check the payment status via the merchant's dashboard (Events tab)

**If circuit breaker is open** (e.g., `mpesa` or `open_banking`):
- This is a connector outage. See §3.1 (Connector Failure).
- Expected recovery: 30 seconds (auto half-open transition).

**If payment is stuck in `processing`**:
- Check if the LP's circuit breaker is open.
- Check treasury reserve ratio (`/api/treasury-v2/status`) — if < 1.0, mints are blocked.
- Escalate to treasury ops if reserve ratio is low.

**If payment is `failed`**:
- Check the `reason` field in the payment record.
- If compliance block → escalate to compliance team.
- If connector error → check `/api/ops/dashboards/connectors` for error rate.

### 1.2 Merchant Reports "Payout Failed"

1. Check payout status via `/api/merchant/payout (action=get, payoutId=...)`.
2. If `state=failed`, check the `reason` field:
   - `insufficient_balance` → merchant needs more Twin Tokens (seed or settle more payments first)
   - `external_transfer_failed` → connector issue, check circuit breakers
   - `insufficient_available_balance` → tokens are escrowed, wait for release
3. If `state=processing` for >5 minutes → check for stuck payouts (CERT-009).
4. Escalate to engineering if payout is stuck >10 minutes.

### 1.3 Merchant Reports "Webhook Not Received"

1. Check `/api/merchant/state` → `webhooks.deliveries` for the merchant.
2. If deliveries show `status=failed` or `retrying`:
   - The merchant's endpoint may be down. Verify the URL is reachable.
   - If the endpoint is up, use webhook replay: `/api/merchant/onboard (action=...)`.
3. If deliveries show `status=delivered` but merchant didn't process:
   - Merchant's webhook handler may have a bug. Check their logs.
   - Offer to replay specific deliveries.

---

## 2. Treasury Runbook

### 2.1 Daily Treasury Operations

**Morning Check** (09:00 local):
1. Run `/api/ledger/reconciliation` — verify all checks PASS.
2. Check `/api/treasury-v2/status` — verify:
   - Reserve ratio ≥ 1.0 for all currencies
   - No active freezes
   - No alerts
3. Review `/api/ops/dashboards/treasury` — check LP profitability, no negative PnL.
4. Check `certification/run.ts` — verify 17/17 certification checks PASS.

**Evening Close** (18:00 local):
1. Run daily reconciliation report.
2. Verify trial balance: `/api/ledger/trial-balance` — `balanced=true`.
3. Take a checkpoint: `POST /api/persistence/snapshots`.
4. Review the day's events: `/api/persistence/events?limit=100`.

### 2.2 Reserve Management

**If reserve ratio drops below 1.1** (warning):
1. Alert fires automatically (`treasury.reserve_low`).
2. Treasury admin reviews: is this expected (high volume) or unexpected (leak)?
3. If expected: replenish reserves from operational account.
4. If unexpected: halt mints, investigate, escalate to engineering.

**If reserve ratio drops below 1.0** (critical):
1. All mints are automatically blocked by `preMintHook`.
2. `treasury.backing_mismatch` alert fires.
3. **Immediate action**: Fund reserves to restore ratio > 1.0.
4. Once restored: alerts auto-resolve, mints resume.

### 2.3 Emergency Freeze

**When to freeze**:
- Suspected fraud (merchant or LP)
- Regulatory order
- Security incident

**How to freeze**:
```
POST /api/treasury/freeze
{
  "scope": "asset" | "account" | "corridor",
  "target": "TWINGHS" | "merchant:xxx" | {"from":"GHS","to":"KES"},
  "reason": "Suspected fraud — case #1234",
  "initiatedBy": "treasury_admin_id"
}
```

**How to unfreeze**:
- Use the treasury engine's `liftFreeze(freezeId)` method.
- All freezes are auditable (every freeze/lift emits an event).

---

## 3. Incident Response Runbook

### 3.1 Connector Failure

**Detection**: Circuit breaker opens (auto-detected after 5 failures in 60s).

**Response**:
1. Check `/api/resilience/health` — identify which connector is down.
2. Check if it's a provider outage (check provider status page) or our issue.
3. If provider outage: wait for recovery (circuit breaker auto-recovers in 30s).
4. If our issue: check connector logs, API credentials, network.
5. If prolonged (>5 min): switch to alternate connector (e.g., M-Pesa → Airtel).
6. Notify affected merchants via status page.

**Escalation**:
- 5 min: Notify on-call engineer.
- 15 min: Notify operations lead.
- 30 min: Declare incident, activate incident response.

### 3.2 Database Failure

**Detection**: Health check `/api/ops/health` returns unhealthy; DB queries fail.

**Response**:
1. Check DB connection: `SELECT 1`.
2. If DB is down: activate disaster recovery plan (see §6).
3. If DB is slow: check for long-running queries, lock contention.
4. If data corruption: stop all writes, activate recovery plan.

### 3.3 Security Incident

**Detection**: Security review finding exploited, anomalous activity detected.

**Response**:
1. **Contain**: Freeze affected accounts/assets via `/api/treasury/freeze`.
2. **Assess**: Check event log for scope of breach.
3. **Eradicate**: Revoke compromised API keys, rotate secrets.
4. **Recover**: Verify ledger integrity, run reconciliation.
5. **Report**: Document incident, notify regulators if required.

---

## 4. Compliance Runbook

### 4.1 AML Alert Handling

**When an AML alert fires**:
1. Review alert in compliance dashboard (alert details, severity, entity).
2. If severity = `critical` (structuring/sanctions): freeze the entity immediately.
3. Create a case: `caseService.createCase({ type: 'aml_alert', entityId, alertIds })`.
4. Investigate: review transaction history, KYC documents, risk score.
5. Decision:
   - False positive → resolve alert, document reasoning.
   - Confirmed suspicious → escalate case, file SAR within 30 days.
   - Confirmed fraud → freeze entity, file SAR, notify law enforcement.

### 4.2 Sanctions Hit Handling

**When a sanctions hit occurs**:
1. **Immediate**: Block all transactions for the entity.
2. Review: Is this a true match or false positive (fuzzy matching)?
3. If false positive: `sanctionsService.reviewHit(hitId, true)` — clears the hit.
4. If true match: freeze entity, file report, notify compliance officer.
5. Document: every sanctions hit review is auditable.

### 4.3 SAR Filing

**When to file**: Escalated AML cases with confirmed suspicious activity.

**How to file**:
1. `sarService.draftSAR(caseId, narrative)` — creates a draft SAR.
2. Compliance officer reviews + edits the narrative.
3. `sarService.fileSAR(sarId)` — files the SAR (generates regulatory reference).
4. SAR is acknowledged by the regulator → status changes to `acknowledged`.

---

## 5. Payout Recovery Runbook

### 5.1 Stuck Payout (state=processing >10 min)

1. Check if the payout's txHash exists (on-chain confirmation).
2. If txHash exists: the payout completed but the state wasn't updated. Update manually.
3. If no txHash: the burn/transfer failed. Check:
   - Twin Token balance (was it sufficient at time of processing?)
   - Connector health (was the bank/MMO connector healthy?)
4. If unrecoverable: mark payout as `failed` with reason.
5. If the burn succeeded but the fiat leg failed: the Twin Tokens are burned but the merchant didn't receive fiat. This requires manual reconciliation — credit the merchant's wallet manually + file an incident.

### 5.2 Double-Payout Prevention

- The payout state machine prevents double-processing: once `state=processing`, subsequent `process()` calls throw.
- The dedup store provides an additional layer: `dedupStore.checkOrMark(payoutId, ...)` prevents concurrent processing.
- If a double-payout is suspected: run `/api/ledger/reconciliation` — the payout reconciliation check (CERT-009) will flag it.

---

## 6. Disaster Recovery Runbook

### 6.1 Database Corruption

**Detection**: Reconciliation fails, trial balance is unbalanced, or queries return errors.

**Recovery Plan**:
1. Stop all writes to the database.
2. Declare a DR incident: `drStatusService.declareIncident('Database corruption', 'critical')`.
3. Execute recovery:
   ```
   POST /api/persistence/rebuild
   { "method": "snapshot_fast_forward" }
   ```
4. Verify recovery: run certification suite (`certification/run.ts`).
5. If certification passes: resume operations.
6. If certification fails: fall back to cold restore from latest backup.

**RPO Target**: <60 seconds (event store is continuously persisted).
**RTO Target**: <5 minutes (snapshot + replay).

### 6.2 Region Loss (primary region down)

**Detection**: Health checks fail in primary region.

**Recovery Plan**:
1. Initiate failover: `failoverService.initiateFailover('us-east-1', 'eu-west-1', 'Primary region down')`.
2. Complete failover: `failoverService.completeFailover(failoverId)`.
3. Update DNS to point to new primary.
4. Verify: run certification suite.
5. Resume operations.

### 6.3 Full Disaster (all regions down)

**Recovery Plan**:
1. Activate cold restore from backup: `restoreService.executeRecovery(planFor('full_disaster'))`.
2. Restore from latest backup: `backupService.restoreFromBackup(latestBackupId)`.
3. Replay events from event store.
4. Run full certification suite.
5. Resume operations only if all 17 checks PASS.

---

## 7. Emergency Procedures

### 7.1 Emergency Freeze (all operations)

**When**: Major security incident, regulatory order, or systemic failure.

**Action**:
```
POST /api/treasury/freeze
{ "scope": "asset", "target": "TWINGHS", "reason": "Emergency: security incident #SEC-INC-001" }

POST /api/treasury/freeze
{ "scope": "asset", "target": "TWINKES", "reason": "Emergency: security incident #SEC-INC-001" }
```

This halts ALL mint/burn/transfer for the frozen assets. Payments cannot settle. Payouts cannot process.

**Recovery**: Investigate + resolve the incident, then `liftFreeze(freezeId)` for each freeze.

### 7.2 Panic Stop (graceful shutdown)

**When**: Need to stop all new transactions gracefully.

**Action**:
1. Set feature flag: `featureFlags.set({ key: 'new_payments', enabled: false })`.
2. Wait for in-flight payments to complete (monitor `/api/ops/overview`).
3. Once queue is empty: safe to shut down.
