/**
 * BackfillEngine<T> — generic batch import from a legacy Prisma table into
 * the runtime EventStore. (M-RT-19, Capability Migration Framework.)
 *
 * Every migrated capability (payments, refunds, payouts, invoices, wallets,
 * treasury, LPs) uses this engine. The capability provides:
 *   - countFn: how many rows are in Prisma
 *   - listFn: read a batch of rows from Prisma
 *   - recordFn: emit a domain event for one row (idempotent)
 *
 * The engine handles:
 *   - Batching (default 100 rows per batch)
 *   - Progress tracking (newlyImported / alreadyImported / failed)
 *   - Error capture (up to 20 errors, full count in `failed`)
 *   - Duration measurement
 *
 * IDEMPOTENCE: the engine itself is stateless. Idempotence comes from
 * recordFn — it MUST return false (not throw) when the row was already
 * imported. The standard pattern is: check `eventStore.streamVersion(streamId)`
 * before appending; if the stream exists, return false.
 *
 * USAGE:
 *   const engine = new BackfillEngine<PrismaRefund>({
 *     name: 'refunds',
 *     countFn: () => db.refund.count(),
 *     listFn: (skip, take) => db.refund.findMany({ skip, take, orderBy: { createdAt: 'asc' } }),
 *     recordFn: (r) => refundsService.recordRefund({ ...r }),
 *   });
 *   const result = await engine.run();
 */

import type { BackfillInputs, BackfillResult } from './types';

/** Default batch size — balances Prisma query overhead vs. memory. */
const DEFAULT_BATCH_SIZE = 100;

/** Maximum errors to capture in the result (rest are counted in `failed`). */
const MAX_ERRORS_CAPTURED = 20;

/**
 * BackfillEngine<T> — generic, capability-agnostic batch importer.
 *
 * The engine is reusable: instantiate once per capability. Calling run()
 * multiple times is safe — idempotence is the responsibility of recordFn.
 */
export class BackfillEngine<T> {
  private readonly name: string;
  private readonly countFn: () => Promise<number>;
  private readonly listFn: (skip: number, take: number) => Promise<T[]>;
  private readonly recordFn: (row: T) => Promise<boolean>;
  private readonly batchSize: number;

  constructor(inputs: BackfillInputs<T>) {
    this.name = inputs.name;
    this.countFn = inputs.countFn;
    this.listFn = inputs.listFn;
    this.recordFn = inputs.recordFn;
    this.batchSize = inputs.batchSize ?? DEFAULT_BATCH_SIZE;
  }

  /**
   * Run a full backfill: read ALL rows from the legacy Prisma table, call
   * recordFn for each. Idempotent — already-imported rows are skipped
   * (recordFn returns false).
   *
   * Returns a BackfillResult with counts + duration.
   */
  async run(): Promise<BackfillResult> {
    const start = Date.now();
    const errors: string[] = [];
    let newlyImported = 0;
    let alreadyImported = 0;
    let failed = 0;

    const totalInPrisma = await this.countFn();

    // Read in batches to avoid loading everything into memory at once.
    let skip = 0;
    while (skip < totalInPrisma) {
      const batch = await this.listFn(skip, this.batchSize);

      for (const row of batch) {
        try {
          const wasNew = await this.recordFn(row);
          if (wasNew) {
            newlyImported++;
          } else {
            alreadyImported++;
          }
        } catch (err) {
          failed++;
          if (errors.length < MAX_ERRORS_CAPTURED) {
            const msg = err instanceof Error ? err.message : String(err);
            errors.push(`${this.name} row: ${msg}`);
          }
        }
      }

      skip += this.batchSize;
    }

    return {
      totalInPrisma,
      newlyImported,
      alreadyImported,
      failed,
      errors,
      durationMs: Date.now() - start,
    };
  }

  /** Capability name (for logging / health). */
  getName(): string {
    return this.name;
  }
}
