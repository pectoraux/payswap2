# Regulatory Readiness Assessment

> **Question**: Could a regulator inspect this platform tomorrow?
> **Answer**: The technical controls exist, but the legal/regulatory framework is not in place.

---

## 1. AML Gap Analysis

### FATF Recommendations Compliance

| FATF Recommendation | Status | Evidence | Gap |
|---------------------|--------|----------|-----|
| Rec. 1: Risk-based approach | ✅ Implemented | `compliance/risk-scoring.ts` — 7-factor composite score, 90-day TTL | None |
| Rec. 10: Customer due diligence | ✅ Implemented | `compliance/kyc.ts` — 4 levels, document verification | Real KYC provider not integrated |
| Rec. 11: Record-keeping | ✅ Implemented | Event-sourced architecture, 151+ events persisted, immutable | None |
| Rec. 12: Politically exposed persons | ✅ Implemented | `compliance/pep.ts` — PEP screening, enhanced due diligence | Real PEP database not integrated |
| Rec. 13: Correspondent banking | ⚠️ Partial | LP lifecycle managed, but no real correspondent banking relationships | Real bank partnerships needed |
| Rec. 14: Money/value transfer services | ✅ Implemented | Full payment + payout lifecycle | Licensing required |
| Rec. 15: New technologies | ✅ Implemented | Twin Tokens on Stellar, risk-based approach to digital assets | None |
| Rec. 16: Wire transfers (travel rule) | ✅ Implemented | `compliance/travel-rule.ts` — FATF Rec. 16, $1k threshold, IVMS101 | Real VASP transmission not configured |
| Rec. 20: Reporting suspicious transactions | ✅ Implemented | `compliance/sar.ts` — draft → file → acknowledge | Real FIU filing system not integrated |
| Rec. 21: Tipping-off | ✅ Implemented | Cases are confidential, access controlled | None |
| Rec. 22: DNFBPs | N/A | Not applicable to PaySwap's business model | — |

### AML Program Gaps
1. **AML compliance officer**: Not designated (required by regulation)
2. **AML training program**: Not developed (required for all staff)
3. **Independent audit**: Not conducted (required annually)
4. **Regulator registration**: Not filed with relevant FIUs

---

## 2. KYC/KYB Checklist

### Individual KYC Requirements

| Requirement | Status | Evidence |
|-------------|--------|----------|
| Identity verification | ✅ | `kyc.ts` — passport, national ID, driver's license |
| Address verification | ✅ | `kyc.ts` — utility bill, bank statement |
| Date of birth verification | ✅ | Captured in KYC documents |
| Nationality verification | ✅ | Captured in KYC documents |
| Sanctions screening | ✅ | `sanctions.ts` — OFAC/EU/UN/UK HMT |
| PEP screening | ✅ | `pep.ts` — heads of state, senior officials |
| Adverse media screening | ❌ | Not implemented |
| Risk rating | ✅ | `risk-scoring.ts` — 7-factor composite |
| Enhanced due diligence (high-risk) | ✅ | KYC level 3 for high-risk entities |
| Ongoing monitoring | ✅ | AML velocity monitoring, risk re-assessment 90-day TTL |

### Business KYB Requirements

| Requirement | Status | Evidence |
|-------------|--------|----------|
| Business registration verification | ✅ | `kyb.ts` — registration number, jurisdiction |
| Legal entity verification | ✅ | `kyb.ts` — legal name, registered address |
| Beneficial owner identification | ✅ | `kyb.ts` — UBOs with >25% ownership |
| UBO KYC | ✅ | `kyb.ts` — cross-references UBOs to KYC service |
| Directors verification | ✅ | `kyb.ts` — directors list |
| Business risk rating | ✅ | `risk-scoring.ts` — industry risk weights |
| Ongoing monitoring | ✅ | Transaction monitoring + risk re-assessment |

### KYC/KYB Gaps
1. **Real document verification**: No real OCR/facial recognition (Onfido, Jumio, Persona)
2. **Adverse media screening**: Not implemented
3. **Document retention policy**: Not defined (regulators require 5-7 years)
4. **KYC refresh policy**: Defined (90-day TTL) but not enforced automatically

---

## 3. Travel Rule Mapping

### FATF Recommendation 16 Requirements

| Requirement | Status | Evidence |
|-------------|--------|----------|
| Originator information collected | ✅ | `travel-rule.ts` — name, account, address |
| Beneficiary information collected | ✅ | `travel-rule.ts` — name, account, address |
| Threshold for travel rule | ✅ | $1,000 USD (FATF standard) |
| Information transmitted between VASPs | ⚠️ | `transmit()` method exists but not connected to real VASP network |
| Information retained | ✅ | Event-sourced, immutable |
| Bulk transfers | ❌ | Not implemented (batch travel rule) |
| Cross-border transfer detection | ✅ | Corridor-based detection |
| Sunrise issue addressing | ❌ | Not implemented (interim solution for unhosted wallets) |

### Travel Rule Gaps
1. **VASP network integration**: Not connected to NOTABENE, Sygna Bridge, or TRP
2. **Unhosted wallet handling**: No sunset/sunrise issue address
3. **Bulk transfer support**: Not implemented

---

## 4. Licensing Matrix

