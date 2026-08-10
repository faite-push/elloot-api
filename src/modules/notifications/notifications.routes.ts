import { Router } from "express";
import { asyncHandler } from "../../lib/async-handler";
import { routeParam } from "../../lib/route-param";
import { requireAuth } from "../../middleware/auth";
import type { RlsActor } from "../../databases";
import {
  listMyNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from "./notifications.service";

export const notificationsRouter = Router();

function actorOf(req: { user?: RlsActor }): RlsActor {
  return { id: req.user!.id, role: req.user!.role };
}

notificationsRouter.get(
  "/mine",
  requireAuth,
  asyncHandler(async (req, res) => {
    const actor = actorOf(req);
    const unreadOnly = req.query.unread === "1" || req.query.unread === "true";
    const notifications = await listMyNotifications(actor, { unreadOnly });
    res.json({ notifications });
  }),
);

notificationsRouter.post(
  "/mine/read-all",
  requireAuth,
  asyncHandler(async (req, res) => {
    const actor = actorOf(req);
    await markAllNotificationsRead(actor);
    res.json({ ok: true });
  }),
);

notificationsRouter.post(
  "/:id/read",
  requireAuth,
  asyncHandler(async (req, res) => {
    const actor = actorOf(req);
    const notification = await markNotificationRead(
      actor,
      routeParam(req.params.id),
    );
    res.json({ notification });
  }),
);
