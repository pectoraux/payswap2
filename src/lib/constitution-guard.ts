/**
 * Live Constitution Guard — runs the CRITICAL subset of the Constitution
 * against a live money-movement request BEFORE the transaction executes.
 * (P2-4 / C-7 fix.)
 *
 * Used by the 6 live money routes:
 *   - wallet/transfer
 *   - wallet/deposit
 *   - wallet/withdraw
 *   - payouts/create
 *   - refunds/create
 *   - treasury/reserves/adjust
 *
 * If a `severity: 'block'` rule fails, the route MUST return 403 Forbidden
 * with a structured body listing the violations. The guard itself does NOT
 * throw — it returns a structured verdict so the caller can render a
 * useful 403 body.
 *
 * Performance: < 1ms per request (8 of 45 rules, all in-memory checks).
 * The sanctions screening calls the in-memory sample list (~10 entries)
 * with Levenshtein + Jaccard matching — no external API call.
 *
 * Infinite-loop prevention: this guard does NOT call any money-movement
 * route. The constitution rules it invokes (cmp-sanctions-screen, cmp-kyc,
 * cmp-corridor-authorized, cmp-tx-limit, gov-policy-passed, gov-no-circular,
 * sec-authorized-actor, sec-permission-checked) read only from the
 * `LiveMoneyContext` + the sanctions/kyc singletons — they do not dispatch
 * commands or call back into the API.
 */
import { evaluateCriticalConstitution, type LiveMoneyContext, type ConstitutionVerdict } from '@/kernel';

/**
 * Run the critical constitution rules against a live money-movement
 * request. Returns the verdict — caller is responsible for returning 403
 * if `verdict.passed === false`.
 *
 * @example
 *   const verdict = guardLiveMoney({
 *     actor: { id: ctx.userId, role: 'CUSTOMER' },
 *     amount, currency,
 *     transactionType: 'wallet_transfer',
 *     counterparty: { id: recipientId, name: recipientLabel },
 *   });
 *   if (!verdict.passed) {
 *     return NextResponse.json({ ok: false, error: 'Constitution blocked', violations: verdict.violations }, { status: 403 });
 *   }
 */
export function guardLiveMoney(ctx: LiveMoneyContext): ConstitutionVerdict {
  return evaluateCriticalConstitution(ctx);
}

/**
 * Convenience: build a 403 response body from a failed verdict.
 * Returns a JSON-serializable object.
 */
export function constitutionBlockBody(verdict: ConstitutionVerdict): {
  ok: false;
  error: string;
  violations: { section: string; invariant: string; detail: string; severity: string }[];
} {
  return {
    ok: false,
    error: 'Constitution blocked this transaction',
    violations: verdict.violations.map((v) => ({
      section: v.section,
      invariant: v.invariant,
      detail: v.detail,
      severity: v.severity,
    })),
  };
}

export type { LiveMoneyContext, ConstitutionVerdict };
