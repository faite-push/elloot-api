import {
  withRlsTransaction,
  withServiceTransaction,
  type RlsActor,
} from "../../databases";
import {
  defaultPreferences,
  isInAppLocked,
  isNotificationCategory,
  NOTIFICATION_CATEGORIES,
  type CategoryPreference,
  type NotificationCategory,
} from "./notification-categories";

export async function getMyNotificationPreferences(actor: RlsActor) {
  const rows = await withRlsTransaction({ actor }, (tx) =>
    tx.notificationPreference.findMany({
      where: { userId: actor.id },
      select: { category: true, inApp: true, push: true },
    }),
  );

  const byCategory = new Map(
    rows
      .filter((r) => isNotificationCategory(r.category))
      .map((r) => [r.category as NotificationCategory, r]),
  );

  return NOTIFICATION_CATEGORIES.map((category) => {
    const row = byCategory.get(category);
    const locked = isInAppLocked(category);
    return {
      category,
      inApp: locked ? true : (row?.inApp ?? true),
      push: row?.push ?? true,
      inAppLocked: locked,
    } satisfies CategoryPreference;
  });
}

/** Service-role lookup used when emitting notifications. */
export async function getUserChannelPrefs(
  userId: string,
  category: NotificationCategory,
): Promise<{ inApp: boolean; push: boolean }> {
  const locked = isInAppLocked(category);
  const row = await withServiceTransaction(async (tx) =>
    tx.notificationPreference.findUnique({
      where: {
        userId_category: { userId, category },
      },
      select: { inApp: true, push: true },
    }),
  );

  return {
    inApp: locked ? true : (row?.inApp ?? true),
    push: row?.push ?? true,
  };
}

export async function updateMyNotificationPreferences(
  actor: RlsActor,
  updates: Array<{ category: NotificationCategory; inApp?: boolean; push?: boolean }>,
) {
  await withRlsTransaction({ actor }, async (tx) => {
    for (const update of updates) {
      if (!isNotificationCategory(update.category)) continue;
      const locked = isInAppLocked(update.category);

      await tx.notificationPreference.upsert({
        where: {
          userId_category: {
            userId: actor.id,
            category: update.category,
          },
        },
        create: {
          userId: actor.id,
          category: update.category,
          inApp: locked ? true : (update.inApp ?? true),
          push: update.push ?? true,
        },
        update: {
          ...(update.inApp !== undefined
            ? { inApp: locked ? true : update.inApp }
            : locked
              ? { inApp: true }
              : {}),
          ...(update.push !== undefined ? { push: update.push } : {}),
        },
      });
    }
  });

  return getMyNotificationPreferences(actor);
}

export function preferencesOrDefaults(
  prefs: CategoryPreference[] | null | undefined,
) {
  return prefs?.length ? prefs : defaultPreferences();
}
