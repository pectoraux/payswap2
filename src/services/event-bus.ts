/**
 * PaySwap Domain Event Bus.
 *
 * Simple synchronous in-process pub/sub. Events fire within the same request.
 */

export interface DomainEvent {
  id: string;
  type: string;
  aggregateId: string;
  aggregateType: string;
  merchantId?: string;
  environment: string;
  payload: Record<string, unknown>;
  timestamp: number;
  actorId?: string;
}

type EventHandler = (event: DomainEvent) => Promise<void> | void;

class EventBus {
  private handlers: Map<string, Set<EventHandler>> = new Map();
  private history: DomainEvent[] = [];

  on(typePrefix: string, handler: EventHandler): () => void {
    if (!this.handlers.has(typePrefix)) this.handlers.set(typePrefix, new Set());
    this.handlers.get(typePrefix)!.add(handler);
    return () => this.handlers.get(typePrefix)?.delete(handler);
  }

  async emit(event: DomainEvent): Promise<void> {
    this.history.push(event);
    if (this.history.length > 10000) this.history.shift();
    const promises: Promise<void>[] = [];
    for (const [prefix, handlers] of this.handlers) {
      if (event.type.startsWith(prefix)) {
        for (const handler of handlers) {
          promises.push(Promise.resolve(handler(event)).catch(() => {}));
        }
      }
    }
    await Promise.all(promises);
  }

  recent(limit = 50): DomainEvent[] {
    return this.history.slice(-limit);
  }

  reset(): void { this.history = []; }
}

const globalForBus = globalThis as unknown as { __PAYSWAP_EVENT_BUS?: EventBus };
export const eventBus = globalForBus.__PAYSWAP_EVENT_BUS ?? new EventBus();
if (!globalForBus.__PAYSWAP_EVENT_BUS) globalForBus.__PAYSWAP_EVENT_BUS = eventBus;

export function createEvent(params: {
  type: string;
  aggregateId: string;
  aggregateType: string;
  merchantId?: string;
  environment: string;
  payload: Record<string, unknown>;
  actorId?: string;
}): DomainEvent {
  return {
    id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    type: params.type,
    aggregateId: params.aggregateId,
    aggregateType: params.aggregateType,
    merchantId: params.merchantId,
    environment: params.environment,
    payload: params.payload,
    timestamp: Date.now(),
    actorId: params.actorId,
  };
}
