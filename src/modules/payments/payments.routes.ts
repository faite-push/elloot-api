import { timingSafeEqual } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { env } from "../../config/env";
import { asyncHandler } from "../../lib/async-handler";
import { AppError } from "../../lib/errors";
import { requireAuth, requireRole } from "../../middleware/auth";
import type { RlsActor } from "../../databases";
import { confirmSandboxPayment } from "./sandbox.service";

export const paymentsRouter = Router();

const confirmSchema = z.object({
  providerRef: z.string().min(1),
});

function actorOf(req: { user?: RlsActor }): RlsActor {
  return { id: req.user!.id, role: req.user!.role };
}

function safeEqualSecret(provided: string, expected: string) {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** Sandbox only — buyer/admin simulates PIX paid. */
paymentsRouter.post(
  "/sandbox/confirm",
  requireAuth,
  asyncHandler(async (req, res) => {
    const body = confirmSchema.parse(req.body);
    const result = await confirmSandboxPayment(body.providerRef, actorOf(req));
    res.json({ ok: true, ...result });
  }),
);

/**
 * Gateway-style webhook. Requires SANDBOX_WEBHOOK_SECRET via
 * `x-sandbox-webhook-secret` or `Authorization: Bearer <secret>`.
 * Disabled when the secret is not configured.
 */
paymentsRouter.post(
  "/sandbox/webhook",
  asyncHandler(async (req, res) => {
    const configured = env.SANDBOX_WEBHOOK_SECRET?.trim();
    if (!configured) {
      throw new AppError(
        503,
        "Sandbox webhook is disabled",
        "WEBHOOK_DISABLED",
      );
    }

    const headerSecret =
      (typeof req.headers["x-sandbox-webhook-secret"] === "string"
        ? req.headers["x-sandbox-webhook-secret"]
        : null) ??
      (typeof req.headers.authorization === "string" &&
      req.headers.authorization.toLowerCase().startsWith("bearer ")
        ? req.headers.authorization.slice(7).trim()
        : null);

    if (!headerSecret || !safeEqualSecret(headerSecret, configured)) {
      throw new AppError(401, "Invalid webhook secret", "WEBHOOK_UNAUTHORIZED");
    }

    const body = confirmSchema.parse(req.body);
    const result = await confirmSandboxPayment(body.providerRef, null, {
      viaWebhook: true,
    });
    res.json({ received: true, ...result });
  }),
);

paymentsRouter.post(
  "/sandbox/confirm-admin",
  requireAuth,
  requireRole("ADMIN"),
  asyncHandler(async (req, res) => {
    const body = confirmSchema.parse(req.body);
    const result = await confirmSandboxPayment(body.providerRef, actorOf(req));
    res.json({ ok: true, ...result });
  }),
);
