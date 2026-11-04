/** Tracks the global time budget of a run. */
export class Deadline {
  readonly endsAt: number;

  constructor(budgetMs: number, startedAt = Date.now()) {
    this.endsAt = startedAt + budgetMs;
  }

  remaining(): number {
    return Math.max(0, this.endsAt - Date.now());
  }

  /** True when less than `marginMs` is left. */
  expired(marginMs = 0): boolean {
    return this.remaining() <= marginMs;
  }

  /**
   * A timeout for one operation: at most `capMs`, never past the deadline.
   * Never returns 0, because Playwright treats timeout 0 as "no timeout".
   */
  timeout(capMs: number): number {
    return Math.max(1, Math.min(capMs, this.remaining()));
  }
}
