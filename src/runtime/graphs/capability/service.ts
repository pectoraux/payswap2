/**
 * Capability Graph Service — the production wrapper. (M-RT-2.)
 *
 * Wraps the InMemoryCapabilityGraph with:
 *   1. Domain Event emission on publish/withdraw (via the Event Store)
 *   2. Runtime Clock timestamps
 *   3. A seed function that populates capabilities from the existing kernel
 *      LiquidityProvider data
 *
 * This is the first real (non-NoOp) runtime logic. It turns the M-RT-1
 * skeleton into a living graph that projections can react to.
 */

import type { CapabilityGraph, LPCapability } from './types';
import { InMemoryCapabilityGraph } from './types';
import type { EventStore } from '../../events';
import type { RuntimeClock } from '../../clock';
import type { Environment } from '../../types';
import { uid } from '../../types';

/** A publishable capability (id + publishedAt assigned by the service). */
export interface PublishableCapability {
  lpId: string;
  from: string;
  to: string;
  rail: LPCapability['rail'];
  maxAmount: number;
  latencyMs: number;
}

/**
 * CapabilityGraphService — the production Capability Graph.
 *
 * Publishes Domain Events (`capability.published` / `capability.withdrawn`)
 * to the Event Store so projections (and downstream engines like the Route
 * Graph) can react.
 */
export class CapabilityGraphService {
  private graph: CapabilityGraph = new InMemoryCapabilityGraph();
  private capabilityIdByLpAndRoute: Map<string, string> = new Map();

  constructor(
    private eventStore: EventStore,
    private clock: RuntimeClock,
  ) {}

  /** Publish a capability. Emits a Domain Event. Returns the stored capability. */
  async publish(
    cap: PublishableCapability,
    environment: Environment,
    actorId: string,
    correlationId: string,
  ): Promise<LPCapability> {
    const key = `${cap.lpId}:${cap.from}->${cap.to}`;
    const id = this.capabilityIdByLpAndRoute.get(key) ?? uid('cap');
    this.capabilityIdByLpAndRoute.set(key, id);

    const capability: LPCapability = {
      id,
      lpId: cap.lpId,
      from: cap.from,
      to: cap.to,
      rail: cap.rail,
      maxAmount: cap.maxAmount,
      latencyMs: cap.latencyMs,
      active: true,
      publishedAt: this.clock.now(),
    };

    this.graph.publish(capability);

    // Emit the Domain Event so projections + downstream engines react.
    const streamId = `${environment}:capability:${id}`;
    const expectedVersions = new Map<string, number>();
    const existingVersion = this.eventStore.streamVersion(streamId);
    if (existingVersion !== undefined) expectedVersions.set(streamId, existingVersion);

    await this.eventStore.append(
      [{
        type: 'capability.published',
        streamId,
        streamType: 'capability',
        kind: 'domain',
        payload: { capability, environment },
      }],
      expectedVersions,
      {
        intentId: correlationId,
        correlationId,
        actor: actorId,
        environment,
        timestamp: this.clock.now(),
      },
    );

    return capability;
  }

  /** Withdraw a capability. Emits a Domain Event. */
  async withdraw(
    capabilityId: string,
    environment: Environment,
    actorId: string,
    correlationId: string,
  ): Promise<void> {
    const all = this.graph.all();
    const cap = all.find((c) => c.id === capabilityId);
    this.graph.withdraw(capabilityId);

    const streamId = `${environment}:capability:${capabilityId}`;
    const expectedVersions = new Map<string, number>();
    const existingVersion = this.eventStore.streamVersion(streamId);
    if (existingVersion !== undefined) expectedVersions.set(streamId, existingVersion);

    await this.eventStore.append(
      [{
        type: 'capability.withdrawn',
        streamId,
        streamType: 'capability',
        kind: 'domain',
        payload: { capabilityId, lpId: cap?.lpId, environment },
      }],
      expectedVersions,
      {
        intentId: correlationId,
        correlationId,
        actor: actorId,
        environment,
        timestamp: this.clock.now(),
      },
    );
  }

  // ── read methods (delegate to the graph) ──────────────────────────────

  forLP(lpId: string): LPCapability[] {
    return this.graph.forLP(lpId);
  }

  canMove(from: string, to: string): LPCapability[] {
    return this.graph.canMove(from, to);
  }

  all(): LPCapability[] {
    return this.graph.all();
  }

  /** The raw graph (for the Route Graph to regenerate from). */
  rawGraph(): CapabilityGraph {
    return this.graph;
  }
}
