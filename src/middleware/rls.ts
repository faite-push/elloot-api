import type { NextFunction, Request, Response } from "express";
import { withRlsTransaction, type RlsActor } from "../databases/postgres/rls";

export type RlsRequest = Request & {
  rlsActor?: RlsActor | null;
};

/** Attach RLS actor from JWT user (call after requireAuth / optionalAuth). */
export function bindRlsActor(req: Request, _res: Response, next: NextFunction) {
  const r = req as RlsRequest;
  if (req.user) {
    r.rlsActor = { id: req.user.id, role: req.user.role };
  } else {
    r.rlsActor = null;
  }
  next();
}

export function getRlsActor(req: Request): RlsActor | null {
  return (req as RlsRequest).rlsActor ?? (req.user
    ? { id: req.user.id, role: req.user.role }
    : null);
}

/** Helper for route handlers that need a user-scoped RLS transaction. */
export function rlsTransaction<T>(
  req: Request,
  fn: Parameters<typeof withRlsTransaction<T>>[1],
  options?: { asService?: boolean },
) {
  return withRlsTransaction(
    {
      actor: getRlsActor(req),
      asService: options?.asService,
    },
    fn,
  );
}
