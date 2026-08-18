import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { env } from "../../config/env";
import { withRlsTransaction, withServiceTransaction } from "../../databases";
import { AppError } from "../../lib/errors";
import { asyncHandler } from "../../lib/async-handler";
import { clearAuthCookie, extractAccessToken, setAuthCookie } from "../../lib/auth-cookie";
import { sanitizeUserText } from "../../lib/sanitize";
import {
  requireAuth,
  sessionUserFromAuth,
  signAccessToken,
  verifyAccessToken,
} from "../../middleware/auth";
import {
  authOauthStartLimiter,
  authStrictLimiter,
} from "../../middleware/rate-limit";
import { isAccessTokenRevoked, revokeAccessToken } from "./token-revoke";
import {
  buildFrontendRedirect,
  consumeOAuthExchangeCode,
  getDiscordAuthUrl,
  getGoogleAuthUrl,
  handleOAuthCallback,
} from "./oauth.service";

export const authRouter = Router();

function syncAuthCookie(
  res: Parameters<typeof setAuthCookie>[0],
  user: {
    id: string;
    email: string;
    role: "BUYER" | "SELLER" | "ADMIN";
    name?: string | null;
    avatarUrl?: string | null;
    kycStatus?: "NONE" | "PENDING" | "APPROVED" | "REJECTED";
  },
  current?: {
    name?: string | null;
    avatarUrl?: string | null;
    role?: string;
    kycStatus?: string | null;
  },
) {
  const stale =
    !current ||
    (current.name ?? null) !== (user.name ?? null) ||
    (current.avatarUrl ?? null) !== (user.avatarUrl ?? null) ||
    current.role !== user.role ||
    (current.kycStatus ?? "NONE") !== (user.kycStatus ?? "NONE");
  if (!stale) return;
  setAuthCookie(
    res,
    signAccessToken({
      id: user.id,
      email: user.email,
      role: user.role,
      name: user.name,
      avatarUrl: user.avatarUrl,
      kycStatus: user.kycStatus,
    }),
  );
}

const registerSchema = z.object({
  email: z.email(),
  password: z.string().min(8).max(72),
  name: z.string().trim().min(2).max(80).optional(),
});

const loginSchema = z.object({
  email: z.email(),
  password: z.string().min(1),
});

const oauthExchangeSchema = z.object({
  code: z.string().min(16).max(128),
});

authRouter.get("/providers", (_req, res) => {
  res.json({
    providers: {
      email: true,
      google: env.googleEnabled,
      discord: env.discordEnabled,
    },
  });
});

authRouter.post(
  "/register",
  authStrictLimiter,
  asyncHandler(async (req, res) => {
    const body = registerSchema.parse(req.body);
    const name = body.name ? sanitizeUserText(body.name, 80) : undefined;
    const email = body.email.toLowerCase();

    const user = await withServiceTransaction(async (tx) => {
      const existing = await tx.user.findUnique({ where: { email } });
      if (existing) {
        throw new AppError(409, "Email already registered", "EMAIL_TAKEN");
      }

      const passwordHash = await bcrypt.hash(body.password, 12);
      return tx.user.create({
        data: {
          email,
          passwordHash,
          name,
          role: "BUYER",
          // Email ownership is not proven at register time.
          emailVerifiedAt: null,
          lastSeenAt: new Date(),
        },
        select: {
          id: true,
          email: true,
          name: true,
          avatarUrl: true,
          role: true,
          kycStatus: true,
          createdAt: true,
        },
      });
    });

    const accessToken = signAccessToken({
      id: user.id,
      email: user.email,
      role: user.role,
      name: user.name,
      avatarUrl: user.avatarUrl,
      kycStatus: user.kycStatus,
    });
    setAuthCookie(res, accessToken);

    res.status(201).json({ user, accessToken });
  }),
);

authRouter.post(
  "/login",
  authStrictLimiter,
  asyncHandler(async (req, res) => {
    const body = loginSchema.parse(req.body);
    const email = body.email.toLowerCase();

    const user = await withServiceTransaction(async (tx) =>
      tx.user.findUnique({ where: { email } }),
    );

    if (!user || !user.passwordHash) {
      // Uniform message to reduce account enumeration.
      throw new AppError(401, "Invalid credentials", "INVALID_CREDENTIALS");
    }

    const valid = await bcrypt.compare(body.password, user.passwordHash);
    if (!valid) {
      throw new AppError(401, "Invalid credentials", "INVALID_CREDENTIALS");
    }

    await withServiceTransaction(async (tx) =>
      tx.user.update({
        where: { id: user.id },
        data: { lastSeenAt: new Date() },
      }),
    );

    const accessToken = signAccessToken({
      id: user.id,
      email: user.email,
      role: user.role,
      name: user.name,
      avatarUrl: user.avatarUrl,
      kycStatus: user.kycStatus,
    });
    setAuthCookie(res, accessToken);

    res.json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        avatarUrl: user.avatarUrl,
        role: user.role,
        kycStatus: user.kycStatus,
        createdAt: user.createdAt,
      },
      accessToken,
    });
  }),
);

authRouter.post(
  "/logout",
  asyncHandler(async (req, res) => {
    const token = extractAccessToken(req);
    if (token) {
      try {
        const payload = verifyAccessToken(token);
        await revokeAccessToken(token, {
          jti: payload.jti,
          expiresAtMs: payload.exp ? payload.exp * 1000 : undefined,
        });
      } catch {
        // still clear cookie
      }
    }
    clearAuthCookie(res);
    res.json({ ok: true });
  }),
);

