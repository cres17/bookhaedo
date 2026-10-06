import type { Request, Response } from 'express';
export class OperationError extends Error {
  constructor(public code: 'REQUEST_DEADLINE_EXCEEDED' | 'REQUEST_CANCELLED') {
    super(code);
  }
}
export function operationError(signal: AbortSignal) {
  return signal.reason instanceof OperationError
    ? signal.reason
    : new OperationError('REQUEST_CANCELLED');
}
export function operationBudget(ms = 15000, parent?: AbortSignal) {
  if (!Number.isSafeInteger(ms) || ms < 1) throw Error('Invalid operation budget');
  const controller = new AbortController();
  const cancel = () =>
    controller.abort(parent ? operationError(parent) : new OperationError('REQUEST_CANCELLED'));
  if (parent?.aborted) cancel();
  else parent?.addEventListener('abort', cancel, { once: true });
  const timer = setTimeout(
    () => controller.abort(new OperationError('REQUEST_DEADLINE_EXCEEDED')),
    ms,
  );
  timer.unref();
  return {
    signal: controller.signal,
    cancel,
    dispose: () => {
      clearTimeout(timer);
      parent?.removeEventListener('abort', cancel);
    },
  };
}
export function abortable<T>(work: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return work();
  if (signal.aborted) return Promise.reject(operationError(signal));
  return new Promise<T>((resolve, reject) => {
    const cleanup = () => signal.removeEventListener('abort', cancel);
    const cancel = () => {
      cleanup();
      reject(operationError(signal));
    };
    signal.addEventListener('abort', cancel, { once: true });
    Promise.resolve()
      .then(() => {
        if (signal.aborted) throw operationError(signal);
        return work();
      })
      .then(
        (value) => {
          cleanup();
          resolve(value);
        },
        (error) => {
          cleanup();
          reject(error);
        },
      );
  });
}
// Attach only to read-only recommendation operations. A write's COMMIT may outlive its HTTP response.
export function recommendationRequestBudget(req: Request, res: Response, ms = 15000) {
  const budget = operationBudget(ms);
  const close = () => {
    if (!res.writableFinished) budget.cancel();
    cleanup();
  };
  const cleanup = () => {
    budget.dispose();
    res.off('finish', cleanup);
    res.off('close', close);
    req.off('aborted', close);
  };
  res.once('finish', cleanup);
  res.once('close', close);
  req.once('aborted', close);
  return { ...budget, run: <T>(work: () => Promise<T>) => abortable(work, budget.signal) };
}
