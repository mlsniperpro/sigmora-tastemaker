import { realSleep } from "../net";

/**
 * Client-side throttle for the Qloo hackathon key (reported limit: 5 requests
 * per second). A token bucket caps the rate and a semaphore caps requests in
 * flight. One shared instance per server process.
 */
export class Throttle {
  private tokens: number;
  private last: number;
  private inFlight = 0;
  private readonly waiters: (() => void)[] = [];

  constructor(
    private readonly perSecond: number,
    private readonly maxConcurrent: number,
    // Monotonic: a wall-clock step backwards (NTP, a test clock) must never stall the queue.
    private readonly now: () => number = () => performance.now(),
    private readonly sleep: (ms: number) => Promise<void> = realSleep,
  ) {
    this.tokens = perSecond;
    this.last = now();
  }

  private refill() {
    const t = this.now();
    this.tokens = Math.min(this.perSecond, this.tokens + ((t - this.last) / 1000) * this.perSecond);
    this.last = t;
  }

  private async acquireSlot() {
    if (this.inFlight < this.maxConcurrent) {
      this.inFlight++;
      return;
    }
    await new Promise<void>((resolve) => this.waiters.push(resolve));
    // the releaser handed its slot straight to us; inFlight is unchanged
  }

  private releaseSlot() {
    const next = this.waiters.shift();
    if (next) next();
    else this.inFlight--;
  }

  private async acquireToken() {
    for (;;) {
      this.refill();
      if (this.tokens >= 1) {
        this.tokens -= 1;
        return;
      }
      await this.sleep(Math.ceil(((1 - this.tokens) / this.perSecond) * 1000));
    }
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquireSlot();
    try {
      await this.acquireToken();
      return await fn();
    } finally {
      this.releaseSlot();
    }
  }

  /** For tests and diagnostics. */
  get active() {
    return this.inFlight;
  }
}