/** Fast session from JWT claims — no DB. Used by the navbar. */
authRouter.get(
  "/session",
  asyncHandler(async (req, res) => {
    const token = extractAccessToken(req);
    if (!token) {
      throw new AppError(401, "Unauthorized", "UNAUTHORIZED");
    }

    const payload = verifyAccessToken(token);
    const revoked = await isAccessTokenRevoked({
      jti: payload.jti,
      token,
    });
    if (revoked) {
      throw new AppError(401, "Token revoked", "TOKEN_REVOKED");
    }

    res.json({ user: sessionUserFromAuth(payload) });
  }),
);

/** Exchange one-time OAuth code for session (sets httpOnly cookie + returns token). */
authRouter.post(
  "/oauth/exchange",
  authStrictLimiter,
  asyncHandler(async (req, res) => {
    const body = oauthExchangeSchema.parse(req.body);
    const accessToken = await consumeOAuthExchangeCode(body.code);
    if (!accessToken) {
      throw new AppError(
        400,
        "Invalid or expired OAuth code",
        "OAUTH_EXCHANGE_INVALID",
      );
    }

    const authUser = verifyAccessToken(accessToken);
    const actor = { id: authUser.id, role: authUser.role };
    const user = await withServiceTransaction(async (tx) =>
      tx.user.findUnique({
        where: { id: actor.id },
        select: {
          id: true,
          email: true,
          name: true,
          avatarUrl: true,
          role: true,
          kycStatus: true,
          createdAt: true,
        },
      }),
    );

    if (!user) {
      throw new AppError(401, "Unauthorized", "UNAUTHORIZED");
    }

    setAuthCookie(res, accessToken);
    res.json({ user, accessToken });
  }),
);

const meSelect = {
  id: true,
  email: true,
  name: true,
  avatarUrl: true,
  role: true,
  kycStatus: true,
  pixKey: true,
  createdAt: true,
  accounts: {
    select: { provider: true, createdAt: true },
  },
} as const;

const updateMeSchema = z
  .object({
    name: z.string().trim().min(2).max(80).nullable().optional(),
    avatarUrl: z.url().nullable().optional(),
    pixKey: z.string().trim().min(3).max(140).nullable().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: "Provide at least one field to update",
  });

authRouter.get(
  "/me",
  requireAuth,
  asyncHandler(async (req, res) => {
    const actor = { id: req.user!.id, role: req.user!.role };
    const user = await withRlsTransaction({ actor }, (tx) =>
      tx.user.findUnique({
        where: { id: actor.id },
        select: meSelect,
      }),
    );

    if (!user) {
      throw new AppError(401, "Unauthorized", "UNAUTHORIZED");
    }

    syncAuthCookie(res, user, req.user);
    res.json({ user });
  }),
);

authRouter.patch(
  "/me",
  requireAuth,
  asyncHandler(async (req, res) => {
    const body = updateMeSchema.parse(req.body);
    const actor = { id: req.user!.id, role: req.user!.role };

    const user = await withRlsTransaction({ actor }, (tx) =>
      tx.user.update({
        where: { id: actor.id },
        data: {
          name:
            body.name === undefined
              ? undefined
              : body.name === null
                ? null
                : sanitizeUserText(body.name, 80),
          avatarUrl: body.avatarUrl === undefined ? undefined : body.avatarUrl,
          pixKey:
            body.pixKey === undefined
              ? undefined
              : body.pixKey === null
                ? null
                : sanitizeUserText(body.pixKey, 140),
        },
        select: meSelect,
      }),
    );

    syncAuthCookie(res, user);
    res.json({ user });
  }),
);

authRouter.get(
  "/google",
  authOauthStartLimiter,
  asyncHandler(async (_req, res) => {
    const url = await getGoogleAuthUrl();
    res.redirect(url);
  }),
);

authRouter.get(
  "/google/callback",
  asyncHandler(async (req, res) => {
    const result = await handleOAuthCallback(
      "google",
      typeof req.query.code === "string" ? req.query.code : undefined,
      typeof req.query.state === "string" ? req.query.state : undefined,
    );

    if (req.query.format === "json") {
      // Still avoid returning long-lived token in browser redirects; JSON
      // clients must be trusted (dev/tools). Prefer oauth/exchange.
      res.json({
        user: result.user,
        exchangeHint: "Use browser redirect flow; token omitted in json mode",
      });
      return;
    }

    res.redirect(await buildFrontendRedirect(result.accessToken));
  }),
);

authRouter.get(
  "/discord",
  authOauthStartLimiter,
  asyncHandler(async (_req, res) => {
    const url = await getDiscordAuthUrl();
    res.redirect(url);
  }),
);

authRouter.get(
  "/discord/callback",
  asyncHandler(async (req, res) => {
    const result = await handleOAuthCallback(
      "discord",
      typeof req.query.code === "string" ? req.query.code : undefined,
      typeof req.query.state === "string" ? req.query.state : undefined,
    );

    if (req.query.format === "json") {
      res.json({
        user: result.user,
        exchangeHint: "Use browser redirect flow; token omitted in json mode",
      });
      return;
    }

    res.redirect(await buildFrontendRedirect(result.accessToken));
  }),
);
