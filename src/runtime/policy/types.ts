/**
 * Policy Engine — explicit, evaluable rules that gate execution.
 * (Principle 3 + Vocabulary: Policy.)
 *
 * At pipeline stage 4 (policy), every intent is evaluated against a rule
 * set. Rules are DATA (stored, versioned, auditable), not hardcoded
 * branches. Enterprise customers can later bring their own policy sets.
 */

import type { Environment } from '../types';

export type PolicyAction = 'ALLOW' | 'DENY' | 'REQUIRE_APPROVAL';

export interface PolicyContext {
  intentKind: string;
  actor: { id: string; role: string; orgId?: string };
  environment: Environment;
  desired: Record<string, unknown>;
}

export interface PolicyRule {
  id: string;
  name: string;
  /** Returns true when this rule applies. */
  when: (ctx: PolicyContext) => boolean;
  /** The action to take when `when` is true. */
  then: PolicyAction;
  /** Human-readable reason (rendered in the Inspector). */
  reason: string;
  scope: Environment | 'both';
}

export interface PolicyDecision {
  action: PolicyAction;
  ruleId: string | null;
  reason: string;
}

export interface PolicyEngine {
  /** Evaluate the policy set for a context. First matching rule wins. */
  evaluate(ctx: PolicyContext): Promise<PolicyDecision>;
  /** Register a rule. */
  register(rule: PolicyRule): void;
  /** All registered rules (for inspection). */
  rules(): readonly PolicyRule[];
}

/**
 * DefaultPolicyEngine — first-match-wins. A default ALLOW rule is always
 * present (so the skeleton dispatches without explicit rules). M-RT-3 will
 * add the real rule set.
 */
export class DefaultPolicyEngine implements PolicyEngine {
  private ruleList: PolicyRule[] = [];

  constructor() {
    // Default: allow everything. Replaced by real rules in later milestones.
    this.ruleList.push({
      id: 'default.allow',
      name: 'Default Allow',
      when: () => true,
      then: 'ALLOW',
      reason: 'No policy rules registered — default allow (M-RT-1 skeleton).',
      scope: 'both',
    });
  }

  register(rule: PolicyRule): void {
    // Insert before the default allow so explicit rules win.
    this.ruleList.splice(this.ruleList.length - 1, 0, rule);
  }

  async evaluate(ctx: PolicyContext): Promise<PolicyDecision> {
    for (const rule of this.ruleList) {
      if (rule.scope !== 'both' && rule.scope !== ctx.environment) continue;
      if (rule.when(ctx)) {
        return { action: rule.then, ruleId: rule.id, reason: rule.reason };
      }
    }
    return { action: 'DENY', ruleId: null, reason: 'No matching policy rule.' };
  }

  rules(): readonly PolicyRule[] {
    return this.ruleList;
  }
}
