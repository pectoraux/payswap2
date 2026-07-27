/**
 * Read Models & Projections — the only thing interfaces read.
 * (M-RT-1 foundation, M-RT-17/18/19 façade pattern.)
 *
 * Pages NEVER replay events. They read read models, which projections
 * update IMMEDIATELY on append (the EventStore subscriber fires
 * synchronously). Projections are the ONLY writers of read-model tables.
 */

import type { StoredEvent } from '../events';

/** A projection subscribes to Domain Events and writes one read model. */
export interface Projection {
  name: string;
  handles: string[];
  apply(events: StoredEvent[]): Promise<void>;
  rebuild(allEvents: StoredEvent[]): Promise<void>;
  checkpoint(): number;
}

/** A read model is a query façade over projection-maintained tables. */
export interface ReadModel {
  name: string;
}

/**
 * ProjectionRunner — subscribes to the EventStore and dispatches events to
 * registered projections in global order.
 */
export class ProjectionRunner {
  private projections: Projection[] = [];
  private checkpoints: Map<string, number> = new Map();
  private unsubscribe: (() => void) | null = null;

  register(projection: Projection): void {
    this.projections.push(projection);
    this.checkpoints.set(projection.name, projection.checkpoint());
  }

  start(eventStore: { subscribe: (s: (e: StoredEvent[]) => void | Promise<void>) => () => void }): void {
    if (this.unsubscribe) return;
    this.unsubscribe = eventStore.subscribe(async (events) => {
      for (const projection of this.projections) {
        const relevant = events.filter((e) =>
          projection.handles.some((p) => e.type.startsWith(p)),
        );
        if (relevant.length > 0) {
          await projection.apply(relevant);
          this.checkpoints.set(projection.name, relevant[relevant.length - 1].globalPosition);
        }
      }
    });
  }

  stop(): void {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
  }

  projectionNames(): string[] {
    return this.projections.map((p) => p.name);
  }
}
