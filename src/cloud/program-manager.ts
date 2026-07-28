/**
 * PaySwap Cloud — Program Manager. (M-CLOUD-44.)
 *
 * A Cloud Program is an initiative within a tenant (e.g. "Ghana Expansion",
 * "Mobile Money Pilot"). Programs group deployments, dashboards, and
 * extensions around a single business goal.
 */

import type { CloudProgram, CloudProgramStatus } from './types';
import { store, ids } from './store';
import { cloudAudit } from './audit';

export interface CreateProgramInput {
  name: string;
  description: string;
  config?: Record<string, unknown>;
}

class ProgramManager {
  /** Create a new program within a tenant. */
  async create(
    tenantId: string,
    data: CreateProgramInput,
    createdBy: string,
  ): Promise<CloudProgram> {
    const now = Date.now();
    const program: CloudProgram = {
      id: ids.program(),
      tenantId,
      name: data.name,
      description: data.description,
      status: 'active',
      config: data.config ?? {},
      createdAt: now,
      updatedAt: now,
      createdBy,
    };
    store.programs.set(program.id, program);

    await cloudAudit.record({
      tenantId,
      actorId: createdBy,
      action: 'program.created',
      resourceId: program.id,
      resourceType: 'program',
      details: { name: data.name, description: data.description },
    });

    return program;
  }

  /** Get a program by ID. */
  async get(programId: string): Promise<CloudProgram | null> {
    return store.programs.get(programId) ?? null;
  }

  /** List programs for a tenant. */
  async listForTenant(tenantId: string): Promise<CloudProgram[]> {
    return Array.from(store.programs.values())
      .filter((p) => p.tenantId === tenantId)
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  /** Update a program's mutable fields. */
  async update(
    programId: string,
    updates: Partial<Pick<CloudProgram, 'name' | 'description' | 'config'>>,
    actorId?: string,
  ): Promise<void> {
    const program = store.programs.get(programId);
    if (!program) return;
    if (updates.name !== undefined) program.name = updates.name;
    if (updates.description !== undefined) program.description = updates.description;
    if (updates.config) program.config = { ...program.config, ...updates.config };
    program.updatedAt = Date.now();

    await cloudAudit.record({
      tenantId: program.tenantId,
      actorId: actorId ?? 'system',
      action: 'program.updated',
      resourceId: programId,
      resourceType: 'program',
      details: { updates } as Record<string, unknown>,
    });
  }

  /** Pause a program (active → paused). */
  async pause(programId: string, actorId?: string): Promise<void> {
    const program = store.programs.get(programId);
    if (!program) return;
    program.status = 'paused';
    program.pausedAt = Date.now();
    program.updatedAt = Date.now();

    await cloudAudit.record({
      tenantId: program.tenantId,
      actorId: actorId ?? 'system',
      action: 'program.paused',
      resourceId: programId,
      resourceType: 'program',
      details: {},
    });
  }

  /** Resume a paused program (paused → active). */
  async resume(programId: string, actorId?: string): Promise<void> {
    const program = store.programs.get(programId);
    if (!program) return;
    program.status = 'active';
    program.pausedAt = undefined;
    program.updatedAt = Date.now();

    await cloudAudit.record({
      tenantId: program.tenantId,
      actorId: actorId ?? 'system',
      action: 'program.resumed',
      resourceId: programId,
      resourceType: 'program',
      details: {},
    });
  }

  /** Archive a program (any → archived). */
  async archive(programId: string, actorId?: string): Promise<void> {
    const program = store.programs.get(programId);
    if (!program) return;
    program.status = 'archived';
    program.archivedAt = Date.now();
    program.updatedAt = Date.now();

    await cloudAudit.record({
      tenantId: program.tenantId,
      actorId: actorId ?? 'system',
      action: 'program.archived',
      resourceId: programId,
      resourceType: 'program',
      details: {},
    });
  }

  /** Mark a program as completed. */
  async complete(programId: string, actorId?: string): Promise<void> {
    const program = store.programs.get(programId);
    if (!program) return;
    program.status = 'completed';
    program.updatedAt = Date.now();

    await cloudAudit.record({
      tenantId: program.tenantId,
      actorId: actorId ?? 'system',
      action: 'program.completed',
      resourceId: programId,
      resourceType: 'program',
      details: {},
    });
  }

  /** Filter helper for the UI (status / search). */
  filter(
    programs: CloudProgram[],
    opts: { status?: CloudProgramStatus; q?: string },
  ): CloudProgram[] {
    return programs.filter((p) => {
      if (opts.status && p.status !== opts.status) return false;
      if (opts.q) {
        const q = opts.q.toLowerCase();
        const matches =
          p.name.toLowerCase().includes(q) ||
          p.description.toLowerCase().includes(q);
        if (!matches) return false;
      }
      return true;
    });
  }
}

export const programManager = new ProgramManager();
