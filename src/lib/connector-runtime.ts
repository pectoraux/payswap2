/**
 * In-memory runtime state for production connectors.
 *
 * The connector registry itself (`productionConnectorRegistry`) is immutable
 * at boot — connectors register their config + secrets once. The pause /
 * resume state that an SRE toggles from the operations dashboard lives here,
 * in a module-level map keyed by connector id.
 *
 * In a real deployment this state would be persisted (database table, kv
 * store, or service-catalog). For this sandbox the in-memory map is
 * sufficient and survives hot-reloads via `globalThis`.
 */
type ConnectorRuntimeState = {
  paused: Record<string, boolean>;
};

const globalState = globalThis as unknown as {
  __payswapConnectorState?: ConnectorRuntimeState;
};
if (!globalState.__payswapConnectorState) {
  globalState.__payswapConnectorState = { paused: {} };
}

const connectorState = globalState.__payswapConnectorState;

/** Returns true when the connector is currently paused. */
export function isConnectorPaused(id: string): boolean {
  return connectorState.paused[id] === true;
}

/** Mark a connector as paused / active. */
export function setConnectorPaused(id: string, paused: boolean): void {
  connectorState.paused[id] = paused;
}

/** Snapshot of every connector's pause state. */
export function getConnectorRuntimeState(): Record<string, boolean> {
  return { ...connectorState.paused };
}
