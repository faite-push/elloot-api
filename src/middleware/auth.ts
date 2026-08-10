import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { env } from "../config/env";
import { AppError } from "../lib/errors";

export type AuthUser = {
  id: string;
  email: string;
  role: "BUYER" | "SELLER" | "ADMIN";
};

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

type JwtPayload = {
  sub: string;
  email: string;
  role: AuthUser["role"];
};

export function signAccessToken(user: AuthUser) {
  return jwt.sign(
    {
      email: user.email,
      role: user.role,
    },
    env.JWT_SECRET,
    {
      subject: user.id,
      expiresIn: env.JWT_EXPIRES_IN as jwt.SignOptions["expiresIn"],
    },
  );
}

export function verifyAccessToken(token: string): AuthUser {
  try {
    const payload = jwt.verify(token, env.JWT_SECRET) as JwtPayload;
    if (!payload.sub || !payload.email || !payload.role) {
      throw new Error("invalid payload");
    }
    return {
      id: payload.sub,
      email: payload.email,
      role: payload.role,
    };
  } catch {
    throw new AppError(401, "Invalid or expired token", "UNAUTHORIZED");
  }
}

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return next(new AppError(401, "Unauthorized", "UNAUTHORIZED"));
  }

  const token = header.slice("Bearer ".length);

  try {
    req.user = verifyAccessToken(token);
    next();
  } catch (err) {
    next(
      err instanceof AppError
        ? err
        : new AppError(401, "Invalid or expired token", "UNAUTHORIZED"),
    );
  }
}

export function requireRole(...roles: AuthUser["role"][]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) {
      return next(new AppError(401, "Unauthorized", "UNAUTHORIZED"));
    }
    if (!roles.includes(req.user.role)) {
      return next(new AppError(403, "Forbidden", "FORBIDDEN"));
    }
    next();
  };
}
