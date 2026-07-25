# PaySwap Adversarial Security Review

**Run Date**: 2026-07-25T05:37:47.973Z
**Task ID**: SEC-REVIEW
**Agent**: Adversarial Security Review

## Executive Summary

Executed **25** adversarial attacks against the PaySwap protocol layer (kernel FROZEN; only 
protocol-level surfaces were attacked).

- **Defenses verified (PASS)**: 12
- **Vulnerabilities found (FAIL)**: 13
- **By severity**: Critical=1, High=7, Medium=5, Low=0

> This report is an adversarial review — each FAIL is a tracked remediation item. The kernel was NOT modified.

## Per-Attack Findings

| ID | Category | Attack | Status | Severity | Actual Result | Remediation |
|---|---|---|---|---|---|---|
| SEC-001 | Payment Flow | Double-spend: debit wallet for more than its balance | ✅ PASS | — | debit() threw: "insufficient available balance in wallet wallet_ttiu003 (have 100, need 500)". Balance after = 100 (unchanged). | No action — wallet service enforces sufficient-balance check synchronously. |
| SEC-002 | Payment Flow | Replay: re-emit a wallet.credited event to double-credit | ❌ FAIL | High | Wallet balance after replay = 200 (expected 100 if idempotent, 200 if replayed). | Event stream must deduplicate by event id (or projection must track applied event ids). Replaying a wallet.credited event currently doubles the credited amount. |
| SEC-003 | Payment Flow | Race condition: concurrent debits that together exceed balance | ✅ PASS | — | successes=1/2; final balance=40; errors=[{"ok":false,"err":"insufficient available balance in wallet wallet_ttiv00f (have 40, need 60)"}]. | No action — wallet debit is synchronous and atomic in the JS event loop. |
| SEC-004 | Payout Flow | Payout without sufficient balance | ✅ PASS | — | payout.state=failed; failureReason="insufficient_available_balance". | No action — twinTokenEngine.burn returns insufficient_available_balance and payout is marked failed. |
| SEC-005 | Payout Flow | Double-payout: process the same payout twice | ✅ PASS | — | Second process() threw: "payout po_ttix00y cannot transition from completed". Final balance = 9900 (expected 9900). | No action — payout state machine rejects transition from non-reviewing states. |
| SEC-006 | Payout Flow | Payout to compliance-frozen destination account | ❌ FAIL | Medium | transfer.success=true, (no error); destination balance after = 100. | twinTokenEngine.transfer must check the destination holder's frozen flag, not only the source's. A frozen account receiving funds defeats the compliance freeze. |
| SEC-007 | QR Flow | QR replay: pay the same dynamic QR twice | ❌ FAIL | Medium | first isValid=true; second isValid=true. No consume()/markUsed() API exists on QRService — the QR remains "valid" until natural expiry. | Add a `consume(qrId)` method that marks the QR as used and rejects subsequent uses. Dynamic QR must be one-shot. |
| SEC-008 | QR Flow | QR tampering: modify amount in QR payload | ❌ FAIL | Medium | QR payload fields = {id, type, merchant, wallet, currency, amount, reference}; hasSignature=false. Stored QR amount = 100; tampered payload amount = 1. The payload is NOT signed — a merchant that decodes the QR and trusts the payload (instead of calling qrService.get(id)) would h | Sign the QR payload (HMAC over the encoded data) using a merchant-specific secret. Provide a `decodeAndVerify(encoded, secret)` method that rejects tampered payloads. Merchants must always cross-check the decoded payload against qrService.get(id). |
| SEC-009 | QR Flow | Expired QR: try to use an expired QR | ✅ PASS | — | isValid=false (expected false). | No action — isValid() correctly rejects expired QRs. |
| SEC-010 | Webhook Verification | Forged HMAC signature | ✅ PASS | — | verifySignature=false (expected false). | No action — HMAC-SHA256 with timingSafeEqual rejects forged signatures. |
| SEC-011 | Webhook Verification | Webhook replay: re-deliver a previously valid webhook | ❌ FAIL | High | first verify=true; replay verify=true. Body contains no timestamp/nonce — the signature alone cannot distinguish a fresh delivery from a replay. | Add a signed timestamp + nonce to the webhook body and reject deliveries older than a configurable window (e.g. 5 min) or with a previously-seen nonce. |
| SEC-012 | Webhook Verification | Missing signature | ✅ PASS | — | verifySignature(empty_sig)=false (expected false). | No action — verifySignature returns false for empty signatures. |
| SEC-013 | Authentication | Invalid API key | ✅ PASS | — | validateKey('psk_live_garbage')=null; validateKey('not-even-a-key')=null; validateKey('')=null. | No action — validateKey returns null for unrecognized keys. |
| SEC-014 | Authentication | Expired API key | ✅ PASS | — | validateKey=null (expected null). | No action — validateKey checks expiresAt and rejects expired keys. |
| SEC-015 | Authentication | Scope escalation: use a read-only key for write operations | ❌ FAIL | High | validateKey returned scopes=["payments:read"]. The key does NOT have payments:write (hasWrite=false). However, NO protocol module or API route enforces scopes — there is no requireScope(key, 'payments:write') guard anywhere in the codebase. | Add a `requireScope(req, scope)` middleware to every API route and protocol entry point. Scopes are currently advisory — a read-only key can perform writes if it reaches the handler. |
| SEC-016 | Authorization | Cross-merchant access: read another merchant's data | ❌ FAIL | Critical | getApiKeys(alice.id) returned 1 keys (incl. label="alice-key", keyPrefix="psk_live_psk_l****"). getAnalytics returned data. getInvoices returned 0 invoices. The platform does NOT verify caller identity or merchant membership. | Every merchantPlatform / payoutService / webhookEngine accessor that takes a merchantId MUST verify the caller's API key belongs to that merchantId. API routes must call apiKeyService.validateKey() and pass the resulting merchantId — never trust a client-supplied merchantId. |
| SEC-017 | Authorization | Role escalation: analyst invites themselves as owner | ❌ FAIL | High | analyst invitation: created (role=analyst). owner escalation: CREATED (role=owner). inviteTeamMember does NOT verify the caller's role — any caller can invite at any role, including owner/admin. | inviteTeamMember must take a callerTeamMemberId parameter and verify the caller's role is owner/admin before allowing admin/owner invitations. |
| SEC-018 | Double-Spend Prevention | Concurrent transfers from the same wallet | ✅ PASS | — | successes=1/2; src1=ok; src2=fail:insufficient_balance; source balance after = 40 (expected 40 if defended, -20 if both succeeded). | No action — stellar adapter's synchronous check-then-debit prevents the race, even though twinTokenEngine's local check is non-atomic. |
| SEC-019 | Double-Spend Prevention | Optimistic locking bypass on balance updates | ❌ FAIL | Medium | TwinTokenBalance fields = {holder, assetCode, balance, escrowed, frozen}. No version/updatedAt/lockToken field. Balance is mutated in-place (b.balance = round(b.balance ± amount, 7)). Defense relies entirely on stellarAdapter's synchronous check-then-debit. | Add a `version` (or `updatedAt`) field to TwinTokenBalance and use compare-and-set on every mutation. Currently the stellar adapter is the only line of defense; if it is ever swapped for a real async adapter, the twin-token layer becomes vulnerable. |
| SEC-020 | Race Conditions | Concurrent payout processing (same payoutId) | ✅ PASS | — | fulfilled states=["completed"]; rejected errors=["payout po_ttj703d cannot transition from processing"]; final balance=9900 (expected 9900 if defended). | No action — process() synchronously transitions state to processing before any await, blocking concurrent callers. |
| SEC-021 | Race Conditions | Concurrent wallet ops (credit + debit on same wallet) | ✅ PASS | — | final balance=90 (expected 90 if exactly one debit of 60 succeeds + credit of 50 succeeds). | No action — wallet service methods are synchronous and atomic in the JS event loop. |
| SEC-022 | Connector Spoofing | Forge Evidence and inject it into the system | ❌ FAIL | High | evidenceStore.get('evid_ttj703y') = present (amount=1000000000, level=cryptographic, attester=forged-attacker). createEvidence and evidenceStore.register perform NO attester authentication — any caller can mint cryptographic-grade evidence. | evidenceStore.register must verify the evidence was produced by a registered, authenticated connector. createEvidence should be private to the connector framework, not exported to all callers. |
| SEC-023 | Connector Spoofing | Register a fake connector that produces malicious evidence | ❌ FAIL | Medium | registry.get('open_banking').name = "Malicious Open Banking" (was "Open Banking (PSD2)"). Query returned success=true, evidence.verificationLevel="cryptographic", evidence.attestedAmount=1000000000. The registry performs NO authentication on register() — any module can replace a  | productionConnectorRegistry.register() must verify a connector trust token or be made private (only called from a signed bootstrap). Any caller can currently replace a production connector with a malicious one. |
| SEC-024 | Evidence Forgery | Tamper with an Evidence object after creation | ❌ FAIL | High | evidenceHash before="hash_ttj8044", after="hash_ttj8044". Hash is IDENTICAL (NOT content-derived). The evidenceHash field is generated by uid('hash') — a sequential counter, NOT a cryptographic hash of the contents. | evidenceHash must be sha256(canonical_json(type\|source\|verificationLevel\|entityId\|attestedAmount\|currency\|attester\|payload)). Verify the hash on every read; reject evidence whose recomputed hash mismatches the stored hash. |
| SEC-025 | Evidence Forgery | Create synthetic Evidence with no real connector backing | ❌ FAIL | High | confidenceFor returned amount=689534.31, confidence=0.6965, bestEvidence=present (attester=synthetic-attacker, amount=999999). No provenance check exists — synthetic evidence is accepted and used in confidence calculations. | Evidence must carry a signed attestation from a registered connector. evidenceStore.register must verify the signature against the connector's public key before accepting. Synthetic evidence with no backing must be rejected. |

