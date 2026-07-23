/**
 * Workflow Engine — declarative multi-step workflows over the kernel.
 *
 * Manual settlement and insurance claims are modeled as workflows, never
 * hardcoded. Each workflow is replayable: every step's status and output is
 * recorded against a frame so the Time Machine can scrub through it.
 */
import type { Workflow, WorkflowStep, WorkflowType } from './types';
import { uid } from './support';
import { eventEngine } from './event';

export class WorkflowEngine {
  begin(id: string, type: WorkflowType, name: string, stepDefs: { id: string; name: string }[], triggeredBy?: string): Workflow {
    const wf: Workflow = {
      id,
      type,
      name,
      steps: stepDefs.map((s) => ({ ...s, status: 'pending' as const })),
      startedAt: Date.now(),
      finishedAt: null,
      triggeredBy,
    };
    eventEngine.emit('workflow.begun', { workflowId: id, type, name, steps: stepDefs.length }, 0);
    return wf;
  }

  step(wf: Workflow, stepId: string, frame: number, fn: () => string): WorkflowStep | undefined {
    const step = wf.steps.find((s) => s.id === stepId);
    if (!step) return undefined;
    step.status = 'running';
    step.frame = frame;
    try {
      step.output = fn();
      step.status = 'complete';
      eventEngine.emit('workflow.step.complete', { workflowId: wf.id, stepId, frame }, frame);
    } catch (e) {
      step.status = 'failed';
      step.output = e instanceof Error ? e.message : 'failed';
      eventEngine.emit('workflow.step.failed', { workflowId: wf.id, stepId, frame }, frame);
    }
    return step;
  }

  finish(wf: Workflow, frame: number): Workflow {
    wf.finishedAt = Date.now();
    eventEngine.emit('workflow.finished', { workflowId: wf.id, frame }, frame);
    return wf;
  }
}

export const workflowEngine = new WorkflowEngine();

/** Standard manual-settlement workflow definition. */
export function manualSettlementSteps(): { id: string; name: string }[] {
  return [
    { id: 'notify', name: 'Notify LP' },
    { id: 'settle', name: 'LP settles externally' },
    { id: 'confirm', name: 'Merchant confirms' },
    { id: 'auto', name: 'Automatic settlement' },
  ];
}

/** Standard insurance-claim workflow definition. */
export function insuranceClaimSteps(): { id: string; name: string }[] {
  return [
    { id: 'file', name: 'Claim filed' },
    { id: 'evidence', name: 'Evidence collected' },
    { id: 'community', name: 'Community review' },
    { id: 'vote', name: 'PaySwap vote' },
    { id: 'decision', name: 'Decision' },
    { id: 'adjustment', name: 'Token adjustment' },
  ];
}

export function uid_wf(): string {
  return uid('wf');
}
