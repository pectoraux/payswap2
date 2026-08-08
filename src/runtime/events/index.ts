/**
 * Runtime Events — barrel export. (P3-2 canonical: PostgresEventStore.)
 *
 * The CANONICAL event store is `PostgresEventStore`. The `InMemoryEventStore`
 * is retained as a dev/test-only fallback (see its class docstring).
 */
export type {
  EventKind,
  UncommittedEvent,
  StoredEvent,
  AppendMetadata,
  AppendResult,
  EventSubscriber,
} from './types';
export type { EventStore } from './event-store';
export { InMemoryEventStore, OptimisticConcurrencyError } from './event-store';
export { PostgresEventStore, OCCError } from './postgres-event-store';
