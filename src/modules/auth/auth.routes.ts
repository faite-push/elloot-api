import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { env } from "../../config/env";
import { withRlsTransaction, withServiceTransaction, } from "../../databases";
import { AppError } from "../../lib/errors";
import { asyncHandler } from "../../lib/async-handler";
import { sanitizeUserText } from "../../lib/sanitize";
import { requireAuth, signAccessToken } from "../../middleware/auth";
import { buildFrontendRedirect, getDiscordAuthUrl, getGoogleAuthUrl, handleOAuthCallback, } from "./oauth.service";

export const authRouter = Router();

const registerSchema = z.object({
  email: z.email(),
  password: z.string().min(8).max(72),
  name: z.string().trim().min(2).max(80).optional(),
});

const loginSchema = z.object({
  email: z.email(),
  password: z.string().min(1),
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
    });

    res.status(201).json({ user, accessToken });
  }),
);

authRouter.post(
  "/login",
  asyncHandler(async (req, res) => {
    const body = loginSchema.parse(req.body);
    const email = body.email.toLowerCase();

    const user = await withServiceTransaction(async (tx) =>
      tx.user.findUnique({ where: { email } }),
    );

    if (!user) {
      throw new AppError(401, "Invalid credentials", "INVALID_CREDENTIALS");
    }
    if (!user.passwordHash) {
      throw new AppError(
        401,
        "This account uses social login. Sign in with Google or Discord.",
        "SOCIAL_LOGIN_REQUIRED",
      );
    }

    const valid = await bcrypt.compare(body.password, user.passwordHash);
    if (!valid) {
      throw new AppError(401, "Invalid credentials", "INVALID_CREDENTIALS");
    }

    const accessToken = signAccessToken({
      id: user.id,
      email: user.email,
      role: user.role,
    });

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

    res.json({ user });
  }),
);

authRouter.get(
  "/google",
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
      res.json(result);
      return;
    }

    res.redirect(buildFrontendRedirect(result.accessToken));
  }),
);

authRouter.get(
  "/discord",
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
      res.json(result);
      return;
    }

    res.redirect(buildFrontendRedirect(result.accessToken));
  }),
);