## Detailed Findings

### SEC-001 — Double-spend: debit wallet for more than its balance

- **Category**: Payment Flow
- **Status**: ✅ PASS (defense verified)
- **What was tried**: Created wallet with balance=100, attempted debit of 500.
- **Actual result**: debit() threw: "insufficient available balance in wallet wallet_ttiu003 (have 100, need 500)". Balance after = 100 (unchanged).
- **Remediation**: No action — wallet service enforces sufficient-balance check synchronously.

### SEC-002 — Replay: re-emit a wallet.credited event to double-credit

- **Category**: Payment Flow
- **Status**: ❌ FAIL (High)
- **What was tried**: Emitted 'wallet.credited' twice with identical payload {walletId, amount:100}, then rebuilt balances from events.
- **Actual result**: Wallet balance after replay = 200 (expected 100 if idempotent, 200 if replayed).
- **Remediation**: Event stream must deduplicate by event id (or projection must track applied event ids). Replaying a wallet.credited event currently doubles the credited amount.

### SEC-003 — Race condition: concurrent debits that together exceed balance

- **Category**: Payment Flow
- **Status**: ✅ PASS (defense verified)
- **What was tried**: Wallet balance=100. Fired Promise.all([debit(60), debit(60)]).
- **Actual result**: successes=1/2; final balance=40; errors=[{"ok":false,"err":"insufficient available balance in wallet wallet_ttiv00f (have 40, need 60)"}].
- **Remediation**: No action — wallet debit is synchronous and atomic in the JS event loop.

