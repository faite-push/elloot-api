import type { NextFunction, Request, Response } from "express";
import { env } from "../config/env";
import { AppError } from "../lib/errors";
import { requireAuth, requireRole } from "./auth";

/** Allow `x-job-secret: JOB_SECRET` or ADMIN Bearer JWT. */
export function requireJobAuth(req: Request, res: Response, next: NextFunction) {
  const secret = env.JOB_SECRET;
  const header = req.headers["x-job-secret"];
  if (secret && typeof header === "string" && header === secret) {
    return next();
  }

  requireAuth(req, res, (authErr) => {
    if (authErr) {
      if (!secret) {
        return next(
          new AppError(
            403,
            "Set JOB_SECRET or authenticate as ADMIN to run jobs",
            "FORBIDDEN",
          ),
        );
      }
      return next(authErr);
    }
    return requireRole("ADMIN")(req, res, next);
  });
}
