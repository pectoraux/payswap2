/**
 * WalletBackfillService — bridges legacy Prisma wallets into the runtime
 * WalletProjection. (M-RT-23, Wallet Capability Migration.)
 *
 * Uses the generic BackfillEngine<T> from the migration framework (M-RT-19).
 * This is a thin wrapper — NOT bespoke batching code. The framework handles
 * batching, idempotence, progress tracking, and error capture.
 */

import { db } from '@/lib/db';
import type { WalletsService } from './service';
import type { Environment } from '../../types';
import type { PrismaWalletRow } from './types';
import {
  BackfillEngine,
  type BackfillResult,
} from '../../migration';

export interface WalletBackfillInputs {
  walletsService: WalletsService;
  environment: Environment;
  correlationPrefix: string;
}

export class WalletBackfillService {
  private readonly engine: BackfillEngine<PrismaWalletRow>;

  constructor(private inputs: WalletBackfillInputs) {
    this.engine = new BackfillEngine<PrismaWalletRow>({
      name: 'wallets',
      countFn: () => db.wallet.count(),
      listFn: (skip, take) =>
        db.wallet.findMany({
          orderBy: { createdAt: 'asc' },
          skip,
          take,
        }) as Promise<PrismaWalletRow[]>,
      recordFn: (row) =>
        inputs.walletsService.recordWallet({
          walletId: row.id,
          accountId: row.accountId,
          name: row.name,
          currency: row.currency,
          balance: row.balance,
          pendingBalance: row.pendingBalance,
          lockedBalance: row.lockedBalance,
          isDefault: row.isDefault,
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
      db.wallet.count(),
      this.inputs.walletsService.count(),
    ]);
    return {
      prismaCount,
      projectionCount,
      backfilled: projectionCount >= prismaCount && prismaCount > 0,
    };
  }
}
