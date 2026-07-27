/**
 * CapabilityGraphProjection — rebuilds the Capability Graph from intent-based
 * Domain Events. (Compiled-projection discipline.)
 *
 * Listens to the business events that change source-of-truth inputs:
 *   lp.capability_enabled · lp.capability_disabled · lp.capability_limit_changed
 *   lp.connector_attached · lp.connector_detached
 *   lp.reserve_access_granted · lp.reserve_access_revoked
 *
 * On any of these, the projection triggers a CapabilityCompiler rebuild so
 * the graph stays a faithful compiled view of the source-of-truth inputs.
 *
 * Note: these are NOT CRUD events (capability.published/withdrawn). They are
 * intent-based business events about the LP/Connector/Reserve — the graph is
 * a derived consequence, never the thing being mutated.
 */

import type { CapabilityGraph } from './types';
import type { CapabilityCompiler, CapabilityCompilerInput } from './compiler';
import type { RuntimeClock } from '../../clock';

/** The event types this projection reacts to. */
export const CAPABILITY_TRIGGER_EVENTS = [
  'lp.capability_enabled',
  'lp.capability_disabled',
  'lp.capability_limit_changed',
  'lp.connector_attached',
  'lp.connector_detached',
  'lp.reserve_access_granted',
  'lp.reserve_access_revoked',
  'treasury.permission_changed',
] as const;

/**
 * CapabilityGraphProjection — subscribes to trigger events and rebuilds the graph.
 *
 * M-RT-2 ships a simple rebuild-on-trigger. M-RT-3+ wires the real source-of-truth
 * readers (LP Profile store, Connector Registry, Compliance Rules).
 */
export class CapabilityGraphProjection {
  constructor(
    private graph: CapabilityGraph,
    private compiler: CapabilityCompiler,
    private clock: RuntimeClock,
    /** Returns the current source-of-truth inputs (eventually reads from DB). */
    private getInput: () => CapabilityCompilerInput,
  ) {}

  /** Handle a Domain Event. If it's a trigger, rebuild the graph. */
  async handle(eventType: string): Promise<void> {
    if (!CAPABILITY_TRIGGER_EVENTS.includes(eventType as never)) return;
    // Rebuild the graph from the current source-of-truth inputs.
    this.compiler.rebuild(this.graph, this.getInput(), this.clock.now());
  }

  /** Force a rebuild (e.g. POST /compiler/rebuild-capabilities). */
  async rebuildNow(): Promise<void> {
    this.compiler.rebuild(this.graph, this.getInput(), this.clock.now());
  }
}