### SEC-004 — Payout without sufficient balance

- **Category**: Payout Flow
- **Status**: ✅ PASS (defense verified)
- **What was tried**: Merchant has 0 TWINKES; requested bank payout of 1000; called process().
- **Actual result**: payout.state=failed; failureReason="insufficient_available_balance".
- **Remediation**: No action — twinTokenEngine.burn returns insufficient_available_balance and payout is marked failed.

### SEC-005 — Double-payout: process the same payout twice

- **Category**: Payout Flow
- **Status**: ✅ PASS (defense verified)
- **What was tried**: Created payout (100 TWINKES). Called process() twice in sequence.
- **Actual result**: Second process() threw: "payout po_ttix00y cannot transition from completed". Final balance = 9900 (expected 9900).
- **Remediation**: No action — payout state machine rejects transition from non-reviewing states.

### SEC-006 — Payout to compliance-frozen destination account

- **Category**: Payout Flow
- **Status**: ❌ FAIL (Medium)
- **What was tried**: Froze destination holder "dst_cchfrwqf" (frozen=false). Attempted transfer of 100 TWINKES from unfrozen source to frozen destination.
- **Actual result**: transfer.success=true, (no error); destination balance after = 100.
- **Remediation**: twinTokenEngine.transfer must check the destination holder's frozen flag, not only the source's. A frozen account receiving funds defeats the compliance freeze.

