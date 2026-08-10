import {
  withRlsTransaction,
  withServiceTransaction,
  type RlsActor,
} from "../../databases";
import { AppError } from "../../lib/errors";
import { sanitizeUserText } from "../../lib/sanitize";
import { routes } from "./hrefs";
import { emitMessageNew, emitNotificationNew } from "../../realtime/emit";
import { createNotification } from "../notifications/notifications.service";

export const messageSelect = {
  id: true,
  conversationId: true,
  body: true,
  senderId: true,
  clientId: true,
  readAt: true,
  createdAt: true,
  sender: { select: { id: true, name: true } },
} as const;

function serializeMessage(
  message: {
    id: string;
    conversationId: string;
    body: string;
    senderId: string;
    clientId: string | null;
    readAt: Date | null;
    createdAt: Date;
    sender?: { id: string; name: string | null };
  },
) {
  return {
    id: message.id,
    conversationId: message.conversationId,
    body: message.body,
    senderId: message.senderId,
    clientId: message.clientId,
    readAt: message.readAt?.toISOString() ?? null,
    createdAt: message.createdAt.toISOString(),
    sender: message.sender,
  };
}

export async function sendConversationMessage(input: {
  conversationId: string;
  body: string;
  clientId?: string;
  actor: RlsActor;
}) {
  const body = sanitizeUserText(input.body, 4000);
  if (!body) {
    throw new AppError(400, "Message body is required", "VALIDATION_ERROR");
  }

  const conversation = await withRlsTransaction({ actor: input.actor }, (tx) =>
    tx.conversation.findUnique({
      where: { id: input.conversationId },
      include: {
        order: {
          select: {
            status: true,
            buyerId: true,
            sellerId: true,
            listing: { select: { title: true } },
          },
        },
      },
    }),
  );

  if (!conversation) {
    throw new AppError(404, "Conversation not found", "CONVERSATION_NOT_FOUND");
  }

  const { order } = conversation;
  const isParty =
    order.buyerId === input.actor.id ||
    order.sellerId === input.actor.id ||
    input.actor.role === "ADMIN";
  if (!isParty) {
    throw new AppError(403, "Forbidden", "FORBIDDEN");
  }

  const closed = ["COMPLETED", "REFUNDED", "CANCELLED", "EXPIRED"].includes(
    order.status,
  );
  if (closed && input.actor.role !== "ADMIN") {
    throw new AppError(409, "Conversation is closed", "CONVERSATION_CLOSED");
  }

  if (input.clientId) {
    const existing = await withRlsTransaction({ actor: input.actor }, (tx) =>
      tx.message.findFirst({
        where: {
          conversationId: input.conversationId,
          clientId: input.clientId,
        },
        select: messageSelect,
      }),
    );
    if (existing) {
      return { message: serializeMessage(existing), created: false as const };
    }
  }

  const now = new Date();
  const preview =
    body.length > 140 ? `${body.slice(0, 137).trimEnd()}…` : body;

  const created = await withServiceTransaction(async (tx) => {
    const message = await tx.message.create({
      data: {
        conversationId: input.conversationId,
        senderId: input.actor.id,
        body,
        clientId: input.clientId ?? null,
      },
      select: messageSelect,
    });

    await tx.conversation.update({
      where: { id: input.conversationId },
      data: {
        lastMessageAt: now,
        lastMessagePreview: preview,
      },
    });

    return message;
  }, input.actor);

  const message = serializeMessage(created);

  emitMessageNew({
    conversationId: input.conversationId,
    message,
  });

  const recipientId =
    order.buyerId === input.actor.id ? order.sellerId : order.buyerId;

  if (recipientId !== input.actor.id) {
    const senderName = created.sender?.name?.trim() || "Alguém";
    void createNotification({
      userId: recipientId,
      type: "MESSAGE",
      title: "Nova mensagem",
      body: `${senderName}: ${preview}`,
      href: routes.conversation(input.conversationId),
      meta: {
        conversationId: input.conversationId,
        messageId: message.id,
      },
    })
      .then((notification) => {
        emitNotificationNew(recipientId, notification);
      })
      .catch(() => undefined);
  }

  return { message, created: true as const };
}
