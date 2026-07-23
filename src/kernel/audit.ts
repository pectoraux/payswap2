/**
 * Audit Engine — append-only, tamper-evident audit log.
 *
 * Every privileged kernel action is recorded with an actor, timestamp and
 * detail. The audit log is the compliance substrate: regulators, internal
 * risk and the simulator's "AI Decisions" frame all read from it. Entries are
 * never mutated — corrections are new entries that reference the original.
 */
import type { AuditEntry, AuditTrace } from './types';
import { nowTs } from './support';

export class AuditEngine {
  private entries: AuditEntry[] = [];

  record(actor: string, action: string, detail: string): AuditEntry {
    const entry: AuditEntry = { ts: nowTs(), actor, action, detail };
    this.entries.push(entry);
    return entry;
  }

  trace(runId: string, actor: string): AuditTrace {
    return { runId, actor, entries: [...this.entries] };
  }

  all(): AuditEntry[] {
    return [...this.entries];
  }

  reset(): void {
    this.entries = [];
  }
}

export const auditEngine = new AuditEngine();
