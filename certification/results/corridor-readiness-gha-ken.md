# Corridor Readiness Certification: Ghana ↔ Kenya

> **Corridor**: GHS (Ghanaian Cedi) ↔ KES (Kenyan Shilling)
> **Status**: CONDITIONALLY READY — pilot-ready with caveats
> **Certification Date**: 2026-07-25
> **Certified by**: PaySwap Protocol Certification Suite + Economic Simulation

---

## 1. Corridor Definition

| Parameter | Value |
|-----------|-------|
| Source currency | GHS (Ghanaian Cedi) 🇬🇭 |
| Destination currency | KES (Kenyan Shilling) 🇰🇪 |
| FX rate (baseline) | 1 GHS = 10.75 KES |
| FX rate (reverse) | 1 KES = 0.093 GHS |
| Settlement asset | TWINGHS / TWINKES (Stellar Twin Tokens) |
| Settlement blockchain | Stellar (simulation mode; live-ready) |
| Typical settlement time | 5–30 seconds (on-chain) |
| Max settlement time | 60 seconds (SLA) |
| Fee structure | 50–80 bps (corridor-dependent) |

---

## 2. Participating Institutions

### Banks (Open Banking / PSD2)
| Provider | Status | Evidence |
|----------|--------|----------|
| Ghana Open Banking (PSD2) | Adapter ready | `providers/open-banking.ts` — OAuth2 + refresh token, Berlin Group NextGenPSD2 response shapes |
| Kenya Open Banking | Adapter ready | Same adapter, configured for KES |
| **GAP** | **Not contracted** | No real bank API credentials configured. Requires commercial agreements. |

### Mobile Money Operators
| Provider | Status | Evidence |
|----------|--------|----------|
| MTN MoMo (Ghana) | Adapter ready | `providers/mtn-momo.ts` — OAuth2 + Ocp-Apim-Subscription-Key, requestToPay/transfer |
| Airtel Money (Kenya) | Adapter ready | `providers/airtel-money.ts` — OAuth2, requestToPay/transfer |
| M-Pesa (Kenya) | Adapter ready | `connectors-v2/mpesa.ts` — Daraja API shapes (STK push, B2C) |
| **GAP** | **Not contracted** | No real M-Pesa/MTN API keys configured. Requires commercial agreements. |

### FX Provider
| Provider | Status | Evidence |
|----------|--------|----------|
| Exchange Rate Connector | Ready | `connectors-v2/fx-rate.ts` — GHS/KES=10.75, 30s TTL evidence |
| **GAP** | **Simulated rates** | Real production requires a live FX feed (Refinitiv, Bloomberg, or treasury mid-rate). |

### Liquidity Providers
| LP | Tier | Capacity (GHS→KES) | Capacity (KES→GHS) | Status |
|----|------|---------------------|---------------------|--------|
| LP-1 (Acacia) | Trusted | 200,000 GHS | 150,000 KES | Simulated |
| LP-2 (Sahara) | Trusted | 150,000 GHS | 100,000 KES | Simulated |
| LP-3 (Highland) | Premium | 300,000 GHS | 200,000 KES | Simulated |
| **GAP** | | | | **No real LPs onboarded. Requires capital + KYB.** |

---

## 3. Settlement Timing

| Step | Simulated | Production Target |
|------|-----------|-------------------|
| Payment intent creation | <100ms | <100ms |
| Route planning (LP selection) | <50ms | <50ms |
| Escrow freeze (Twin Token lock) | <500ms | <2s (Stellar ledger close) |
| LP settlement (fiat leg) | 5–30s (simulated) | 5–60s (real connector) |
| Evidence verification | <100ms | <100ms |
| Escrow release (Twin Token transfer) | <500ms | <2s (Stellar ledger close) |
| Webhook delivery | <1s | <1s |
| **End-to-end** | **6–32s** | **10–65s** |

**SLA**: 99% of payments settle in <60s. Verified by economic simulation (baseline p99 = 11.7s).

---

## 4. Compliance Requirements

### Ghana (Bank of Ghana)
| Requirement | Status | Evidence |
|-------------|--------|----------|
| AML monitoring | ✅ Implemented | `compliance/aml.ts` — structuring, velocity, corridor risk |
| KYC (individual) | ✅ Implemented | `compliance/kyc.ts` — 4 levels, document verification |
| KYB (business) | ✅ Implemented | `compliance/kyb.ts` — UBO cross-reference |
| Sanctions screening | ✅ Implemented | `compliance/sanctions.ts` — OFAC/EU/UN/UK HMT |
| PEP screening | ✅ Implemented | `compliance/pep.ts` |
| Travel Rule | ✅ Implemented | `compliance/travel-rule.ts` — FATF Rec. 16, $1k threshold |
| Risk scoring | ✅ Implemented | `compliance/risk-scoring.ts` — 7-factor composite |
| SAR generation | ✅ Implemented | `compliance/sar.ts` — draft → file → acknowledge |
| **GAP: Money transfer license** | ❌ Not obtained | Requires Bank of Ghana approval |
| **GAP: Data protection (DPA)** | ❌ Not registered | Requires Ghana DPC registration |

