import type { Prisma } from "@prisma/client";
import { createNotification } from "../notifications/notifications.service";
import { emitNotificationNew } from "../../realtime/emit";
import { categoryFromType } from "../notifications/notification-categories";
import { getUserChannelPrefs } from "../notifications/preferences.service";
import { sendWebPushToUser } from "../notifications/push.service";

type NotifyInput = {
  userId: string;
  type: string;
  title: string;
  body: string;
  href?: string | null;
  meta?: Prisma.InputJsonValue;
};

/** Create + emit + optional web push; respects user preferences. */
export async function notifyUser(input: NotifyInput) {
  try {
    const category = categoryFromType(input.type);
    const prefs = await getUserChannelPrefs(input.userId, category);

    let notification: Awaited<ReturnType<typeof createNotification>> | null =
      null;

    if (prefs.inApp) {
      notification = await createNotification(input);
      emitNotificationNew(input.userId, notification);
    }

    if (prefs.push) {
      void sendWebPushToUser(input.userId, {
        title: input.title,
        body: input.body,
        href: input.href,
        tag: `${category}-${notification?.id ?? Date.now()}`,
      });
    }

    return notification;
  } catch {
    return null;
  }
}
