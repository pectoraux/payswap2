/**
 * PaySwap Runtime — Transition.
 *
 * The atomic unit of execution. Every node in the Execution Graph is exactly
 * one Transition: a state change on a single entity. This makes replay trivial
 * — replay is just re-applying transitions in order.
 *
 *   Transition {
 *     from state, to state,    // state machine transition
 *     entity,                   // which entity changes
 *     command,                  // what triggered it
 *     preconditions,            // must be true before
 *     postconditions,           // must be true after
 *     rollback,                 // how to undo
 *     events                    // emitted when applied
 *   }
 */
import { uid } from './support';
import type { Capability } from './capabilities';

export interface Transition {
  id: string;
  entityId: string;
  entityType: string;
  command: string;           // what command triggered this transition
  capability: Capability;    // what capability is being exercised
  fromState: string;
  toState: string;
  amount?: number;
  currency?: string;
  preconditions: { entity: string; condition: string; met: boolean }[];
  postconditions: { entity: string; condition: string; met: boolean }[];
  rollback?: { entityId: string; action: string };
  events: { type: string; payload: Record<string, unknown> }[];
  status: 'pending' | 'applied' | 'rolled_back' | 'failed';
  frame?: number;
  meta?: Record<string, unknown>;
}

/** Factory: create a Transition. */
export function transition(params: {
  entityId: string;
  entityType: string;
  command: string;
  capability: Capability;
  fromState: string;
  toState: string;
  amount?: number;
  currency?: string;
  preconditions?: { entity: string; condition: string; met: boolean }[];
  postconditions?: { entity: string; condition: string; met: boolean }[];
  rollback?: { entityId: string; action: string };
  events?: { type: string; payload: Record<string, unknown> }[];
  frame?: number;
}): Transition {
  return {
    id: uid('tx'),
    entityId: params.entityId,
    entityType: params.entityType,
    command: params.command,
    capability: params.capability,
    fromState: params.fromState,
    toState: params.toState,
    amount: params.amount,
    currency: params.currency,
    preconditions: params.preconditions ?? [],
    postconditions: params.postconditions ?? [],
    rollback: params.rollback,
    events: params.events ?? [],
    status: 'pending',
    frame: params.frame,
  };
}

/** Verify a transition's preconditions are all met. */
export function verifyPreconditions(t: Transition): boolean {
  return t.preconditions.every((p) => p.met);
}

/** Verify a transition's postconditions after application. */
export function verifyPostconditions(t: Transition): boolean {
  return t.postconditions.every((p) => p.met);
}

/**
 * Build a sequence of Transitions from a desired world delta.
 * The solver produces these by querying capabilities — it never hardcodes
 * "debit reserve" or "draw LP". It asks: who canDebit? who canBridge?
 */
export function buildTransitionsForDelta(
  entities: { id: string; type: string; state: string; balance: number; capabilities: Record<string, boolean | undefined> }[],
  delta: { entityId: string; amount: number; command: string; capability: Capability; fromState: string; toState: string }[],
): Transition[] {
  return delta.map((d) => {
    const entity = entities.find((e) => e.id === d.entityId);
    return transition({
      entityId: d.entityId,
      entityType: entity?.type ?? 'unknown',
      command: d.command,
      capability: d.capability,
      fromState: d.fromState,
      toState: d.toState,
      amount: Math.abs(d.amount),
      currency: entity?.['currency' as keyof typeof entity] as string | undefined,
      preconditions: [
        { entity: d.entityId, condition: `${d.capability} === true`, met: entity?.capabilities[d.capability] === true },
        { entity: d.entityId, condition: `balance >= ${Math.abs(d.amount)}`, met: (entity?.balance ?? 0) >= Math.abs(d.amount) },
      ],
      postconditions: [
        { entity: d.entityId, condition: `state === ${d.toState}`, met: true },
      ],
      rollback: { entityId: d.entityId, action: `reverse ${d.command}` },
      events: [{ type: `${d.command}.${d.toState}`, payload: { entityId: d.entityId, amount: d.amount } }],
    });
  });
}
