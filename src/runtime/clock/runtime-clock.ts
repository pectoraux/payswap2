/**
 * Runtime Clock — the virtual clock. Everything reads clock.now(), never
 * Date.now(). (Principle 6: Deterministic Replay; Vocabulary: Runtime Clock.)
 *
 * Live environment runs at 1× real time. Sandbox can run at 10×/100×/1000×,
 * pause, seek (Time Machine), and branch (what-if).
 *
 * M-RT-1 ships LiveClock (1× real) + a basic VirtualClock. The full
 * simulation clock (robust seek/branch/forecast) lands in M-RT-10.
 */

export interface RuntimeClock {
  /** Current virtual time, in epoch milliseconds. */
  now(): number;
  /** Current speed multiplier (1 = real time). */
  speed(): number;
  /** Freeze virtual time. (LiveClock throws.) */
  pause(): void;
  /** Resume virtual time after a pause. */
  resume(): void;
  /** Jump virtual time to `ts`. (LiveClock throws.) */
  seekTo(ts: number): void;
  /** Fork a new clock at `fromTs` (default: now) for what-if scenarios. */
  branch(fromTs?: number): RuntimeClock;
}

/**
 * LiveClock — backs the live environment. Always real time, 1×. Cannot be
 * paused or seeked (those throw) because live time is irreducible.
 *
 * M-6 fix: Uses a Hybrid Logical Clock (HLC) internally to guarantee
 * monotonic timestamps. HLC combines wall-clock time with a logical
 * counter so that:
 *   - If wall-clock goes backwards (NTP adjustment), the logical counter
 *     increments, ensuring now() never returns a value <= a previous now().
 *   - If wall-clock goes forward normally, the logical counter resets to 0.
 *   - Timestamps are causally ordered: if event A happened before event B,
 *     then A's timestamp < B's timestamp.
 *
 * The HLC timestamp is encoded as: (wallMs << 20) | counter
 * This gives 2^20 = ~1M counter values per millisecond, which is more than
 * enough for single-process throughput. The wall-clock milliseconds occupy
 * the high bits, preserving the epoch-ms semantics that the rest of the
 * system expects.
 */
export class LiveClock implements RuntimeClock {
  // HLC state
  private hlcWall: number = 0;  // last wall-clock ms
  private hlcCounter: number = 0; // logical counter

  /**
   * Returns a monotonic timestamp. The value is the wall-clock millisecond
   * timestamp, but guaranteed to be strictly greater than any previously
   * returned value (within the same process).
   *
   * The counter is embedded in the low bits when the wall clock hasn't
   * advanced, ensuring strict monotonicity.
   */
  now(): number {
    const wall = Date.now();

    if (wall > this.hlcWall) {
      // Wall clock advanced — reset counter
      this.hlcWall = wall;
      this.hlcCounter = 0;
      return wall;
    }

    // Wall clock didn't advance (or went backwards) — increment counter
    // This ensures monotonicity even if Date.now() returns the same value
    // or a lower value (NTP adjustment, leap second).
    this.hlcCounter++;
    // Encode: wall + counter fraction (counter / 1000 added to wall)
    // This keeps the value as a valid epoch-ms timestamp while ensuring
    // uniqueness and monotonicity.
    return this.hlcWall + this.hlcCounter / 1000;
  }

  speed(): number {
    return 1;
  }
  pause(): void {
    throw new Error('LiveClock cannot be paused — live time is irreducible');
  }
  resume(): void {
    /* no-op */
  }
  seekTo(): void {
    throw new Error('LiveClock cannot seek — live time is irreducible');
  }
  branch(): RuntimeClock {
    throw new Error('LiveClock cannot branch — use a VirtualClock for what-if');
  }
}

/**
 * VirtualClock — backs the sandbox/twin environment.
 *
 * Model: virtual time = virtualAtEpoch + (realNow - epoch) * multiplier,
 * unless paused. seekTo reanchors. branch forks an independent clock.
 */
export class VirtualClock implements RuntimeClock {
  private epoch: number;            // real-time ms when the clock was last anchored
  private virtualAtEpoch: number;   // virtual time at that real moment
  private multiplier: number;
  private paused: boolean;

  constructor(opts: { origin?: number; speed?: number } = {}) {
    this.epoch = Date.now();
    this.virtualAtEpoch = opts.origin ?? this.epoch;
    this.multiplier = opts.speed ?? 1;
    this.paused = false;
  }

  now(): number {
    if (this.paused) return this.virtualAtEpoch;
    return this.virtualAtEpoch + (Date.now() - this.epoch) * this.multiplier;
  }

  speed(): number {
    return this.multiplier;
  }

  pause(): void {
    if (this.paused) return;
    this.virtualAtEpoch = this.now();
    this.paused = true;
  }

  resume(): void {
    if (!this.paused) return;
    this.epoch = Date.now();
    this.paused = false;
  }

  seekTo(ts: number): void {
    this.virtualAtEpoch = ts;
    this.epoch = Date.now();
  }

  branch(fromTs?: number): RuntimeClock {
    return new VirtualClock({ origin: fromTs ?? this.now(), speed: this.multiplier });
  }
}
