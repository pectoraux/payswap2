/**
 * Migration Framework — barrel. (M-RT-19, Capability Migration Framework.)
 *
 * Public surface:
 *   - BackfillEngine<T>             — generic batch importer
 *   - ProjectionVerifier            — 6 automated correctness checks
 *   - ProjectionCheckpoint          — snapshot + incremental replay
 *   - ProjectionMigrationRunner     — orchestrates backfill → verify → report
 *   - ProjectionHealthRegistry      — collects health from every projection
 *
 * Every migrated capability (payments, refunds, payouts, invoices, wallets,
 * treasury, LPs) uses this framework. The capability provides:
 *   - types.ts        — View + event payloads + event types
 *   - projection.ts   — Projection (implements the Projection interface)
 *   - service.ts      — Service (read model + writer)
 *   - backfill.ts     — BackfillEngine<PrismaRow> (using the framework)
 *
 * The framework provides everything else.
 */

export * from './types';
export { BackfillEngine } from './backfill-engine';
export { ProjectionVerifier } from './projection-verifier';
export type { VerificationInputs } from './projection-verifier';
export { ProjectionCheckpoint } from './projection-checkpoint';
export type { CheckpointableProjection } from './projection-checkpoint';
export { ProjectionMigrationRunner } from './projection-migration-runner';
export type { MigrationReport } from './projection-migration-runner';
export { ProjectionHealthRegistry } from './health-registry';
export type { HealthProvider } from './health-registry';
