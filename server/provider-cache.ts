import type { Segment } from './providers.js';
import type { ValhallaSegment } from './routing.js';

// Process-local, bounded caches. Never cache an authenticated HTTP response.
export class ProviderCache<T> {
  private values = new Map<string, { value: T; until: number }>();
  private pending = new Map<string, Promise<T>>();
  readonly stats = { hit: 0, miss: 0, joined: 0, failed: 0, bypass: 0, durationMs: 0 };

  constructor(
    private ttlMs: number,
    private capacity = 512,
    private now = () => Date.now(),
  ) {}

  delete(key: string) {
    this.values.delete(key);
  }

  async get(
    key: string,
    load: () => Promise<T>,
    reusable: (value: T) => boolean = () => true,
    deduplicate = true,
  ): Promise<T> {
    const cached = this.values.get(key);
    if (cached && cached.until > this.now()) {
      this.stats.hit++;
      this.values.delete(key);
      this.values.set(key, cached);
      return structuredClone(cached.value);
    }
    this.values.delete(key);
    const pending = deduplicate ? this.pending.get(key) : undefined;
    if (pending) {
      this.stats.joined++;
      return structuredClone(await pending);
    }
    this.stats.miss++;
    const tracked = deduplicate && this.pending.size < this.capacity;
    if (deduplicate && !tracked) this.stats.bypass++;
    const started = performance.now();
    const task = Promise.resolve()
      .then(load)
      .then((value) => {
        if (reusable(value)) {
          if (this.ttlMs > 0) {
            this.values.delete(key);
            if (this.values.size >= this.capacity)
              this.values.delete(this.values.keys().next().value!);
            this.values.set(key, { value: structuredClone(value), until: this.now() + this.ttlMs });
          }
        } else this.stats.failed++;
        return value;
      })
      .catch((error) => {
        this.stats.failed++;
        throw error;
      })
      .finally(() => {
        this.stats.durationMs += performance.now() - started;
        if (tracked) this.pending.delete(key);
      });
    if (tracked) this.pending.set(key, task);
    return structuredClone(await task);
  }
}

// Isolate injected transports in tests and alternate clients without recording keys in metrics.
const clients = new WeakMap<typeof fetch, number>();
let nextClient = 0;
export function providerKey(request: typeof fetch, parts: unknown[]) {
  if (!clients.has(request)) clients.set(request, ++nextClient);
  return JSON.stringify([clients.get(request), ...parts]);
}

export const providerCaches = {
  weather: new ProviderCache<any>(10 * 60_000),
  valhalla: new ProviderCache<ValhallaSegment>(5 * 60_000),
  google_routes: new ProviderCache<Segment>(0),
  google_place_id: new ProviderCache<string | null>(24 * 60 * 60_000),
};

export async function mapConcurrent<T, R>(
  items: readonly T[],
  concurrency: number,
  work: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (!Number.isInteger(concurrency) || concurrency < 1) throw new Error('BAD_CONCURRENCY');
  const results = new Array<R>(items.length);
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (cursor < items.length) {
        const index = cursor++;
        results[index] = await work(items[index]!, index);
      }
    }),
  );
  return results;
}