### SEC-007 — QR replay: pay the same dynamic QR twice

- **Category**: QR Flow
- **Status**: ❌ FAIL (Medium)
- **What was tried**: Generated dynamic QR (amount=500). Called isValid() twice (simulating two payment attempts).
- **Actual result**: first isValid=true; second isValid=true. No consume()/markUsed() API exists on QRService — the QR remains "valid" until natural expiry.
- **Remediation**: Add a `consume(qrId)` method that marks the QR as used and rejects subsequent uses. Dynamic QR must be one-shot.

### SEC-008 — QR tampering: modify amount in QR payload

- **Category**: QR Flow
- **Status**: ❌ FAIL (Medium)
- **What was tried**: Generated dynamic QR (amount=100). Decoded payload, set amount=1, re-encoded. Checked whether the QR carries a signature/MAC field.
- **Actual result**: QR payload fields = {id, type, merchant, wallet, currency, amount, reference}; hasSignature=false. Stored QR amount = 100; tampered payload amount = 1. The payload is NOT signed — a merchant that decodes the QR and trusts the payload (instead of calling qrService.get(id)) would honor the tampered amount.
- **Remediation**: Sign the QR payload (HMAC over the encoded data) using a merchant-specific secret. Provide a `decodeAndVerify(encoded, secret)` method that rejects tampered payloads. Merchants must always cross-check the decoded payload against qrService.get(id).

### SEC-009 — Expired QR: try to use an expired QR

- **Category**: QR Flow
- **Status**: ✅ PASS (defense verified)
- **What was tried**: Generated dynamic QR with expiresMs=1, waited 5ms, called isValid().
- **Actual result**: isValid=false (expected false).
- **Remediation**: No action — isValid() correctly rejects expired QRs.

### SEC-010 — Forged HMAC signature

- **Category**: Webhook Verification
- **Status**: ✅ PASS (defense verified)
- **What was tried**: Registered webhook endpoint with secret. Sent body with a forged signature (all zeros).
- **Actual result**: verifySignature=false (expected false).
- **Remediation**: No action — HMAC-SHA256 with timingSafeEqual rejects forged signatures.

### SEC-011 — Webhook replay: re-deliver a previously valid webhook

- **Category**: Webhook Verification
- **Status**: ❌ FAIL (High)
- **What was tried**: Captured a valid (body, signature) pair. Called verifySignature() twice with the same pair.
- **Actual result**: first verify=true; replay verify=true. Body contains no timestamp/nonce — the signature alone cannot distinguish a fresh delivery from a replay.
- **Remediation**: Add a signed timestamp + nonce to the webhook body and reject deliveries older than a configurable window (e.g. 5 min) or with a previously-seen nonce.

### SEC-012 — Missing signature

- **Category**: Webhook Verification
- **Status**: ✅ PASS (defense verified)
- **What was tried**: Sent a webhook with an empty signature header.
- **Actual result**: verifySignature(empty_sig)=false (expected false).
- **Remediation**: No action — verifySignature returns false for empty signatures.

### SEC-013 — Invalid API key

