import { Router } from "express";
import { asyncHandler } from "../../lib/async-handler";
import { requireJobAuth } from "../../middleware/job-auth";
import {
  autoReleaseDueEscrows,
  expirePendingOrders,
} from "../orders/orders.lifecycle";

export const jobsRouter = Router();

jobsRouter.post(
  "/expire-checkouts",
  requireJobAuth,
  asyncHandler(async (_req, res) => {
    const result = await expirePendingOrders();
    res.json({ ok: true, ...result });
  }),
);

jobsRouter.post(
  "/auto-release-escrow",
  requireJobAuth,
  asyncHandler(async (_req, res) => {
    const result = await autoReleaseDueEscrows();
    res.json({ ok: true, ...result });
  }),
);

jobsRouter.post(
  "/run",
  requireJobAuth,
  asyncHandler(async (_req, res) => {
    const expired = await expirePendingOrders();
    const released = await autoReleaseDueEscrows();
    res.json({ ok: true, ...expired, ...released });
  }),
);
