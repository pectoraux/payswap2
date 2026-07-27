# PaySwap Runtime

> **Every financial intent becomes an explainable execution.**

The Runtime is the product. Every client — Merchant Dashboard, Admin,
Digital Twin, Developer SDK, CLI, Extensions, AI Agents, Mobile, Public API
— enters through `dispatch()`. There is no other write path.

This is **M-RT-1: the Runtime Skeleton**. No business logic. Just the spine:
RuntimeClock, IntentEngine, 14-stage Pipeline scaffold, in-memory EventStore
(with optimistic concurrency), Decision/Policy/Inspector interfaces, and the
ProjectionRunner. Dispatching any intent flows through all stages, appends
real events, and produces a real trace — proving the architecture end-to-end.

See `PROTOCOL-RUNTIME-ARCHITECTURE.md` for the full design (frozen v1
Runtime Constitution: 10 Architectural Principles + frozen Vocabulary).

## Quick start

```ts
import { dispatch } from '@/runtime';

const result = await dispatch(
  { kind: 'payment', raw: { customer: 'Alice', amount: 120, currency: 'USD' } },
  {
    actor: { id: 'usr_1', role: 'merchant', orgId: 'org_1' },
    environment: 'sandbox',
    source: 'dashboard',
  },
);

console.log(result.status);        // 'completed'
console.log(result.trace.stages);  // 15 TraceNodes (stages 0-14)
console.log(result.events);        // Domain + Runtime events appended
```

## Structure

```
src/runtime/
├── index.ts              # Runtime singleton + dispatch() + createRuntime()
├── types.ts              # Environment, Actor, RequestContext, uid, ...
├── principles.ts         # The 10 Architectural Principles (as data)
├── vocabulary.ts         # The frozen Runtime Vocabulary (as data)
├── clock/                # RuntimeClock — live 1× + virtual 10×/100×/1000×
├── events/               # EventStore (in-memory, OCC) + Domain/Runtime events
├── decisions/            # Decision — the universal explainability record
├── intent/               # IntentEngine — ingest→normalize→resolve→validate→augment
├── policy/               # PolicyEngine — explicit, evaluable rules
├── pipeline/             # 14-stage Pipeline scaffold (the spine)
├── read-models/          # Projection + ReadModel interfaces + ProjectionRunner
└── inspector/            # TraceNode + ExecutionTrace + TraceBuilder
```

## The 14-stage pipeline

```
0.  ingest                 ┐
1.  normalize              │  Intent Engine
2.  resolve                │  (IntentEngine.ingest)
3.  validate & augment     ┘
4.  policy                 ┐
5.  risk & fraud           │
6.  treasury & reserve     │
7.  liquidity market       │
8.  settlement planning    │  Execution
9.  execution              │  (registrable stage handlers)
10. ledger                 │
11. event emission         │
12. projection             │
13. notifications          │
14. analytics + inspection ┘
```

M-RT-1: stages 4-14 default to no-op 'continue'. M-RT-2 registers real
payment handlers.

## Milestones

| Milestone | Status | Goal |
|---|---|---|
| M-RT-1 Runtime Skeleton | ✅ this | Spine + interfaces, no business logic |
| M-RT-2 One Vertical Slice | next | Payments end-to-end through the runtime |
| M-RT-3 Simulator Integration | — | Twin emits Payment Intents |
| M-RT-4+ Capability Migration | — | refunds → payouts → invoices → ... |

## Principles (the constitution)

1. Runtime First · 2. Intent Before Execution · 3. Explainability by Default ·
4. One Runtime · 5. Event Truth · 6. Deterministic Replay · 7. Simulation Is
Production · 8. Economic Safety · 9. Everything Is Inspectable · 10. Runtime
Over Features.
