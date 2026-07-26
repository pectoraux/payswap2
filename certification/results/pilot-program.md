# Pilot Program Definition

> **Pilot**: Ghana ↔ Kenya corridor, simulation mode
> **Duration**: 4 weeks
> **Goal**: Validate operational readiness with controlled scope before pursuing real partnerships

---

## 1. Pilot Scope

| Parameter | Value |
|-----------|-------|
| Corridor | GHS ↔ KES (Ghana ↔ Kenya) |
| Merchants | 10 (internal + friendly beta testers) |
| LPs | 3 (simulated, with realistic capacity) |
| Banks | 2 (Ghana + Kenya, simulated Open Banking) |
| Mobile Money | 1 (M-Pesa simulated, MTN MoMo simulated) |
| Settlement mode | Simulation (Stellar sim adapter) |
| Max transaction | 10,000 GHS (≈ 107,500 KES) |
| Max daily volume | 500,000 GHS |
| Feature flags | `live_stellar=off`, `real_connectors=off`, `compliance_enforcement=on` |

---

## 2. Success Metrics

### 2.1 Technical Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| Payment success rate | ≥ 99% | `payments_total{status="completed"} / payments_total` |
| Settlement p99 latency | < 60s | `settlement_duration_ms` histogram p99 |
| Payout success rate | ≥ 99.5% | `payouts_total{status="completed"} / payouts_total` |
| Ledger balanced | 100% | Certification CERT-003 |
| Reconciliation pass | 100% | Daily reconciliation: 0 failed checks |
| Certification suite | 17/17 PASS | `certification/run.ts` daily |
| Event persistence | 100% | No events lost on restart |
| API availability | ≥ 99.9% | Uptime monitoring |

### 2.2 Business Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| Total payment volume | ≥ 2,000,000 GHS | Sum of completed payments |
| Total payout volume | ≥ 1,500,000 GHS | Sum of completed payouts |
| Active merchants | ≥ 8 of 10 | Merchants with ≥1 transaction/week |
| Merchant NPS | ≥ 7/10 | Post-pilot survey |
| Fee revenue | ≥ 15,000 GHS | 75 bps average on 2M volume |
| Refund rate | < 2% | Refunds / total transactions |

### 2.3 Compliance Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| KYC completion | 100% of merchants | All merchants verified |
| Sanctions screening | 100% of transactions | All transactions screened |
| AML alerts reviewed | 100% within 24h | Time from alert → reviewed |
| SARs filed (if needed) | Within 30 days | Regulatory requirement |

### 2.4 Operational Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| Incidents (P1) | 0 | Critical incidents |
| Incidents (P2) | ≤ 2 | High-severity incidents |
| MTTR (mean time to recovery) | < 30 min | Incident response time |
| Runbook adherence | 100% | All incidents handled per runbook |

---

## 3. Rollout Stages

### Stage 1: Internal Testing (Week 1)
- **Participants**: PaySwap team only (3 "merchants")
- **Volume**: < 10,000 GHS/day
- **Focus**: Validate the end-to-end flow, identify bugs
- **Gate to Stage 2**: Certification suite 17/17 PASS for 3 consecutive days, 0 P1 incidents

### Stage 2: Friendly Beta (Week 2)
- **Participants**: 10 merchants (internal + friendly partners)
- **Volume**: < 100,000 GHS/day
- **Focus**: Operational readiness, support procedures, merchant experience
- **Gate to Stage 3**: Success rate ≥ 99%, merchant NPS ≥ 7, 0 P1 incidents

### Stage 3: Scaled Pilot (Weeks 3-4)
- **Participants**: 10 merchants, full volume
- **Volume**: < 500,000 GHS/day
- **Focus**: Scale testing, economic sustainability, compliance workflow validation
- **Gate to Post-Pilot Review**: All success metrics met for 2 consecutive weeks

### Stage 4: Post-Pilot Review (Week 5)
- **Activity**: Comprehensive review of all metrics, incidents, feedback
- **Deliverable**: Pilot Report with go/no-go recommendation for real-partnership phase

