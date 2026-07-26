/**
 * Intent Engine — the universal entry. (Vocabulary: Intent.)
 *
 * Flow: MerchantIntent → normalize → resolve → validate → augment → TypedIntent
 *
 * Each step is an overridable hook. M-RT-1 ships no-op defaults so the
 * skeleton dispatches any intent kind. M-RT-2 registers real payment hooks
 * (resolve customer, validate amount, augment with merchant tier + evidence).
 */

import type { RequestContext } from '../types';
import { uid } from '../types';
import type { RuntimeClock } from '../clock';
import type {
  IntentValidationResult,
  MerchantIntent,
  NormalizedIntent,
  ResolvedIntent,
  TypedIntent,
} from './types';
import { IntentValidationError } from './types';

/** Hooks an intent kind can register. All optional — defaults are no-ops. */
export interface IntentHooks {
  normalize?(n: NormalizedIntent, ctx: RequestContext): NormalizedIntent;
  resolve?(r: ResolvedIntent, ctx: RequestContext): Promise<ResolvedIntent> | ResolvedIntent;
  validate?(r: ResolvedIntent, ctx: RequestContext): IntentValidationResult;
  augment?(t: TypedIntent, ctx: RequestContext): TypedIntent;
}

export class IntentEngine {
  private hooksByKind: Map<string, IntentHooks> = new Map();

  constructor(private clock: RuntimeClock) {}

  /** Register hooks for an intent kind. */
  register(kind: string, hooks: IntentHooks): void {
    this.hooksByKind.set(kind, hooks);
  }

  /** Ingest a raw merchant intent and produce a TypedIntent. */
  async ingest(raw: MerchantIntent, ctx: RequestContext): Promise<TypedIntent> {
    const hooks = this.hooksByKind.get(raw.kind) ?? {};

    // 1. Normalize — canonicalize amounts, currencies, casing.
    let normalized: NormalizedIntent = { kind: raw.kind, data: { ...raw.raw } };
    if (hooks.normalize) normalized = hooks.normalize(normalized, ctx);

    // 2. Resolve — turn references into concrete IDs.
    let resolved: ResolvedIntent = { kind: normalized.kind, data: normalized.data, resolved: {} };
    if (hooks.resolve) resolved = await hooks.resolve(resolved, ctx);

    // 3. Validate — schema + business invariants.
    if (hooks.validate) {
      const result = hooks.validate(resolved, ctx);
      if (!result.valid) throw new IntentValidationError(result);
    }

    // 4. Augment — attach evidence, context, constraints.
    let typed: TypedIntent = {
      id: uid('intent'),
      kind: resolved.kind,
      actor: ctx.actor,
      environment: ctx.environment,
      subject: resolved.resolved,
      desired: resolved.data,
      constraints: {},
      evidence: [],
      correlationId: ctx.correlationId,
      causationId: ctx.causationId,
      source: ctx.source,
      createdAt: this.clock.now(),
    };
    if (hooks.augment) typed = hooks.augment(typed, ctx);

    return typed;
  }
}
