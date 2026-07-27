/**
 * Runtime Clock — the deterministic time source. (M-RT-1 foundation.)
 *
 * Every event, every projection, every read model uses the clock's `now()`
 * for timestamps. In production, LiveClock returns wall-clock time. In
 * simulation/sandbox, VirtualClock returns a controllable virtual time.
 */

export interface RuntimeClock {
  /** Current time, in epoch milliseconds. */
  now(): number;
  /** The clock mode (for health/debugging). */
  readonly mode: 'live' | 'virtual';
}

/** LiveClock — uses real wall-clock time. */
export class LiveClock implements RuntimeClock {
  readonly mode = 'live' as const;
  now(): number {
    return Date.now();
  }
}

/** VirtualClock — controllable time for simulation/sandbox. */
export class VirtualClock implements RuntimeClock {
  readonly mode = 'virtual' as const;
  private current: number;
  private readonly speed: number;
  private readonly origin: number;
  private realOrigin: number;

  constructor(opts: { origin?: number; speed?: number } = {}) {
    this.origin = opts.origin ?? 0;
    this.speed = opts.speed ?? 1;
    this.current = this.origin;
    this.realOrigin = Date.now();
  }

  now(): number {
    if (this.speed === 0) return this.current;
    const realElapsed = Date.now() - this.realOrigin;
    this.current = this.origin + Math.floor(realElapsed * this.speed);
    return this.current;
  }

  /** Manually advance the clock (for testing). */
  advance(ms: number): void {
    this.current += ms;
  }
}
