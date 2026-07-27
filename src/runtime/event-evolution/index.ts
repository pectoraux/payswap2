/**
 * Event Evolution — barrel. (M-RT-27.)
 *
 * Public surface:
 *   - SchemaRegistry — top-level compatibility layer
 *   - EventRegistry  — event types + versions + upcasters
 *   - EventUpcaster  — versioned replay pipeline
 *   - registerAllEventTypes — registers all existing event types (v1)
 */

export * from './event-registry';
export * from './upcaster';
export { SchemaRegistry, registerAllEventTypes, type SchemaReport, type ProjectionCompatibility } from './schema-registry';
