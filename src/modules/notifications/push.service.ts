import webpush from "web-push";
import { env } from "../../config/env";
import {
  withRlsTransaction,
  withServiceTransaction,
  type RlsActor,
} from "../../databases";

export function isWebPushConfigured() {
  return Boolean(
    env.VAPID_PUBLIC_KEY?.trim() &&
      env.VAPID_PRIVATE_KEY?.trim() &&
      env.VAPID_SUBJECT?.trim(),
  );
}

function configureWebPush() {
  if (!isWebPushConfigured()) return false;
  webpush.setVapidDetails(
    env.VAPID_SUBJECT!,
    env.VAPID_PUBLIC_KEY!,
    env.VAPID_PRIVATE_KEY!,
  );
  return true;
}

export function getPushPublicConfig() {
  if (!isWebPushConfigured()) {
    return { enabled: false as const, publicKey: null };
  }
  return {
    enabled: true as const,
    publicKey: env.VAPID_PUBLIC_KEY!,
  };
}

export async function upsertPushSubscription(
  actor: RlsActor,
  input: {
    endpoint: string;
    p256dh: string;
    auth: string;
    userAgent?: string | null;
  },
) {
  return withRlsTransaction({ actor }, (tx) =>
    tx.pushSubscription.upsert({
      where: { endpoint: input.endpoint },
      create: {
        userId: actor.id,
        endpoint: input.endpoint,
        p256dh: input.p256dh,
        auth: input.auth,
        userAgent: input.userAgent ?? null,
      },
      update: {
        userId: actor.id,
        p256dh: input.p256dh,
        auth: input.auth,
        userAgent: input.userAgent ?? null,
      },
      select: {
        id: true,
        endpoint: true,
        createdAt: true,
        updatedAt: true,
      },
    }),
  );
}

export async function deletePushSubscription(
  actor: RlsActor,
  endpoint: string,
) {
  await withRlsTransaction({ actor }, async (tx) => {
    await tx.pushSubscription.deleteMany({
      where: { userId: actor.id, endpoint },
    });
  });
}

export async function sendWebPushToUser(
  userId: string,
  payload: {
    title: string;
    body: string;
    href?: string | null;
    tag?: string;
  },
) {
  if (!configureWebPush()) return { sent: 0 };

  const subs = await withServiceTransaction(async (tx) =>
    tx.pushSubscription.findMany({
      where: { userId },
      select: {
        id: true,
        endpoint: true,
        p256dh: true,
        auth: true,
      },
    }),
  );

  if (subs.length === 0) return { sent: 0 };

  const body = JSON.stringify({
    title: payload.title,
    body: payload.body,
    href: payload.href ?? "/dashboard/notifications",
    tag: payload.tag ?? "elloot",
    icon: "/icons/notification-192.png",
    badge: "/icons/notification-badge.png",
    image: "/icons/notification-banner.png",
  });

  let sent = 0;
  for (const sub of subs) {
    try {
      await webpush.sendNotification(
        {
          endpoint: sub.endpoint,
          keys: { p256dh: sub.p256dh, auth: sub.auth },
        },
        body,
      );
      sent += 1;
    } catch (err) {
      const statusCode =
        err && typeof err === "object" && "statusCode" in err
          ? Number((err as { statusCode?: number }).statusCode)
          : 0;
      if (statusCode === 404 || statusCode === 410) {
        await withServiceTransaction(async (tx) => {
          await tx.pushSubscription.deleteMany({
            where: { id: sub.id },
          });
        }).catch(() => undefined);
      }
    }
  }

  return { sent };
}
