/**
 * The ten Architectural Principles — encoded as data so they can be rendered
 * in docs, verified in CI, and cited in code review.
 *
 * From PROTOCOL-RUNTIME-ARCHITECTURE.md → "Architectural Principles".
 * These are the constitution for every future milestone.
 */

export interface Principle {
  number: number;
  name: string;
  statement: string;
}

export const ARCHITECTURAL_PRINCIPLES: readonly Principle[] = [
  {
    number: 1,
    name: 'Runtime First',
    statement:
      'No UI, API route, extension, AI agent, CLI, simulator, or mobile app may implement business logic. Everything enters through the Runtime.',
  },
  {
    number: 2,
    name: 'Intent Before Execution',
    statement:
      'No financial operation executes directly. Everything begins as a typed Intent.',
  },
  {
    number: 3,
    name: 'Explainability by Default',
    statement:
      'Every state transition, decision, policy evaluation, optimization, and settlement must be explainable. If it cannot be explained, it should not execute.',
  },
  {
    number: 4,
    name: 'One Runtime',
    statement:
      'Sandbox and Live are different worlds running the same runtime. Only data, connectors, credentials, and clock differ.',
  },
  {
    number: 5,
    name: 'Event Truth',
    statement:
      'Events are immutable. Read models are disposable. The runtime can always rebuild itself.',
  },
  {
    number: 6,
    name: 'Deterministic Replay',
    statement:
      'Given the same events, policies, clock, and runtime version, replay must produce identical results.',
  },
  {
    number: 7,
    name: 'Simulation Is Production',
    statement:
      'The simulator is simply another runtime client. There are no simulator-only code paths.',
  },
  {
    number: 8,
    name: 'Economic Safety',
    statement:
      'Money invariants override feature correctness. If financial integrity and availability conflict, integrity wins.',
  },
  {
    number: 9,
    name: 'Everything Is Inspectable',
    statement:
      'Every object must expose: history, decisions, policies, relationships, events, execution trace.',
  },
  {
    number: 10,
    name: 'Runtime Over Features',
    statement:
      'Whenever a design choice exists between adding another screen or strengthening the runtime, the runtime wins.',
  },
  {
    number: 11,
    name: 'Continuous Optimization',
    statement:
      'The Runtime continuously optimizes the global financial network while executing. Execution and optimization are equally important; the Runtime improves the network it runs on. (Amendment 1)',
  },
  {
    number: 12,
    name: 'Economic Operating System',
    statement:
      'Liquidity is not just execution capacity — it is an evolving market the Runtime continuously improves. The Runtime has two simultaneous responsibilities: (1) execute today\'s payment optimally, and (2) improve tomorrow\'s liquidity network. It discovers new economic opportunities and helps every participant (LPs, treasury, merchants) become more profitable. (Amendment 2)',
  },
] as const;

export const PRINCIPLE_NAMES = ARCHITECTURAL_PRINCIPLES.map((p) => p.name);
