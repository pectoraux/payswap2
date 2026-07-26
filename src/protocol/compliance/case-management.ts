/**
 * PaySwap Protocol — Compliance Case Management Service.
 *
 * Cases group related AML alerts, sanctions hits, KYC/KYB reviews, and
 * manual reviews into a single investigation workflow with an immutable
 * audit trail. Every state transition is logged and broadcast via the
 * kernel event bus.
 *
 * Lifecycle:
 *   open → investigating → escalated → closed
 *
 * Events emitted:
 *  - `compliance.case_created`
 *  - `compliance.case_assigned`
 *  - `compliance.case_status_changed`
 *  - `compliance.case_escalated`
 *  - `compliance.case_closed`
 */
import { uid, nowTs } from '@/kernel/support';
import { eventEngine } from '@/kernel/event';
import {
  ComplianceError,
  type Case,
  type CaseAuditEntry,
  type CaseStatus,
  type CaseType,
} from './types';

/** Input for `createCase`. */
export interface CreateCaseInput {
  type: CaseType;
  entityId: string;
  alertIds?: string[];
  assignedTo?: string;
  notes?: string;
}

/** Filter for `listCases`. */
export interface CaseFilter {
  type?: CaseType;
  status?: CaseStatus;
  entityId?: string;
  assignedTo?: string;
}

export class CaseService {
  private cases = new Map<string, Case>();

  // ------------------------------------------------------- createCase
  createCase(input: CreateCaseInput): Case {
    const id = uid('case');
    const ts = nowTs();
    const audit: CaseAuditEntry[] = [
      { ts, action: 'case_created', details: input.notes },
    ];
    const c: Case = {
      id,
      type: input.type,
      entityId: input.entityId,
      alertIds: input.alertIds ?? [],
      status: 'open',
      assignedTo: input.assignedTo,
      createdAt: ts,
      updatedAt: ts,
      auditTrail: audit,
    };
    this.cases.set(id, c);

    eventEngine.emit('compliance.case_created', {
      caseId: id,
      type: input.type,
      entityId: input.entityId,
      alertIds: c.alertIds,
      assignedTo: input.assignedTo,
    });

    if (input.assignedTo) {
      this.appendAudit(c, 'case_assigned', input.assignedTo);
      eventEngine.emit('compliance.case_assigned', { caseId: id, assignedTo: input.assignedTo });
    }
    return c;
  }

  // ------------------------------------------------------- assignCase
  assignCase(caseId: string, assignee: string): Case {
    const c = this.require(caseId);
    c.assignedTo = assignee;
    c.updatedAt = nowTs();
    this.appendAudit(c, 'case_assigned', assignee);
    eventEngine.emit('compliance.case_assigned', { caseId, assignedTo: assignee });
    return c;
  }

  // ------------------------------------------------------- updateStatus
  updateStatus(caseId: string, status: CaseStatus, resolution?: string): Case {
    const c = this.require(caseId);
    const previous = c.status;
    c.status = status;
    c.updatedAt = nowTs();
    if (resolution) c.resolution = resolution;
    this.appendAudit(c, 'case_status_changed', `${previous} → ${status}`, resolution);

    eventEngine.emit('compliance.case_status_changed', { caseId, previous, next: status, resolution });

    if (status === 'closed') {
      c.closedAt = nowTs();
      eventEngine.emit('compliance.case_closed', { caseId, resolution, closedAt: c.closedAt });
    }
    return c;
  }

  // ------------------------------------------------------- escalate
  escalate(caseId: string, reason?: string): Case {
    const c = this.require(caseId);
    c.status = 'escalated';
    c.updatedAt = nowTs();
    this.appendAudit(c, 'case_escalated', reason);
    eventEngine.emit('compliance.case_escalated', { caseId, reason });
    return c;
  }

  // ------------------------------------------------------- getCase
  getCase(id: string): Case | undefined {
    return this.cases.get(id);
  }

  // ------------------------------------------------------- listCases
  listCases(filter?: CaseFilter): Case[] {
    const all = [...this.cases.values()];
    return all.filter((c) => {
      if (filter?.type && c.type !== filter.type) return false;
      if (filter?.status && c.status !== filter.status) return false;
      if (filter?.entityId && c.entityId !== filter.entityId) return false;
      if (filter?.assignedTo && c.assignedTo !== filter.assignedTo) return false;
      return true;
    }).sort((a, b) => b.updatedAt - a.updatedAt);
  }

  /** Append a linked alert to an existing case. */
  linkAlert(caseId: string, alertId: string): Case {
    const c = this.require(caseId);
    if (!c.alertIds.includes(alertId)) {
      c.alertIds.push(alertId);
      c.updatedAt = nowTs();
      this.appendAudit(c, 'alert_linked', alertId);
    }
    return c;
  }

  // ------------------------------------------------------- helpers
  private require(caseId: string): Case {
    const c = this.cases.get(caseId);
    if (!c) {
      throw new ComplianceError('case.not_found', `Case ${caseId} not found`, { caseId });
    }
    return c;
  }

  private appendAudit(c: Case, action: string, actorOrDetails?: string, details?: string): void {
    const entry: CaseAuditEntry = {
      ts: nowTs(),
      action,
      ...(actorOrDetails !== undefined ? { actor: actorOrDetails } : {}),
      ...(details !== undefined ? { details } : {}),
    };
    c.auditTrail.push(entry);
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

const _globalForCase = globalThis as unknown as { __PAYSWAP_CASE_SERVICE?: CaseService };
export const caseService = _globalForCase.__PAYSWAP_CASE_SERVICE ?? new CaseService();
if (!_globalForCase.__PAYSWAP_CASE_SERVICE) _globalForCase.__PAYSWAP_CASE_SERVICE = caseService;
