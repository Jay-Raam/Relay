/**
 * Counts failed attempts per key inside a sliding window and blocks a key once it reaches
 * `max` failures, until the oldest failure ages out. In-memory: it resets on restart and is
 * per-process, which is enough to make online password guessing impractical for one API.
 */
export interface FailureLimiter {
  /** Seconds until `key` may try again, or 0 if it may try now. */
  retryAfter(key: string): number;
  fail(key: string): void;
  reset(key: string): void;
}

export interface LimiterOptions {
  max: number;
  windowMs: number;
  /** Injectable clock for tests. */
  now?: () => number;
}

/** Cap on tracked keys so a flood of made-up emails can't grow memory without bound. */
const MAX_KEYS = 10_000;

export function createFailureLimiter({
  max,
  windowMs,
  now = Date.now,
}: LimiterOptions): FailureLimiter {
  const failures = new Map<string, number[]>();

  function recent(key: string): number[] {
    const cutoff = now() - windowMs;
    const list = (failures.get(key) ?? []).filter((t) => t > cutoff);
    if (list.length === 0) failures.delete(key);
    else failures.set(key, list);
    return list;
  }

  return {
    retryAfter(key) {
      const list = recent(key);
      if (list.length < max) return 0;
      const oldest = list[0] as number;
      return Math.max(1, Math.ceil((oldest + windowMs - now()) / 1000));
    },
    fail(key) {
      if (!failures.has(key) && failures.size >= MAX_KEYS) {
        // Drop the oldest-inserted key (Map keeps insertion order).
        const first = failures.keys().next().value;
        if (first !== undefined) failures.delete(first);
      }
      const list = recent(key);
      list.push(now());
      failures.set(key, list);
    },
    reset(key) {
      failures.delete(key);
    },
  };
}
