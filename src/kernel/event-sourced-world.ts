/**
 * PaySwap Runtime — Event-Sourced World.
 *
 * Truth is events. Snapshots are optimization (cache). The world is rebuilt by
 * replaying events from genesis — exactly like Kafka, EventStoreDB, Axon,
 * Temporal. This makes replay, debugging, auditing, simulation, rollback,
 * analytics, and ML training all use exactly the same data.
 *
 *   Genesis
 *     ↓ Event
 *     ↓ Event
 *     ↓ Event
 *     ↓ Current World
 *
 * Every state change is an event. The world is a fold over events.
 */
import { uid } from './support';
import type { Entity } from './entity';
import type { Transition } from './transition';

export interface WorldEvent {
  id: string;
  type: string;
  ts: number;
  frame: number;
  entityId: string;
  payload: Record<string, unknown>;
  transitionId?: string;
}

export interface EventSourcedWorld {
  id: string;
  genesis: Entity[];
  events: WorldEvent[];
  snapshot?: Entity[]; // cached — optimization, not truth
  snapshotVersion?: number;
}

/** Create a new event-sourced world from genesis entities. */
export function createEventSourcedWorld(genesis: Entity[]): EventSourcedWorld {
  return { id: uid('world'), genesis, events: [] };
}

/** Append an event (events are truth). */
export function appendEvent(world: EventSourcedWorld, event: Omit<WorldEvent, 'id' | 'ts'>): WorldEvent {
  const fullEvent: WorldEvent = { ...event, id: uid('evt'), ts: Date.now() };
  world.events.push(fullEvent);
  // Invalidate snapshot cache
  if (world.snapshot && world.snapshotVersion !== undefined && world.snapshotVersion < world.events.length) {
    world.snapshot = undefined;
    world.snapshotVersion = undefined;
  }
  return fullEvent;
}

/** Append a transition as events (each transition emits its events). */
export function appendTransition(world: EventSourcedWorld, t: Transition, frame: number): void {
  for (const evt of t.events) {
    appendEvent(world, {
      type: evt.type,
      frame,
      entityId: t.entityId,
      payload: { ...evt.payload, transitionId: t.id, fromState: t.fromState, toState: t.toState, amount: t.amount },
      transitionId: t.id,
    });
  }
}

/**
 * Rebuild the world by folding events over genesis. This is the source of
 * truth — snapshots are just a cache of this fold.
 */
export function rebuildWorld(world: EventSourcedWorld): Entity[] {
  let entities = world.genesis.map((e) => ({ ...e, attributes: { ...e.attributes }, capabilities: { ...e.capabilities }, policies: { ...e.policies } }));

  for (const event of world.events) {
    entities = applyEvent(entities, event);
  }
  return entities;
}

/** Get the current world (from cache if fresh, else rebuild + cache). */
export function currentWorld(world: EventSourcedWorld): Entity[] {
  if (world.snapshot && world.snapshotVersion === world.events.length) {
    return world.snapshot;
  }
  const rebuilt = rebuildWorld(world);
  world.snapshot = rebuilt;
  world.snapshotVersion = world.events.length;
  return rebuilt;
}

/** Apply a single event to entities. */
function applyEvent(entities: Entity[], event: WorldEvent): Entity[] {
  return entities.map((e) => {
    if (e.id !== event.entityId) return e;
    const updated = { ...e, attributes: { ...e.attributes }, capabilities: { ...e.capabilities }, policies: { ...e.policies } };
    // Apply state changes based on event type
    if (event.type.includes('debited') || event.type.includes('drawn') || event.type.includes('swapped')) {
      updated.balance = Math.round((updated.balance - (event.payload.amount as number)) * 1e6) / 1e6;
    } else if (event.type.includes('credited') || event.type.includes('received') || event.type.includes('minted')) {
      updated.balance = Math.round((updated.balance + (event.payload.amount as number)) * 1e6) / 1e6;
    }
    if (event.payload.toState) {
      updated.state = event.payload.toState as string;
    }
    updated.metadata = { ...updated.metadata, updatedAt: event.ts, version: updated.metadata.version + 1 };
    return updated;
  });
}

/** Rewind the world to a specific event index (for the Time Machine). */
export function rewindTo(world: EventSourcedWorld, eventIndex: number): Entity[] {
  const events = world.events.slice(0, eventIndex);
  const tempWorld: EventSourcedWorld = { ...world, events, snapshot: undefined, snapshotVersion: undefined };
  return rebuildWorld(tempWorld);
}

/** Diff two entity snapshots (for the World Timeline). */
export function diffWorlds(before: Entity[], after: Entity[]): { entityId: string; label: string; beforeBalance: number; afterBalance: number; delta: number; stateChanged: boolean }[] {
  return after.map((a) => {
    const b = before.find((e) => e.id === a.id);
    return {
      entityId: a.id,
      label: a.label,
      beforeBalance: b?.balance ?? 0,
      afterBalance: a.balance,
      delta: Math.round((a.balance - (b?.balance ?? 0)) * 1e6) / 1e6,
      stateChanged: b?.state !== a.state,
    };
  }).filter((d) => d.delta !== 0 || d.stateChanged);
}

/** Summarize the event log. */
export function eventLogSummary(world: EventSourcedWorld): { totalEvents: number; eventTypes: Record<string, number>; entities: number } {
  const types: Record<string, number> = {};
  for (const e of world.events) {
    types[e.type] = (types[e.type] ?? 0) + 1;
  }
  return { totalEvents: world.events.length, eventTypes: types, entities: world.genesis.length };
}