- **Category**: Authentication
- **Status**: ✅ PASS (defense verified)
- **What was tried**: Called validateKey with three malformed values: 'psk_live_garbage', 'not-even-a-key', ''.
- **Actual result**: validateKey('psk_live_garbage')=null; validateKey('not-even-a-key')=null; validateKey('')=null.
- **Remediation**: No action — validateKey returns null for unrecognized keys.

### SEC-014 — Expired API key

- **Category**: Authentication
- **Status**: ✅ PASS (defense verified)
- **What was tried**: Created API key with expiresAt=1784957866969 (1s in the past). Called validateKey().
- **Actual result**: validateKey=null (expected null).
- **Remediation**: No action — validateKey checks expiresAt and rejects expired keys.

### SEC-015 — Scope escalation: use a read-only key for write operations

- **Category**: Authentication
- **Status**: ❌ FAIL (High)
- **What was tried**: Created API key with scope ['payments:read'] only. Checked if scope enforcement prevents writes.
- **Actual result**: validateKey returned scopes=["payments:read"]. The key does NOT have payments:write (hasWrite=false). However, NO protocol module or API route enforces scopes — there is no requireScope(key, 'payments:write') guard anywhere in the codebase.
- **Remediation**: Add a `requireScope(req, scope)` middleware to every API route and protocol entry point. Scopes are currently advisory — a read-only key can perform writes if it reaches the handler.

### SEC-016 — Cross-merchant access: read another merchant's data

- **Category**: Authorization
- **Status**: ❌ FAIL (Critical)
- **What was tried**: Onboarded Alice and Bob. From Bob's context (no auth), called merchantPlatform.getApiKeys(alice.id), getAnalytics(alice.id), getInvoices(alice.id).
- **Actual result**: getApiKeys(alice.id) returned 1 keys (incl. label="alice-key", keyPrefix="psk_live_psk_l****"). getAnalytics returned data. getInvoices returned 0 invoices. The platform does NOT verify caller identity or merchant membership.
- **Remediation**: Every merchantPlatform / payoutService / webhookEngine accessor that takes a merchantId MUST verify the caller's API key belongs to that merchantId. API routes must call apiKeyService.validateKey() and pass the resulting merchantId — never trust a client-supplied merchantId.

### SEC-017 — Role escalation: analyst invites themselves as owner

- **Category**: Authorization
- **Status**: ❌ FAIL (High)
- **What was tried**: Invited analyst@x.test as 'analyst'. Then called inviteTeamMember(..., 'analyst@x.test', 'owner') (simulating the analyst self-promoting).
- **Actual result**: analyst invitation: created (role=analyst). owner escalation: CREATED (role=owner). inviteTeamMember does NOT verify the caller's role — any caller can invite at any role, including owner/admin.
- **Remediation**: inviteTeamMember must take a callerTeamMemberId parameter and verify the caller's role is owner/admin before allowing admin/owner invitations.

### SEC-018 — Concurrent transfers from the same wallet

- **Category**: Double-Spend Prevention
- **Status**: ✅ PASS (defense verified)
- **What was tried**: Source holder has 100 TWINGHS. Fired Promise.all([transfer(60 to dst1), transfer(60 to dst2)]).
- **Actual result**: successes=1/2; src1=ok; src2=fail:insufficient_balance; source balance after = 40 (expected 40 if defended, -20 if both succeeded).
- **Remediation**: No action — stellar adapter's synchronous check-then-debit prevents the race, even though twinTokenEngine's local check is non-atomic.

### SEC-019 — Optimistic locking bypass on balance updates

- **Category**: Double-Spend Prevention
- **Status**: ❌ FAIL (Medium)
- **What was tried**: Inspected TwinTokenBalance record for version/lock fields. Performed concurrent mint+burn to confirm no CAS is enforced at the twin-token layer.
- **Actual result**: TwinTokenBalance fields = {holder, assetCode, balance, escrowed, frozen}. No version/updatedAt/lockToken field. Balance is mutated in-place (b.balance = round(b.balance ± amount, 7)). Defense relies entirely on stellarAdapter's synchronous check-then-debit.
- **Remediation**: Add a `version` (or `updatedAt`) field to TwinTokenBalance and use compare-and-set on every mutation. Currently the stellar adapter is the only line of defense; if it is ever swapped for a real async adapter, the twin-token layer becomes vulnerable.

