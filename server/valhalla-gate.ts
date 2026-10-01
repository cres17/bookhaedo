// Process-local admission control. Queue wait is part of the caller's provider deadline.
export function valhallaLimits(env: NodeJS.ProcessEnv = process.env) {
  const integer = (key: string, fallback: number, min: number, max: number) => {
    const value = env[key];
    if (value === undefined || value === '') return fallback;
    if (!/^\d+$/.test(value) || Number(value) < min || Number(value) > max)
      throw Error(`${key} must be an integer from ${min} to ${max}`);
    return Number(value);
  };
  return {
    concurrency: integer('VALHALLA_MAX_CONCURRENT', 8, 1, 64),
    queue: integer('VALHALLA_MAX_QUEUE', 128, 0, 512),
  };
}
export class ValhallaGate {
  private active = 0;
  private waiting: { start: () => void; cancel: () => void }[] = [];
  constructor(
    private readonly capacity: number,
    private readonly maxQueue: number,
  ) {
    if (!Number.isInteger(capacity) || capacity < 1 || !Number.isInteger(maxQueue) || maxQueue < 0)
      throw Error('Invalid Valhalla gate limits');
  }
  private acquire(signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted();
    if (this.active < this.capacity) {
      this.active++;
      return Promise.resolve();
    }
    if (this.waiting.length >= this.maxQueue) throw Error('VALHALLA_QUEUE_FULL');
    return new Promise((resolve, reject) => {
      const entry = {
        start: () => {
          signal?.removeEventListener('abort', entry.cancel);
          this.active++;
          resolve();
        },
        cancel: () => {
          this.waiting = this.waiting.filter((item) => item !== entry);
          reject(signal?.reason ?? Error('ABORTED'));
        },
      };
      this.waiting.push(entry);
      signal?.addEventListener('abort', entry.cancel, { once: true });
      if (signal?.aborted) entry.cancel();
    });
  }
  async run<T>(work: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    await this.acquire(signal);
    try {
      signal?.throwIfAborted();
      return await work();
    } finally {
      this.active--;
      this.waiting.shift()?.start();
    }
  }
}
let selfHostedGate: ValhallaGate | undefined;
// Initialize on first request, after application environment loading and startup validation.
export function getSelfHostedValhallaGate() {
  if (!selfHostedGate) {
    const limits = valhallaLimits();
    selfHostedGate = new ValhallaGate(limits.concurrency, limits.queue);
  }
  return selfHostedGate;
}
