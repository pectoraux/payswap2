/**
 * Workflow Engine — declarative multi-step workflows over the kernel.
 *
 * A workflow is an ordered list of steps; each step references a kernel
 * capability and can depend on previous steps' outputs. The Settlement
 * replay (debit → credit → mint → burn → payout) is itself a workflow. Future
 * product extensions compose their own workflows on top of the same runtime.
 */
import { eventEngine } from './event';

export type StepStatus = 'pending' | 'running' | 'complete' | 'failed' | 'skipped';

export interface WorkflowStep {
  id: string;
  name: string;
  status: StepStatus;
  output?: unknown;
  frame?: number;
}

export interface Workflow {
  id: string;
  name: string;
  steps: WorkflowStep[];
  startedAt: number;
  finishedAt: number | null;
}

export class WorkflowEngine {
  begin(id: string, name: string, stepDefs: { id: string; name: string }[]): Workflow {
    const wf: Workflow = {
      id,
      name,
      steps: stepDefs.map((s) => ({ ...s, status: 'pending' as StepStatus })),
      startedAt: Date.now(),
      finishedAt: null,
    };
    eventEngine.emit('workflow.begun', { workflowId: id, name, steps: stepDefs.length }, 0);
    return wf;
  }

  step(wf: Workflow, stepId: string, frame: number, fn: () => unknown): WorkflowStep | undefined {
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
      eventEngine.emit('workflow.step.failed', { workflowId: wf.id, stepId, frame }, frame);
      throw e;
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