### Kenya (Central Bank of Kenya)
| Requirement | Status | Evidence |
|-------------|--------|----------|
| AML monitoring | ✅ Implemented | Same as above |
| KYC/KYB | ✅ Implemented | Same as above |
| Sanctions/PEP | ✅ Implemented | Same as above |
| **GAP: Money remittance license** | ❌ Not obtained | Requires CBK approval |
| **GAP: PSSA registration** | ❌ Not obtained | Payment Service Provider registration |

---

## 5. Operational Runbook

### Normal Operation
1. **Monitoring**: `/api/ops/overview` shows KPIs, alerts, SLOs
2. **Health**: `/api/resilience/health` shows circuit breaker states
3. **Trial balance**: `/api/ledger/trial-balance` — must always be balanced
4. **Reconciliation**: `/api/ledger/reconciliation` — daily run

### Failure Scenarios

#### Scenario 1: LP Default (largest LP goes offline)
- **Detection**: Circuit breaker opens for the LP's corridor
- **Impact**: ~40% capacity loss (per economic simulation S1)
- **Recovery**: Other LPs absorb load; settlement latency increases from 11s to 19s p99
- **Action**: Page treasury ops; consider emergency liquidity facility

#### Scenario 2: Liquidity Shortage (demand > capacity)
- **Detection**: LP capacity utilization > 90%; shortfall alerts fire
- **Impact**: Only 29% of payments can settle (per economic simulation S2)
- **Recovery**: Queue excess payments; alert LPs to add capacity
- **Action**: Activate emergency liquidity facility; notify affected merchants

#### Scenario 3: Connector Outage (M-Pesa down)
- **Detection**: Circuit breaker opens for `mpesa` connector
- **Impact**: KES-side payouts delayed
- **Recovery**: Circuit breaker auto-transitions to half-open after 30s cooldown
- **Action**: Switch to alternate mobile money (Airtel); notify affected users

#### Scenario 4: Treasury Reserve Shortfall
- **Detection**: Reserve ratio drops below 1.0; `treasury.backing_mismatch` alert fires
- **Impact**: All mints blocked by `preMintHook` (per economic simulation S4)
- **Recovery**: Replenish reserves; alerts auto-resolve when ratio restored
- **Action**: Page treasury admin; fund reserves immediately

---

## 6. Merchant Onboarding Flow

```
1. Merchant registers via /api/merchant/onboard (action=onboard)
   → State: pending, Tier: unverified

2. Merchant completes KYC/KYB
   → compliance/kyc.ts: submit documents (ID + address proof)
   → compliance/kyb.ts: verify business registration + UBOs
   → compliance/sanctions.ts: screen against OFAC/EU/UN/UK
   → compliance/pep.ts: screen for politically exposed persons

3. Merchant posts bond (5,000 GHS for trusted tier)
   → /api/merchant/onboard (action=verify, bond=5000)
   → State: active, Tier: trusted

4. Merchant generates API key
   → /api/merchant/onboard (action=create_api_key)
   → Returns psk_live_xxx with scopes

5. Merchant sets up webhook endpoint
   → /api/merchant/onboard (action=setup_webhook)
   → Returns HMAC secret

6. Merchant creates products / payment links / QR codes
   → Ready to accept payments
```

---

## 7. Support Procedures

| Issue | First Response | Escalation |
|-------|---------------|------------|
| Payment not settling | Check `/api/ops/health` + circuit breakers | If LP circuit open → treasury ops |
| Payout failed | Check payout `reason` field + evidence | If compliance block → compliance team |
| Webhook not received | Check `/api/merchant/state` webhook deliveries | If DLQ entry → replay from DLQ |
| Balance discrepancy | Run `/api/ledger/reconciliation` | If mismatch → engineering (P1) |
| Merchant can't onboard | Check KYC/KYB status | If sanctions hit → compliance review |

---

## 8. Corridor Certification Verdict

| Criterion | Status | Evidence |
|-----------|--------|----------|
| Technical infrastructure | ✅ Ready | Certification suite 17/17 PASSED |
| Connector adapters | ✅ Ready | 13 provider adapters implemented |
| Compliance framework | ✅ Ready | AML/KYC/KYB/sanctions/PEP/travel rule |
| Treasury operations | ✅ Ready | Reserves, limits, backing, stress tests |
| Economic sustainability | ✅ Acceptable | 5/8 scenarios PASS, 3 DEGRADED (capacity) |
| Security | ⚠️ Remediation needed | 13 vulnerabilities found (1 critical, 7 high) |
| Real bank partnerships | ❌ Not contracted | No real API credentials |
| Real LP onboarding | ❌ Not done | No real LPs with capital |
| Regulatory licensing | ❌ Not obtained | No Bank of Ghana / CBK licenses |
| Pilot readiness | ⚠️ Conditional | Ready for internal pilot; not for public launch |

### **Verdict: CONDITIONALLY READY**

The Ghana ↔ Kenya corridor is **technically ready** for an internal pilot (simulation mode) but **not ready for public launch** due to:
1. Security vulnerabilities requiring remediation (especially SEC-016, SEC-024)
2. No real bank/MMO/LP partnerships contracted
3. No regulatory licenses obtained
4. No real capital deployed

**Recommended next step**: Fix critical security issues, then run an internal pilot with simulation-mode connectors to validate the operational runbook before pursuing real partnerships and licenses.
