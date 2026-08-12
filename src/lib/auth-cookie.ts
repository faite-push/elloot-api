import type { CookieOptions, Request, Response } from "express";
import { env } from "../config/env";

export const ACCESS_COOKIE_NAME = "elloot_at";

function cookieCrossSite(): boolean {
  try {
    const corsOrigin = env.CORS_ORIGIN.split(",")[0]?.trim();
    if (!corsOrigin) return true;
    return new URL(corsOrigin).origin !== new URL(env.APP_URL).origin;
  } catch {
    return true;
  }
}

/** Parse JWT_EXPIRES_IN like "7d" / "12h" / "3600" into maxAge ms. */
export function jwtExpiresMs(): number {
  const raw = env.JWT_EXPIRES_IN.trim();
  const match = /^(\d+)([smhd])?$/i.exec(raw);
  if (!match) return 7 * 24 * 60 * 60 * 1000;
  const n = Number(match[1]);
  const unit = (match[2] ?? "s").toLowerCase();
  const mult =
    unit === "d"
      ? 86_400_000
      : unit === "h"
        ? 3_600_000
        : unit === "m"
          ? 60_000
          : 1_000;
  return n * mult;
}

export function authCookieOptions(): CookieOptions {
  const crossSite = cookieCrossSite();
  return {
    httpOnly: true,
    path: "/",
    maxAge: jwtExpiresMs(),
    // Cross-origin SPA (e.g. :3000 → :5000) needs None+Secure; localhost allows Secure.
    sameSite: crossSite ? "none" : "lax",
    secure: crossSite || env.NODE_ENV === "production",
  };
}

export function setAuthCookie(res: Response, token: string) {
  res.cookie(ACCESS_COOKIE_NAME, token, authCookieOptions());
}

export function clearAuthCookie(res: Response) {
  res.clearCookie(ACCESS_COOKIE_NAME, {
    ...authCookieOptions(),
    maxAge: 0,
  });
}

/** Prefer httpOnly cookie; Bearer kept for tooling / non-browser clients. */
export function extractAccessToken(req: Request): string | null {
  const cookie = req.cookies?.[ACCESS_COOKIE_NAME];
  if (typeof cookie === "string" && cookie.length > 0) {
    return cookie;
  }
  const header = req.headers.authorization;
  if (header?.startsWith("Bearer ") && header.length > 7) {
    return header.slice("Bearer ".length).trim() || null;
  }
  return null;
}
