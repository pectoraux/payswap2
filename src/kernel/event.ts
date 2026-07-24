/**
 * Event Engine — in-process pub/sub event bus.
 *
 * Every state change in the kernel emits an event. The Simulation Engine
 * records the full event stream so a run can be replayed deterministically.
 */
import type { SimulationEvent } from './types';
import { uid, nowTs } from './support';

type Handler = (event: SimulationEvent) => void;

export class EventEngine {
  private stream: SimulationEvent[] = [];
  private handlers: Map<string, Set<Handler>> = new Map();

  /** Subscribe to events matching a type prefix (e.g. "ledger." matches "ledger.posted"). */
  on(typePrefix: string, handler: Handler): () => void {
    if (!this.handlers.has(typePrefix)) this.handlers.set(typePrefix, new Set());
    this.handlers.get(typePrefix)!.add(handler);
    return () => this.handlers.get(typePrefix)?.delete(handler);
  }

  /** Emit an event into the stream and notify subscribers. */
  emit(type: string, payload: Record<string, unknown>, frame = 0): SimulationEvent {
    const event: SimulationEvent = {
      id: uid('evt'),
      type,
      payload,
      ts: nowTs(),
      frame,
    };
    this.stream.push(event);
    for (const [prefix, handlers] of this.handlers) {
      if (type.startsWith(prefix)) handlers.forEach((h) => h(event));
    }
    return event;
  }

  /** All events recorded since the engine was created/reset. */
  read(): SimulationEvent[] {
    return [...this.stream];
  }

  /** Events belonging to a specific replay frame. */
  frame(frame: number): SimulationEvent[] {
    return this.stream.filter((e) => e.frame === frame);
  }

  reset(): void {
    this.stream = [];
  }
}

export const eventEngine = new EventEngine();
