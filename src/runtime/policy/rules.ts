/**
 * Real Policy Rules — registered on the DefaultPolicyEngine so the planner's
 * `case 'policy'` stage evaluates actual rules instead of the unconditional
 * `default.allow` skeleton. (P2-3 / C-3.)
 *
 * Each rule is DATA (stored, versioned, auditable via `engine.rules()`).
 * First-match-wins — explicit rules are inserted before `default.allow`.
 *
 * Rules registered:
 *   - `cmp.sanctions_screen`  (DENY)  — actor on a sanctions list.
 *   - `risk.amount_cap`       (DENY)  — per-transaction amount above 10_000_000.
 *
 * The rules intentionally read from the same singletons the live API path
 * uses (`sanctionsService`), so a payout blocked at the policy stage and a
 * payout blocked at the constitution stage see the same answer.
 */
import type { PolicyEngine, PolicyContext } from './types';
import { sanctionsService } from '@/protocol/compliance/sanctions';

/** Per-transaction hard cap (matches `cmp-tx-limit` in the Constitution). */
const TX_AMOUNT_CAP = 10_000_000;

/**
 * Register the real policy rules on the engine. Idempotent — checks whether
 * a rule with the same id is already registered before inserting. Safe to
 * call multiple times across hot-reloads.
 */
export function registerRealPolicyRules(engine: PolicyEngine): void {
  const existing = new Set(engine.rules().map((r) => r.id));

  // ── 1. Sanctions screen ──────────────────────────────────────────────────
  // DENY if the actor has any active sanctions hit. We re-screen on every
  // evaluation so newly-loaded list entries take effect immediately. The
  // in-memory sample list makes this < 1ms.
  //
  // Screening uses `desired.name` if provided (the human-readable actor
  // name from the command payload — e.g., the customer's full name on a
  // payout), otherwise falls back to `actor.id` (an opaque identifier).
  // The actor.id is also screened as a fallback so an entity registered
  // directly under an id matching a sanctions name is still caught.
  if (!existing.has('cmp.sanctions_screen')) {
    engine.register({
      id: 'cmp.sanctions_screen',
      name: 'Sanctions Screening',
      when: (ctx: PolicyContext) => {
        const actorId = ctx.actor?.id;
        if (!actorId) return false;
        const desiredName = typeof ctx.desired?.name === 'string' ? ctx.desired.name : actorId;
        // Re-screen using the human-readable name (primary) + the actor
        // id (fallback). Both populate hits for any matching sanctioned
        // entity; subsequent isClear() calls reflect the result.
        sanctionsService.screenEntity(actorId, desiredName);
        if (desiredName !== actorId) {
          sanctionsService.screenEntity(actorId, actorId);
        }
        return !sanctionsService.isClear(actorId);
      },
      then: 'DENY',
      reason: 'Actor is on a sanctions list (OFAC/EU/UN/UK HMT/custom).',
      scope: 'both',
    });
  }

  // ── 2. Per-transaction amount cap ────────────────────────────────────────
  // DENY if the desired amount exceeds the platform-wide per-transaction
  // limit. Matches `cmp-tx-limit` in the Constitution (10,000,000).
  if (!existing.has('risk.amount_cap')) {
    engine.register({
      id: 'risk.amount_cap',
      name: 'Per-Transaction Amount Cap',
      when: (ctx: PolicyContext) => {
        const amt = Number(ctx.desired?.amount);
        return Number.isFinite(amt) && amt > TX_AMOUNT_CAP;
      },
      then: 'DENY',
      reason: `Transaction amount exceeds per-transaction cap of ${TX_AMOUNT_CAP}.`,
      scope: 'both',
    });
  }
}
