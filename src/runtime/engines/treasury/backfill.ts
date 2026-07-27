/**
 * TreasuryBackfillService — bridges legacy Prisma data into the runtime
 * TreasuryProjection. (M-RT-24, Treasury Kernel.)
 *
 * Uses BackfillEngine<T> from the migration framework (M-RT-19).
 *
 * Since there's no single "Treasury" Prisma table, the backfill synthesizes
 * treasury accounts from multiple sources:
 *   - LPProfile → LP positions
 *   - Existing reserve data → reserve accounts
 *
 * For M-RT-24, we backfill from LPProfile (the most direct source of
 * treasury-like data). Future milestones can add more sources.
 */

import { db } from '@/lib/db';
import type { TreasuryService } from './service';
import type { Environment } from '../../types';
import type { AccountKind, PrismaTreasuryRow } from './types';
import {
  BackfillEngine,
  type BackfillResult,
} from '../../migration';

export interface TreasuryBackfillInputs {
  treasuryService: TreasuryService;
  environment: Environment;
  correlationPrefix: string;
}

export class TreasuryBackfillService {
  private readonly engine: BackfillEngine<PrismaTreasuryRow>;

  constructor(private inputs: TreasuryBackfillInputs) {
    // For M-RT-24, we backfill from LPProfile (synthesizing LP position accounts).
    // Each LP profile becomes a treasury account of kind 'lp_position'.
    this.engine = new BackfillEngine<PrismaTreasuryRow>({
      name: 'treasury',
      countFn: () => db.lPProfile.count(),
      listFn: (skip, take) =>
        db.lPProfile.findMany({
          orderBy: { createdAt: 'asc' },
          skip,
          take,
        }) as Promise<unknown[]> as Promise<PrismaTreasuryRow[]>,
      recordFn: (row) =>
        inputs.treasuryService.recordAccount({
          accountId: row.id,
          kind: 'lp_position' as AccountKind,
          ownerId: row.id,
          currency: 'USD',
          balance: 0, // LP profiles don't have a direct balance; positions are opened separately
          reservedBalance: 0,
          reference: row.id,
          createdAt: row.createdAt.getTime(),
          environment: inputs.environment,
          correlationId: `${inputs.correlationPrefix}_${row.id}`,
        }),
    });
  }

  async run(): Promise<BackfillResult> {
    return this.engine.run();
  }

  async status(): Promise<{ prismaCount: number; projectionCount: number; backfilled: boolean }> {
    const [prismaCount, projectionCount] = await Promise.all([
      db.lPProfile.count(),
      this.inputs.treasuryService.count(),
    ]);
    return {
      prismaCount,
      projectionCount,
      backfilled: projectionCount >= prismaCount && prismaCount > 0,
    };
  }
}
