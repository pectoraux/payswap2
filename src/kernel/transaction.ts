/**
 * Transaction Engine — orchestrates a single value transfer end-to-end.
 *
 * A Transaction is the unit of work that walks through the kernel:
 * intent -> authorize -> route -> settle -> finalize. It coordinates the
 * ledger, reserve, liquidity, twin-token and settlement engines so that a
 * payment either fully settles or fully rolls back (no partial state).
 */
import type { SimulationScenario } from './types';
import { uid } from './support';
import { eventEngine } from './event';

export type TransactionState =
  | 'initiated'
  | 'authorized'
  | 'routed'
  | 'settling'
  | 'settled'
  | 'failed'
  | 'rolled-back';

export interface KernelTransaction {
  id: string;
  scenario: SimulationScenario;
  state: TransactionState;
  startedAt: number;
  settledAt: number | null;
  frames: number;
}

export class TransactionEngine {
  begin(scenario: SimulationScenario): KernelTransaction {
    const tx: KernelTransaction = {
      id: uid('tx'),
      scenario,
      state: 'initiated',
      startedAt: Date.now(),
      settledAt: null,
      frames: 0,
    };
    eventEngine.emit('transaction.initiated', { txId: tx.id, scenario }, 0);
    return tx;
  }

  transition(tx: KernelTransaction, next: TransactionState, frame: number): void {
    const prev = tx.state;
    tx.state = next;
    if (next === 'settled') {
      tx.settledAt = Date.now();
      tx.frames = frame;
    }
    eventEngine.emit(
      'transaction.transition',
      { txId: tx.id, from: prev, to: next, frame },
      frame,
    );
  }
}
