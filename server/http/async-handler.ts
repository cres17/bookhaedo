import type { Request, Response, NextFunction } from 'express';
/** Propagate failures without advancing the chain twice. */
export const wrap =
  (handler: (req: Request, res: Response, next: NextFunction) => unknown) =>
  (req: Request, res: Response, next: NextFunction) => {
    return Promise.resolve()
      .then(() => handler(req, res, next))
      .catch(next);
  };
