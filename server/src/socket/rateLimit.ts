/** Simple fixed-window counter keyed by an arbitrary string (IP, socket id…). */
export class RateLimiter {
  private hits = new Map<string, { count: number; windowStart: number }>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  /** Records a hit and returns true if the key is still within its limit. */
  hit(key: string): boolean {
    const t = this.now();
    const entry = this.hits.get(key);
    if (!entry || t - entry.windowStart >= this.windowMs) {
      this.hits.set(key, { count: 1, windowStart: t });
      this.prune(t);
      return true;
    }
    entry.count += 1;
    return entry.count <= this.limit;
  }

  /** True if the key is currently over its limit (without recording a hit). */
  blocked(key: string): boolean {
    const entry = this.hits.get(key);
    if (!entry || this.now() - entry.windowStart >= this.windowMs) return false;
    return entry.count > this.limit;
  }

  private prune(t: number): void {
    if (this.hits.size < 5000) return;
    for (const [k, v] of this.hits) if (t - v.windowStart >= this.windowMs) this.hits.delete(k);
  }
}
