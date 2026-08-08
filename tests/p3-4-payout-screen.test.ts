import { describe, test, expect } from 'bun:test';
import { evaluateCriticalConstitution, type LiveMoneyContext } from '@/kernel';
import { sanctionsService } from '@/protocol/compliance/sanctions';
import { kycService } from '@/protocol/compliance/kyc';

/**
 * P3-4 (H-8 fix): the payout creation path now screens the RECIPIENT
 * (passed as `counterparty` to `guardLiveMoney`). A payout whose
 * destination resolves to a sanctioned name must be blocked with 403.
 *
 * The payout route (`src/app/api/payouts/create/route.ts`) passes the
 * body's `destination` string as `counterparty: { id, name }`. The
 * constitution's `cmp-sanctions-screen` rule screens both actor +
 * counterparty; if either has an active sanctions hit, the verdict
 * fails with severity='block' → route returns 403.
 */
describe('P3-4: payout sanctions screen blocks sanctioned recipients', () => {
  test('blocks a payout whose destination matches a sanctioned name', () => {
    const live: LiveMoneyContext = {
      actor: { id: 'clean_actor_p3_4', role: 'MERCHANT', capabilities: ['money:move'] },
      // Destination contains a sanctioned name (KIM JONG UN is in the
      // DEV fixture). The fuzzy matcher should match.
      counterparty: { id: 'dest_1', name: 'KIM JONG UN' },
      amount: 100,
      currency: 'USD',
      transactionType: 'payout',
    };
    const v = evaluateCriticalConstitution(live);
    expect(v.passed).toBe(false);
    const sanctionsViolation = v.violations.find((x) => x.invariant === 'Sanctions Screening');
    expect(sanctionsViolation).toBeDefined();
    expect(sanctionsViolation!.severity).toBe('block');
    // The detail should mention the counterparty was flagged.
    expect(sanctionsViolation!.detail).toContain('Counterparty');
    // Cleanup
    const hits = sanctionsService.getHits('dest_1');
    for (const h of hits) sanctionsService.reviewHit(h.id, true);
  });

  test('passes a payout whose destination is a clean opaque ID', () => {
    // The actor needs KYC for the cmp-kyc rule to pass. Set up a dossier.
    const entityId = 'clean_actor_p3_4_pass';
    const doc = kycService.submitDocument(entityId, {
      type: 'passport',
      holder: 'Clean Actor',
      country: 'Kenya',
    });
    kycService.verifyDocument(doc.id, true);

    const live: LiveMoneyContext = {
      actor: { id: entityId, role: 'CUSTOMER', capabilities: ['money:move'] },
      // An opaque bank account number — should NOT match any sanctions entry.
      counterparty: { id: 'bank_acc_001', name: 'bank_acc_001' },
      amount: 100,
      currency: 'USD',
      transactionType: 'payout',
    };
    const v = evaluateCriticalConstitution(live);
    // Should pass: clean actor + opaque destination.
    expect(v.passed).toBe(true);
  });
});
