import { describe, it, expect } from "vitest";
import { fc, test } from "@fast-check/vitest";
import { Throttle } from "@/lib/qloo/throttle";

/** A fake clock: sleeping advances time instantly. */
function clock() {
  let t = 0;
  return { now: () => t, sleep: async (ms: number) => void (t += ms), get t() { return t; } };
}

describe("Throttle", () => {
  test.prop([fc.integer({ min: 1, max: 6 }), fc.array(fc.integer({ min: 0, max: 3 }), { minLength: 1, maxLength: 25 })])(
    "never runs more than maxConcurrent tasks at once",
    async (maxConcurrent, delays) => {
      const c = clock();
      const th = new Throttle(1000, maxConcurrent, c.now, c.sleep);
      let active = 0;
      let peak = 0;
      await Promise.all(
        delays.map((d) =>
          th.run(async () => {
            active++;
            peak = Math.max(peak, active);
            for (let i = 0; i < d; i++) await Promise.resolve();
            active--;
          }),
        ),
      );
      expect(peak).toBeLessThanOrEqual(maxConcurrent);
      expect(th.active).toBe(0);
    },
  );

  test.prop([fc.integer({ min: 1, max: 10 }), fc.integer({ min: 1, max: 40 })])("starts at most perSecond·elapsed + burst calls", async (perSecond, n) => {
    const c = clock();
    const th = new Throttle(perSecond, 100, c.now, c.sleep);
    for (let i = 0; i < n; i++) await th.run(async () => undefined);
    // the bucket starts full (perSecond tokens), then refills at perSecond per second
    expect(n).toBeLessThanOrEqual(perSecond + Math.ceil((c.t / 1000) * perSecond) + 1);
  });

  it("releases its slot when the task throws", async () => {
    const th = new Throttle(100, 1);
    await expect(th.run(async () => Promise.reject(new Error("x")))).rejects.toThrow("x");
    await expect(th.run(async () => 7)).resolves.toBe(7);
    expect(th.active).toBe(0);
  });
});
