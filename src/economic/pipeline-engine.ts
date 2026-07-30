/**
 * Economic Composition Engine — Pipeline Engine.
 *
 * Compiles declarative pipelines (YAML-like step lists) into executable runners
 * and executes them against the economic store. Each step can mint/burn/consume/
 * transfer tokens, publish events (which trigger further pipelines → cascading
 * composition), or notify subscribers.
 *
 * Executions are fully traced so the dashboard can show per-step results.
 */

import { uid } from '@/runtime/types';
import { store, economicEngine, resolveTemplate } from './store';
import type {
  TokenPipeline, PipelineStep, PipelineExecution, PipelineStepResult,
  EconomicEvent, HolderType,
} from './types';

/**
 * Execute a single pipeline against a triggering event. Each step runs
 * sequentially. Steps that publish events may trigger other pipelines
 * (cascading composition) — the cascade depth is tracked and bounded by the
 * store's MAX_CASCADE_DEPTH guard.
 */
export function executePipeline(
  pipeline: TokenPipeline,
  triggerEvent: EconomicEvent,
  cascadeDepth: number,
): PipelineExecution {
  const startedAt = Date.now();
  const steps: PipelineStepResult[] = [];

  // Build the template context: the triggering event payload + metadata.
  const ctx: Record<string, unknown> = {
    event: { type: triggerEvent.type, source: triggerEvent.source, payload: triggerEvent.payload, ts: triggerEvent.ts },
    payload: triggerEvent.payload,
  };

  // Mark pipeline as executing.
  pipeline.executions++;
  pipeline.lastExecutedAt = startedAt;

  let failed = false;

  for (let i = 0; i < pipeline.steps.length; i++) {
    const step = pipeline.steps[i];
    const stepStart = Date.now();
    try {
      const result = runStep(step, ctx, pipeline.id);
      steps.push({
        stepIndex: i,
        action: step.action,
        label: step.label,
        status: result.status,
        detail: result.detail,
        ts: stepStart,
      });
      if (result.status === 'FAILED') {
        failed = true;
        // subsequent steps still attempted but marked skipped if they depend on tokens
      }
    } catch (err) {
      steps.push({
        stepIndex: i,
        action: step.action,
        label: step.label,
        status: 'FAILED',
        detail: err instanceof Error ? err.message : 'Unknown error',
        ts: stepStart,
      });
      failed = true;
    }
  }

  const completedAt = Date.now();
  if (failed) pipeline.failures++;
  else pipeline.successes++;

  return {
    id: uid('ecoexec'),
    pipelineId: pipeline.id,
    pipelineName: pipeline.name,
    trigger: pipeline.trigger,
    triggerEvent: {
      type: triggerEvent.type,
      source: triggerEvent.source,
      payload: triggerEvent.payload,
      ts: triggerEvent.ts,
    },
    steps,
    status: failed ? 'FAILED' : 'COMPLETED',
    startedAt,
    completedAt,
    durationMs: completedAt - startedAt,
    cascadeDepth,
  };
}

interface StepResult { status: 'SUCCESS' | 'FAILED' | 'SKIPPED'; detail: string; }

