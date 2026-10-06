import { BoundedConcurrencyGate } from './concurrency-gate.js';
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
export class ValhallaGate extends BoundedConcurrencyGate {
  constructor(capacity: number, maxQueue: number) {
    super(capacity, maxQueue, 'VALHALLA_QUEUE_FULL');
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
