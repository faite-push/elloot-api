import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../../lib/async-handler";
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

/** Sandbox only — simulates PIX/webhook paid. */
paymentsRouter.post(
  "/sandbox/confirm",
  requireAuth,
  asyncHandler(async (req, res) => {
    const body = confirmSchema.parse(req.body);
    const result = await confirmSandboxPayment(body.providerRef, actorOf(req));
    res.json({ ok: true, ...result });
  }),
);

/** Gateway-style webhook (no user JWT); runs as service. */
paymentsRouter.post(
  "/sandbox/webhook",
  asyncHandler(async (req, res) => {
    const body = confirmSchema.parse(req.body);
    const result = await confirmSandboxPayment(body.providerRef, null);
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
