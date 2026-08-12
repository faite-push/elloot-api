import type { NextFunction, Request, Response } from "express";
import { extractAccessToken } from "../lib/auth-cookie";
import { authenticateAccessToken } from "./auth";

/** Attach user when Bearer/cookie token is present; never fails the request. */
export function optionalAuth(req: Request, _res: Response, next: NextFunction) {
  const token = extractAccessToken(req);
  if (!token) {
    return next();
  }

  void (async () => {
    try {
      const { user } = await authenticateAccessToken(token);
      req.user = user;
      req.accessToken = token;
    } catch {
      // ignore invalid/revoked token for optional auth
    }
    next();
  })();
}
