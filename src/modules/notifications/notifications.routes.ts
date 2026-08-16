import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../../lib/async-handler";
import { routeParam } from "../../lib/route-param";
import { requireAuth } from "../../middleware/auth";
import type { RlsActor } from "../../databases";
import {
  countUnreadNotifications,
  listMyNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from "./notifications.service";
import {
  getMyNotificationPreferences,
  updateMyNotificationPreferences,
} from "./preferences.service";
import {
  deletePushSubscription,
  getPushPublicConfig,
  upsertPushSubscription,
} from "./push.service";
import {
  isNotificationCategory,
  NOTIFICATION_CATEGORIES,
} from "./notification-categories";

export const notificationsRouter = Router();

function actorOf(req: { user?: RlsActor }): RlsActor {
  return { id: req.user!.id, role: req.user!.role };
}

const preferenceUpdateSchema = z.object({
  preferences: z
    .array(
      z.object({
        category: z.enum(NOTIFICATION_CATEGORIES),
        inApp: z.boolean().optional(),
        push: z.boolean().optional(),
      }),
    )
    .min(1)
    .max(NOTIFICATION_CATEGORIES.length),
});

const pushSubscribeSchema = z.object({
  endpoint: z.string().url().max(2048),
  keys: z.object({
    p256dh: z.string().min(10).max(512),
    auth: z.string().min(8).max(256),
  }),
  userAgent: z.string().max(400).optional(),
});

const pushUnsubscribeSchema = z.object({
  endpoint: z.string().url().max(2048),
});

notificationsRouter.get(
  "/mine",
  requireAuth,
  asyncHandler(async (req, res) => {
    const actor = actorOf(req);
    const unreadOnly = req.query.unread === "1" || req.query.unread === "true";
    const take = Math.min(Number(req.query.take) || 40, 100);
    const cursor =
      typeof req.query.cursor === "string" ? req.query.cursor : undefined;
    const result = await listMyNotifications(actor, {
      unreadOnly,
      take,
      cursor,
    });
    res.json(result);
  }),
);

notificationsRouter.get(
  "/mine/unread-count",
  requireAuth,
  asyncHandler(async (req, res) => {
    const actor = actorOf(req);
    const unreadCount = await countUnreadNotifications(actor);
    res.json({ unreadCount });
  }),
);

notificationsRouter.get(
  "/preferences",
  requireAuth,
  asyncHandler(async (req, res) => {
    const actor = actorOf(req);
    const preferences = await getMyNotificationPreferences(actor);
    res.json({ preferences });
  }),
);

notificationsRouter.patch(
  "/preferences",
  requireAuth,
  asyncHandler(async (req, res) => {
    const actor = actorOf(req);
    const body = preferenceUpdateSchema.parse(req.body);
    const preferences = await updateMyNotificationPreferences(
      actor,
      body.preferences.filter((p) => isNotificationCategory(p.category)),
    );
    res.json({ preferences });
  }),
);

notificationsRouter.get(
  "/push/config",
  requireAuth,
  asyncHandler(async (_req, res) => {
    res.json(getPushPublicConfig());
  }),
);

notificationsRouter.post(
  "/push/subscribe",
  requireAuth,
  asyncHandler(async (req, res) => {
    const actor = actorOf(req);
    const body = pushSubscribeSchema.parse(req.body);
    const subscription = await upsertPushSubscription(actor, {
      endpoint: body.endpoint,
      p256dh: body.keys.p256dh,
      auth: body.keys.auth,
      userAgent: body.userAgent ?? req.get("user-agent") ?? null,
    });
    res.status(201).json({ subscription });
  }),
);

notificationsRouter.post(
  "/push/unsubscribe",
  requireAuth,
  asyncHandler(async (req, res) => {
    const actor = actorOf(req);
    const body = pushUnsubscribeSchema.parse(req.body);
    await deletePushSubscription(actor, body.endpoint);
    res.json({ ok: true });
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
