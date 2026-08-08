import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { env } from "../config/env";
import type { AuthUser } from "./auth";

type JwtPayload = {
  sub: string;
  email: string;
  role: AuthUser["role"];
};

/** Attach user when Bearer token is present; never fails the request. */
export function optionalAuth(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return next();
  }

  try {
    const payload = jwt.verify(
      header.slice("Bearer ".length),
      env.JWT_SECRET,
    ) as JwtPayload;
    req.user = {
      id: payload.sub,
      email: payload.email,
      role: payload.role,
    };
  } catch {
    // ignore invalid token for optional auth
  }

  next();
}