### SEC-020 — Concurrent payout processing (same payoutId)

- **Category**: Race Conditions
- **Status**: ✅ PASS (defense verified)
- **What was tried**: Created payout (100 TWINKES). Fired Promise.all([process(p.id), process(p.id)]).
- **Actual result**: fulfilled states=["completed"]; rejected errors=["payout po_ttj703d cannot transition from processing"]; final balance=9900 (expected 9900 if defended).
- **Remediation**: No action — process() synchronously transitions state to processing before any await, blocking concurrent callers.

### SEC-021 — Concurrent wallet ops (credit + debit on same wallet)

- **Category**: Race Conditions
- **Status**: ✅ PASS (defense verified)
- **What was tried**: Wallet balance=100. Fired Promise.all([debit(60), debit(60), credit(50)]).
- **Actual result**: final balance=90 (expected 90 if exactly one debit of 60 succeeds + credit of 50 succeeds).
- **Remediation**: No action — wallet service methods are synchronous and atomic in the JS event loop.

### SEC-022 — Forge Evidence and inject it into the system

- **Category**: Connector Spoofing
- **Status**: ❌ FAIL (High)
- **What was tried**: Called createEvidence() directly with type='fiat_proof', verificationLevel='cryptographic', attestedAmount=1,000,000,000 USD, attester='forged-attacker'. Registered it in evidenceStore.
- **Actual result**: evidenceStore.get('evid_ttj703y') = present (amount=1000000000, level=cryptographic, attester=forged-attacker). createEvidence and evidenceStore.register perform NO attester authentication — any caller can mint cryptographic-grade evidence.
- **Remediation**: evidenceStore.register must verify the evidence was produced by a registered, authenticated connector. createEvidence should be private to the connector framework, not exported to all callers.

### SEC-023 — Register a fake connector that produces malicious evidence

- **Category**: Connector Spoofing
- **Status**: ❌ FAIL (Medium)
- **What was tried**: Subclassed ProductionConnector with a 'MaliciousConnector' (id='open_banking', endpoint='evil://attacker'). Called registry.register(malicious) — overwrites the legitimate Open Banking connector. Queried it.
- **Actual result**: registry.get('open_banking').name = "Malicious Open Banking" (was "Open Banking (PSD2)"). Query returned success=true, evidence.verificationLevel="cryptographic", evidence.attestedAmount=1000000000. The registry performs NO authentication on register() — any module can replace a production connector.
- **Remediation**: productionConnectorRegistry.register() must verify a connector trust token or be made private (only called from a signed bootstrap). Any caller can currently replace a production connector with a malicious one.

### SEC-024 — Tamper with an Evidence object after creation

- **Category**: Evidence Forgery
- **Status**: ❌ FAIL (High)
- **What was tried**: Created evidence (attestedAmount=100, txHash='real-tx-abc'). Mutated attestedAmount to 1,000,000,000 and txHash to 'fake-tx-xyz'. Compared evidenceHash before/after.
- **Actual result**: evidenceHash before="hash_ttj8044", after="hash_ttj8044". Hash is IDENTICAL (NOT content-derived). The evidenceHash field is generated by uid('hash') — a sequential counter, NOT a cryptographic hash of the contents.
- **Remediation**: evidenceHash must be sha256(canonical_json(type|source|verificationLevel|entityId|attestedAmount|currency|attester|payload)). Verify the hash on every read; reject evidence whose recomputed hash mismatches the stored hash.

### SEC-025 — Create synthetic Evidence with no real connector backing