function runStep(step: PipelineStep, ctx: Record<string, unknown>, pipelineId: string): StepResult {
  switch (step.action) {
    case 'mint': {
      const amount = resolveTemplate(step.amount, ctx);
      if (amount <= 0) return { status: 'FAILED', detail: `mint amount resolved to ${amount}` };
      const target = step.target ? resolveTemplateStr(step.target, ctx) : '';
      if (!target) return { status: 'FAILED', detail: 'mint target not resolved' };
      const targetType = (step.targetType ?? 'CUSTOMER') as HolderType;
      const label = holderLabel(target, targetType);
      const token = store.tokens.get(step.token!);
      if (!token) return { status: 'FAILED', detail: `unknown token ${step.token}` };
      economicEngine.mint(step.token!, target, targetType, label, amount, `pipeline:${pipelineId}`, token.issuer, pipelineId);
      return { status: 'SUCCESS', detail: `minted ${amount} ${token.symbol} → ${label}` };
    }
    case 'burn': {
      const amount = resolveTemplate(step.amount, ctx);
      const from = step.target ? resolveTemplateStr(step.target, ctx) : '';
      if (!from) return { status: 'FAILED', detail: 'burn source not resolved' };
      const token = store.tokens.get(step.token!);
      if (!token) return { status: 'FAILED', detail: `unknown token ${step.token}` };
      try {
        economicEngine.burn(step.token!, from, amount, `pipeline:${pipelineId}`, token.issuer);
        return { status: 'SUCCESS', detail: `burned ${amount} ${token.symbol} from ${from}` };
      } catch (e) {
        return { status: 'FAILED', detail: e instanceof Error ? e.message : 'burn failed' };
      }
    }
    case 'consume': {
      const amount = resolveTemplate(step.amount, ctx) || 1;
      const from = step.target ? resolveTemplateStr(step.target, ctx) : (ctx.payload as { merchantId?: string; customerId?: string; userId?: string })?.merchantId ?? (ctx.payload as { customerId?: string })?.customerId ?? (ctx.payload as { userId?: string })?.userId ?? '';
      if (!from) return { status: 'SKIPPED', detail: 'no holder to consume from' };
      const token = store.tokens.get(step.token!);
      if (!token) return { status: 'FAILED', detail: `unknown token ${step.token}` };
      try {
        economicEngine.consume(step.token!, from, amount, `pipeline:${pipelineId}`, token.issuer, pipelineId);
        return { status: 'SUCCESS', detail: `consumed ${amount} ${token.symbol} from ${from}` };
      } catch (e) {
        return { status: 'FAILED', detail: e instanceof Error ? e.message : 'consume failed' };
      }
    }
    case 'transfer': {
      const amount = resolveTemplate(step.amount, ctx);
      const from = step.target ? resolveTemplateStr(step.target, ctx) : '';
      const to = step.target ? resolveTemplateStr(step.target, ctx) : '';
      if (!from || !to) return { status: 'FAILED', detail: 'transfer parties not resolved' };
      const token = store.tokens.get(step.token!);
      if (!token) return { status: 'FAILED', detail: `unknown token ${step.token}` };
      try {
        economicEngine.transfer(step.token!, from, to, (step.targetType ?? 'CUSTOMER') as HolderType, to, amount, `pipeline:${pipelineId}`, token.issuer);
        return { status: 'SUCCESS', detail: `transferred ${amount} ${token.symbol}` };
      } catch (e) {
        return { status: 'FAILED', detail: e instanceof Error ? e.message : 'transfer failed' };
      }
    }
    case 'publish': {
      const eventType = step.event!;
      const payload = resolvePayload(step.payload, ctx);
      economicEngine.publishEvent(eventType, `pipeline:${pipelineId}`, payload);
      return { status: 'SUCCESS', detail: `published ${eventType}` };
    }
    case 'notify': {
      const eventType = step.event!;
      const payload = resolvePayload(step.payload, ctx);
      // notify = publish but marked as a side-channel notification (analytics, ops)
      economicEngine.publishEvent(eventType, `notify:${pipelineId}`, payload);
      return { status: 'SUCCESS', detail: `notified ${eventType}` };
    }
    case 'wait': {
      return { status: 'SUCCESS', detail: 'waited (simulated)' };
    }
    case 'condition': {
      const cond = step.condition ?? 'true';
      const ok = evalCondition(cond, ctx);
      return { status: ok ? 'SUCCESS' : 'SKIPPED', detail: ok ? `condition passed: ${cond}` : `condition failed: ${cond}` };
    }
    default:
      return { status: 'FAILED', detail: `unknown action ${step.action}` };
  }
}

function resolveTemplateStr(expr: string, ctx: Record<string, unknown>): string {
  if (!expr) return '';
  const m = expr.match(/^\$\{([^}]+)\}$/);
  if (m) {
    const path = m[1].split('.');
    let val: unknown = ctx;
    for (const p of path) val = (val as Record<string, unknown>)?.[p];
    return val === undefined || val === null ? '' : String(val);
  }
  return expr;
}

function resolvePayload(payload: Record<string, unknown> | undefined, ctx: Record<string, unknown>): Record<string, unknown> {
  if (!payload) return {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(payload)) {
    if (typeof v === 'string' && v.startsWith('${') && v.endsWith('}')) {
      out[k] = resolveTemplateStr(v, ctx);
    } else {
      out[k] = v;
    }
  }
  return out;
}

function evalCondition(cond: string, ctx: Record<string, unknown>): boolean {
  // Very small condition evaluator: supports 'payload.key == value' and 'payload.key != value'
  const eq = cond.match(/^(\S+)\s*==\s*(.+)$/);
  if (eq) {
    const left = resolveTemplateStr(eq[1].startsWith('${') ? eq[1] : '${' + eq[1] + '}', ctx);
    let right = eq[2].trim();
    if ((right.startsWith("'") && right.endsWith("'")) || (right.startsWith('"') && right.endsWith('"'))) right = right.slice(1, -1);
    return left === right;
  }
  const neq = cond.match(/^(\S+)\s*!=\s*(.+)$/);
  if (neq) {
    const left = resolveTemplateStr(neq[1].startsWith('${') ? neq[1] : '${' + neq[1] + '}', ctx);
    let right = neq[2].trim();
    if ((right.startsWith("'") && right.endsWith("'")) || (right.startsWith('"') && right.endsWith('"'))) right = right.slice(1, -1);
    return left !== right;
  }
  return cond === 'true';
}

function holderLabel(id: string, type: HolderType): string {
  if (type === 'TREASURY') return 'Treasury Reserve';
  if (type === 'LP') return 'LP Pool';
  if (type === 'EXTENSION') {
    const ext = store.extensions.get(id);
    return ext?.name ?? id;
  }
  return id;
}
