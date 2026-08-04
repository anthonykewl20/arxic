interface Counter {
  attempts: number;
  resetsAt: number;
}

const counters = new Map<string, Counter>();

export function consumeRateLimit(key: string, limit = 5, windowMs = 60_000): boolean {
  const now = Date.now();
  const existing = counters.get(key);
  if (!existing || existing.resetsAt <= now) {
    counters.set(key, { attempts: 1, resetsAt: now + windowMs });
    return true;
  }
  existing.attempts += 1;
  return existing.attempts <= limit;
}

export function clearRateLimits(): void {
  counters.clear();
}