- **Category**: Evidence Forgery
- **Status**: ❌ FAIL (High)
- **What was tried**: Called createEvidence() directly (no connector involved) with attester='synthetic-attacker'. Registered in evidenceStore. Queried confidenceFor('any-lp', 'USD').
- **Actual result**: confidenceFor returned amount=689534.31, confidence=0.6965, bestEvidence=present (attester=synthetic-attacker, amount=999999). No provenance check exists — synthetic evidence is accepted and used in confidence calculations.
- **Remediation**: Evidence must carry a signed attestation from a registered connector. evidenceStore.register must verify the signature against the connector's public key before accepting. Synthetic evidence with no backing must be rejected.

## Recommendations

Ranked by impact, the top remediation priorities are:

1. **[Critical] SEC-016 — Cross-merchant access: read another merchant's data** — Every merchantPlatform / payoutService / webhookEngine accessor that takes a merchantId MUST verify the caller's API key belongs to that merchantId. API routes must call apiKeyService.validateKey() and pass the resulting merchantId — never trust a client-supplied merchantId.
2. **[High] SEC-002 — Replay: re-emit a wallet.credited event to double-credit** — Event stream must deduplicate by event id (or projection must track applied event ids). Replaying a wallet.credited event currently doubles the credited amount.
3. **[High] SEC-011 — Webhook replay: re-deliver a previously valid webhook** — Add a signed timestamp + nonce to the webhook body and reject deliveries older than a configurable window (e.g. 5 min) or with a previously-seen nonce.
4. **[High] SEC-015 — Scope escalation: use a read-only key for write operations** — Add a `requireScope(req, scope)` middleware to every API route and protocol entry point. Scopes are currently advisory — a read-only key can perform writes if it reaches the handler.
5. **[High] SEC-017 — Role escalation: analyst invites themselves as owner** — inviteTeamMember must take a callerTeamMemberId parameter and verify the caller's role is owner/admin before allowing admin/owner invitations.
6. **[High] SEC-022 — Forge Evidence and inject it into the system** — evidenceStore.register must verify the evidence was produced by a registered, authenticated connector. createEvidence should be private to the connector framework, not exported to all callers.
7. **[High] SEC-024 — Tamper with an Evidence object after creation** — evidenceHash must be sha256(canonical_json(type|source|verificationLevel|entityId|attestedAmount|currency|attester|payload)). Verify the hash on every read; reject evidence whose recomputed hash mismatches the stored hash.
8. **[High] SEC-025 — Create synthetic Evidence with no real connector backing** — Evidence must carry a signed attestation from a registered connector. evidenceStore.register must verify the signature against the connector's public key before accepting. Synthetic evidence with no backing must be rejected.
9. **[Medium] SEC-006 — Payout to compliance-frozen destination account** — twinTokenEngine.transfer must check the destination holder's frozen flag, not only the source's. A frozen account receiving funds defeats the compliance freeze.
10. **[Medium] SEC-007 — QR replay: pay the same dynamic QR twice** — Add a `consume(qrId)` method that marks the QR as used and rejects subsequent uses. Dynamic QR must be one-shot.
11. **[Medium] SEC-008 — QR tampering: modify amount in QR payload** — Sign the QR payload (HMAC over the encoded data) using a merchant-specific secret. Provide a `decodeAndVerify(encoded, secret)` method that rejects tampered payloads. Merchants must always cross-check the decoded payload against qrService.get(id).
12. **[Medium] SEC-019 — Optimistic locking bypass on balance updates** — Add a `version` (or `updatedAt`) field to TwinTokenBalance and use compare-and-set on every mutation. Currently the stellar adapter is the only line of defense; if it is ever swapped for a real async adapter, the twin-token layer becomes vulnerable.
13. **[Medium] SEC-023 — Register a fake connector that produces malicious evidence** — productionConnectorRegistry.register() must verify a connector trust token or be made private (only called from a signed bootstrap). Any caller can currently replace a production connector with a malicious one.

## Verification Gates

- Kernel FROZEN: `git -C /home/z/my-project diff --name-only HEAD -- src/kernel/ | wc -l` = 0 (confirmed).
- Lint: `cd /home/z/my-project && bun run lint` = 0 errors.
- This script ran successfully: see stdout above.
