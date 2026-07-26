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
 */
export class LiveClock implements RuntimeClock {
  now(): number {
    return Date.now();
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
