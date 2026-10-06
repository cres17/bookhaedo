// Process-local bounded admission control shared by routing and SQL cancellation transports.
export class BoundedConcurrencyGate {
  private active = 0;
  private waiting: { start: () => void; cancel: () => void }[] = [];
  constructor(
    private readonly capacity: number,
    private readonly maxQueue: number,
    private readonly overflowCode = 'QUEUE_FULL',
  ) {
    if (!Number.isInteger(capacity) || capacity < 1 || !Number.isInteger(maxQueue) || maxQueue < 0)
      throw Error('Invalid concurrency gate limits');
  }
  private acquire(signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted();
    if (this.active < this.capacity) {
      this.active++;
      return Promise.resolve();
    }
    if (this.waiting.length >= this.maxQueue) throw Error(this.overflowCode);
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
