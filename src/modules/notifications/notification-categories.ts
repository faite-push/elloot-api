export const NOTIFICATION_CATEGORIES = [
  "MESSAGE",
  "ORDER",
  "DISPUTE",
  "QUESTION",
  "REVIEW",
  "SYSTEM",
] as const;

export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];

export type CategoryPreference = {
  category: NotificationCategory;
  inApp: boolean;
  push: boolean;
  /** ORDER / DISPUTE keep in-app on for critical updates. */
  inAppLocked: boolean;
};

export function isNotificationCategory(
  value: string,
): value is NotificationCategory {
  return (NOTIFICATION_CATEGORIES as readonly string[]).includes(value);
}

export function categoryFromType(type: string): NotificationCategory {
  const t = type.toUpperCase();
  if (t.startsWith("MESSAGE")) return "MESSAGE";
  if (t.startsWith("ORDER")) return "ORDER";
  if (t.startsWith("DISPUTE")) return "DISPUTE";
  if (t.startsWith("QUESTION")) return "QUESTION";
  if (t.startsWith("REVIEW")) return "REVIEW";
  if (t.startsWith("LISTING") || t.startsWith("SYSTEM")) return "SYSTEM";
  return "SYSTEM";
}

export function isInAppLocked(category: NotificationCategory) {
  return category === "ORDER" || category === "DISPUTE";
}

export function defaultPreferences(): CategoryPreference[] {
  return NOTIFICATION_CATEGORIES.map((category) => ({
    category,
    inApp: true,
    push: true,
    inAppLocked: isInAppLocked(category),
  }));
}

export const CATEGORY_LABELS: Record<NotificationCategory, string> = {
  MESSAGE: "Chats",
  ORDER: "Pedidos",
  DISPUTE: "Disputas",
  QUESTION: "Perguntas",
  REVIEW: "Avaliações",
  SYSTEM: "Sistema e anúncios",
};