---

## 4. Rollback Criteria

The pilot will be **immediately paused** if ANY of the following occur:

| Trigger | Action |
|---------|--------|
| Certification suite FAILS | Pause all new transactions; investigate |
| Ledger becomes unbalanced | Pause all transactions; activate DR plan |
| Security vulnerability exploited | Freeze all assets; activate incident response |
| Reserve ratio drops below 1.0 | Halt all mints; replenish reserves |
| P1 incident (data loss, corruption) | Activate DR plan; declare incident |
| Payment success rate < 95% (24h rolling) | Pause new transactions; investigate |
| Any SAR-worthy activity detected | Comply with regulatory requirements |

**Rollback procedure**:
1. Set feature flag: `featureFlags.set({ key: 'new_payments', enabled: false })`.
2. Wait for in-flight transactions to complete.
3. Run full certification suite.
4. If certification FAILS: activate disaster recovery.
5. Post-incident review within 48 hours.

---

## 5. Monitoring

### Real-time dashboards
- **System**: `/api/ops/overview` — KPIs, alerts, SLOs
- **Health**: `/api/resilience/health` — circuit breakers, components
- **Ledger**: `/api/ledger/trial-balance` — must always be balanced
- **Treasury**: `/api/treasury-v2/status` — reserves, backing, limits
- **Compliance**: `/api/compliance/status` — KYC, sanctions, AML, cases
- **DR**: `/api/dr/status` — regions, replication, RPO/RTO

### Alerts (24/7 paging)
| Alert | Severity | Response Time |
|-------|----------|---------------|
| Certification FAIL | Critical | 5 min |
| Ledger unbalanced | Critical | 5 min |
| Reserve ratio < 1.0 | Critical | 5 min |
| Circuit breaker open >5 min | High | 15 min |
| Payment success rate < 95% | High | 15 min |
| AML alert (critical) | High | 30 min |
| DR RPO violation | High | 15 min |

---

## 6. Daily Reporting

### Daily Pilot Report (automated, sent at 09:00)

```markdown
# PaySwap Pilot Daily Report — {DATE}

## Certification
- Suite: 17/17 PASS ✅
- Last run: {timestamp}

## Volume (24h)
- Payments: {count} ({GHS amount})
- Payouts: {count} ({GHS amount})
- Success rate: {X}%

## Treasury
- Reserve ratio: {X.XX}
- Twin Token supply: TWINGHS={X} TWINKES={X}
- Active alerts: {count}

## Compliance
- KYC verified: {count}/{total} merchants
- Sanctions screened: {count} transactions
- AML alerts: {count} open, {count} reviewed
- SARs filed: {count}

## Operations
- Incidents (24h): {P1 count} P1, {P2 count} P2
- MTTR: {X} min
- Circuit breakers: all closed ✅ / {N} open

## Issues
- {list of any issues from the previous day}
```

---

## 7. Post-Pilot Review

### Review Criteria

| Question | Answer Required |
|----------|----------------|
| Did all success metrics meet targets? | Yes/No + evidence |
| Were there any P1 incidents? | List + root cause |
| What was the merchant NPS? | Score + feedback |
| Is the system economically sustainable? | Fee revenue vs. opex |
| Are all security vulnerabilities remediated? | List of fixes |
| Is the operational runbook sufficient? | Gaps identified |
| Recommendation | Go / No-go / Go with conditions |

### Go Decision Requires:
1. ✅ All technical metrics met for 2 consecutive weeks
2. ✅ All business metrics met
3. ✅ 0 P1 incidents in final week
4. ✅ All critical/high security vulnerabilities remediated
5. ✅ Certification suite 17/17 PASS daily for 14 consecutive days
6. ✅ Merchant NPS ≥ 7
7. ✅ Operational runbooks validated by real use

### No-Go Triggers:
- Any P1 incident in final week
- Certification suite failing on any day
- Ledger ever becoming unbalanced
- Reserve ratio ever dropping below 1.0
- Any exploited security vulnerability
- Merchant NPS < 5
