import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../../lib/async-handler";
import { AppError } from "../../lib/errors";
import { routeParam } from "../../lib/route-param";
import { requireAuth } from "../../middleware/auth";
import { withRlsTransaction, type RlsActor } from "../../databases";
import { isUserOnline } from "../../realtime/presence";
import { sendConversationMessage } from "./conversations.service";

export const conversationsRouter = Router();

const sendSchema = z.object({
  body: z.string().trim().min(1).max(4000),
  clientId: z.string().trim().min(8).max(64).optional(),
});

function actorOf(req: { user?: RlsActor }): RlsActor {
  return { id: req.user!.id, role: req.user!.role };
}

const conversationSelect = {
  id: true,
  orderId: true,
  lastMessageAt: true,
  lastMessagePreview: true,
  createdAt: true,
  updatedAt: true,
  order: {
    select: {
      id: true,
      status: true,
      amountCents: true,
      buyerId: true,
      sellerId: true,
      listing: {
        select: {
          id: true,
          title: true,
          media: {
            take: 1,
            orderBy: { sortOrder: "asc" as const },
            select: { url: true },
          },
        },
      },
      buyer: { select: { id: true, name: true, avatarUrl: true } },
      seller: { select: { id: true, name: true, avatarUrl: true } },
    },
  },
} as const;

const messageSelect = {
  id: true,
  conversationId: true,
  body: true,
  senderId: true,
  clientId: true,
  readAt: true,
  createdAt: true,
  sender: { select: { id: true, name: true, avatarUrl: true } },
} as const;

async function assertConversationParty(
  actor: RlsActor,
  conversationId: string,
) {
  const conversation = await withRlsTransaction({ actor }, (tx) =>
    tx.conversation.findUnique({
      where: { id: conversationId },
      include: {
        order: { select: { status: true, buyerId: true, sellerId: true } },
      },
    }),
  );
  if (!conversation) {
    throw new AppError(404, "Conversation not found", "CONVERSATION_NOT_FOUND");
  }
  const { order } = conversation;
  const isParty =
    order.buyerId === actor.id ||
    order.sellerId === actor.id ||
    actor.role === "ADMIN";
  if (!isParty) {
    throw new AppError(403, "Forbidden", "FORBIDDEN");
  }
  return conversation;
}

conversationsRouter.get(
  "/",
  requireAuth,
  asyncHandler(async (req, res) => {
    const actor = actorOf(req);
    const conversations = await withRlsTransaction({ actor }, (tx) =>
      tx.conversation.findMany({
        where: {
          order: {
            OR: [{ buyerId: actor.id }, { sellerId: actor.id }],
          },
        },
        orderBy: [{ lastMessageAt: "desc" }, { updatedAt: "desc" }],
        take: 50,
        select: {
          ...conversationSelect,
          messages: {
            orderBy: { createdAt: "desc" },
            take: 1,
            select: {
              id: true,
              body: true,
              senderId: true,
              createdAt: true,
              sender: { select: { id: true, name: true } },
            },
          },
        },
      }),
    );
    res.json({ conversations });
  }),
);

conversationsRouter.get(
  "/by-order/:orderId",
  requireAuth,
  asyncHandler(async (req, res) => {
    const actor = actorOf(req);
    const orderId = routeParam(req.params.orderId, "orderId");
    const conversation = await withRlsTransaction({ actor }, (tx) =>
      tx.conversation.findUnique({
        where: { orderId },
        select: conversationSelect,
      }),
    );
    if (!conversation) {
      throw new AppError(404, "Conversation not found", "CONVERSATION_NOT_FOUND");
    }
    const isParty =
      conversation.order.buyerId === actor.id ||
      conversation.order.sellerId === actor.id ||
      actor.role === "ADMIN";
    if (!isParty) {
      throw new AppError(403, "Forbidden", "FORBIDDEN");
    }
    res.json({ conversation });
  }),
);

conversationsRouter.get(
  "/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const actor = actorOf(req);
    const id = routeParam(req.params.id);
    await assertConversationParty(actor, id);
    const conversation = await withRlsTransaction({ actor }, (tx) =>
      tx.conversation.findUnique({
        where: { id },
        select: conversationSelect,
      }),
    );
    res.json({
      conversation: {
        ...conversation,
        partiesOnline: conversation
          ? {
              buyer: isUserOnline(conversation.order.buyerId),
              seller: isUserOnline(conversation.order.sellerId),
            }
          : undefined,
      },
    });
  }),
);

conversationsRouter.get(
  "/:id/messages",
  requireAuth,
  asyncHandler(async (req, res) => {
    const actor = actorOf(req);
    const id = routeParam(req.params.id);
    await assertConversationParty(actor, id);

    const after =
      typeof req.query.after === "string" && req.query.after.length > 0
        ? req.query.after
        : undefined;
    const take = Math.min(Number(req.query.limit) || 80, 120);

    const messages = await withRlsTransaction({ actor }, (tx) =>
      tx.message.findMany({
        where: {
          conversationId: id,
          ...(after ? { createdAt: { gt: new Date(after) } } : {}),
        },
        orderBy: { createdAt: "asc" },
        take,
        select: messageSelect,
      }),
    );

    res.json({
      messages,
      nextCursor:
        messages.length === take
          ? (messages[messages.length - 1]?.id ?? null)
          : null,
    });
  }),
);

conversationsRouter.post(
  "/:id/messages",
  requireAuth,
  asyncHandler(async (req, res) => {
    const actor = actorOf(req);
    const id = routeParam(req.params.id);
    const parsed = sendSchema.parse(req.body);

    const { message, created } = await sendConversationMessage({
      conversationId: id,
      body: parsed.body,
      clientId: parsed.clientId,
      actor,
    });

    res.status(created ? 201 : 200).json({ message });
  }),
);
