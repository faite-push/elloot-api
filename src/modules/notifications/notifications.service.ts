import type { Prisma } from "@prisma/client";
import { withServiceTransaction, type RlsActor } from "../../databases";
import { AppError } from "../../lib/errors";
import { sanitizeUserText } from "../../lib/sanitize";

const notificationSelect = {
  id: true,
  type: true,
  title: true,
  body: true,
  href: true,
  readAt: true,
  createdAt: true,
  meta: true,
} satisfies Prisma.NotificationSelect;

export type NotificationDto = {
  id: string;
  type: string;
  title: string;
  body: string;
  href: string | null;
  readAt: string | null;
  createdAt: string;
  meta?: unknown;
};

function serialize(
  row: {
    id: string;
    type: string;
    title: string;
    body: string;
    href: string | null;
    readAt: Date | null;
    createdAt: Date;
    meta: Prisma.JsonValue | null;
  },
): NotificationDto {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    body: row.body,
    href: row.href,
    readAt: row.readAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    meta: row.meta ?? undefined,
  };
}

export async function createNotification(input: {
  userId: string;
  type: string;
  title: string;
  body: string;
  href?: string | null;
  meta?: Prisma.InputJsonValue;
}): Promise<NotificationDto> {
  const title = sanitizeUserText(input.title, 120);
  const body = sanitizeUserText(input.body, 500);
  const row = await withServiceTransaction(async (tx) =>
    tx.notification.create({
      data: {
        userId: input.userId,
        type: input.type,
        title,
        body,
        href: input.href ?? null,
        meta: input.meta,
      },
      select: notificationSelect,
    }),
  );
  return serialize(row);
}

export async function listMyNotifications(
  actor: RlsActor,
  opts?: { unreadOnly?: boolean; take?: number },
) {
  const take = Math.min(opts?.take ?? 40, 100);
  const rows = await withServiceTransaction(async (tx) =>
    tx.notification.findMany({
      where: {
        userId: actor.id,
        ...(opts?.unreadOnly ? { readAt: null } : {}),
      },
      orderBy: { createdAt: "desc" },
      take,
      select: notificationSelect,
    }),
  );
  return rows.map(serialize);
}

export async function markNotificationRead(
  actor: RlsActor,
  notificationId: string,
) {
  const updated = await withServiceTransaction(async (tx) => {
    const existing = await tx.notification.findFirst({
      where: { id: notificationId, userId: actor.id },
      select: { id: true },
    });
    if (!existing) {
      throw new AppError(404, "Notification not found", "NOT_FOUND");
    }
    return tx.notification.update({
      where: { id: notificationId },
      data: { readAt: new Date() },
      select: notificationSelect,
    });
  }, actor);
  return serialize(updated);
}

export async function markAllNotificationsRead(actor: RlsActor) {
  await withServiceTransaction(async (tx) => {
    await tx.notification.updateMany({
      where: { userId: actor.id, readAt: null },
      data: { readAt: new Date() },
    });
  }, actor);
}