| Jurisdiction | License Required | Status | Estimated Timeline |
|-------------|-----------------|--------|-------------------|
| Ghana | Money Transfer Business License (Bank of Ghana) | ❌ Not applied | 6-12 months |
| Kenya | Money Remittance License (Central Bank of Kenya) | ❌ Not applied | 6-12 months |
| Kenya | Payment Service Provider registration (CBK) | ❌ Not applied | 3-6 months |
| Nigeria | MMO License (CBN) or PSP License | ❌ Not applied | 6-18 months |
| EU | EMI License (per member state) | ❌ Not applied | 12-24 months |
| US | MSB Registration (FinCEN) + State MTL | ❌ Not applied | 12-24 months |
| UK | FCA EMI Registration | ❌ Not applied | 12-18 months |

### Licensing Gaps
- No licenses obtained in any jurisdiction
- No legal entities established in target jurisdictions
- No compliance officer designated
- No regulatory capital deposited

---

## 5. Required Legal Entities

| Entity | Purpose | Status |
|--------|---------|--------|
| PaySwap Ghana Ltd | Ghana operations | ❌ Not incorporated |
| PaySwap Kenya Ltd | Kenya operations | ❌ Not incorporated |
| PaySwap Group (holding) | Group structure | ❌ Not incorporated |
| Local compliance officer (per jurisdiction) | Regulatory liaison | ❌ Not designated |
| Data Protection Officer (DPO) | GDPR/DPA compliance | ❌ Not designated |

---

## 6. Required Policies

| Policy | Status | Location |
|--------|--------|----------|
| AML/CFT Policy | ✅ Draft | `compliance/` module implements the framework |
| KYC/KYB Policy | ✅ Draft | `compliance/kyc.ts`, `compliance/kyb.ts` |
| Sanctions Screening Policy | ✅ Draft | `compliance/sanctions.ts` |
| Travel Rule Policy | ✅ Draft | `compliance/travel-rule.ts` |
| Data Protection Policy | ❌ Not drafted | Required for GDPR/DPA |
| Retention Policy | ❌ Not drafted | Required for record-keeping (5-7 years) |
| Incident Response Policy | ✅ Draft | `certification/results/operational-runbooks.md` |
| Business Continuity Policy | ✅ Draft | `protocol/disaster-recovery/` |
| Risk Management Policy | ✅ Draft | `compliance/risk-scoring.ts` |
| Outsourcing Policy | ❌ Not drafted | Required for LP/connector relationships |
| Customer Complaints Policy | ❌ Not drafted | Required for consumer protection |

---

## 7. Operational Controls

| Control | Status | Evidence |
|---------|--------|----------|
| Transaction monitoring | ✅ | `compliance/aml.ts` — structuring, velocity, corridor risk |
| Sanctions filtering | ✅ | `compliance/sanctions.ts` — OFAC/EU/UN/UK HMT |
| Suspicious activity reporting | ✅ | `compliance/sar.ts` |
| Customer risk rating | ✅ | `compliance/risk-scoring.ts` |
| Enhanced due diligence | ✅ | KYC level 3 for high-risk |
| Ongoing customer due diligence | ✅ | 90-day TTL re-assessment |
| Currency transaction reporting | ❌ | Not implemented (threshold reporting) |
| Record-keeping (5-7 years) | ⚠️ | Event-sourced, but no retention enforcement |
| Employee training | ❌ | Not implemented |
| Independent audit | ❌ | Not conducted |

---

## 8. Audit Checklist

### What a regulator would inspect:

| # | Item | Ready? | Notes |
|---|------|--------|-------|
| 1 | AML program documentation | ⚠️ | Technical implementation exists; written policy not drafted |
| 2 | KYC records for all customers | ✅ | Event-sourced, complete audit trail |
| 3 | Sanctions screening records | ✅ | Every transaction screened, results logged |
| 4 | SAR filings | ✅ | Draft → file → acknowledge workflow |
| 5 | Transaction monitoring records | ✅ | AML alerts, velocity monitoring |
| 6 | Risk assessment methodology | ✅ | 7-factor composite, documented in code |
| 7 | Compliance officer designation | ❌ | Not designated |
| 8 | Board/management oversight | ❌ | No governance structure |
| 9 | Independent audit | ❌ | Not conducted |
| 10 | Employee training records | ❌ | Not implemented |
| 11 | Data protection compliance | ❌ | Not assessed |
| 12 | Business continuity plan | ✅ | DR module, runbooks |
| 13 | Incident response plan | ✅ | Operational runbooks |
| 14 | Outsourcing due diligence | ❌ | No LP/connector due diligence process |
| 15 | Record retention | ⚠️ | Event-sourced but no retention policy enforcement |

---

## 9. Regulatory Readiness Verdict

### Could a regulator inspect this platform tomorrow?

**Technically: YES** — the system produces complete audit trails, screens all transactions, maintains records, and can generate compliance reports.

**Legally: NO** — no licenses obtained, no legal entities established, no compliance officer designated, no written policies drafted, no independent audit conducted.

### Regulatory Readiness Status: ❌ NOT READY

### Required Before Regulatory Inspection:
1. Incorporate legal entities in target jurisdictions
2. Obtain money transmitter/remittance licenses
3. Designate compliance officer + DPO
4. Draft written AML/KYC/sanctions policies (not just code)
5. Conduct independent audit
6. Implement employee training program
7. Establish record retention enforcement
8. File for data protection registration
9. Integrate real KYC/sanctions/PEP providers
10. Connect to real VASP network for travel rule

### Estimated Timeline to Regulatory Readiness: 6-12 months (per jurisdiction)
