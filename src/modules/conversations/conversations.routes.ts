import { Router } from "express";
import { z } from "zod";
import {
  withRlsTransaction,
  type RlsActor,
} from "../../databases";
import { asyncHandler } from "../../lib/async-handler";
import { AppError } from "../../lib/errors";
import { routeParam } from "../../lib/route-param";
import { sanitizeUserText } from "../../lib/sanitize";
import { requireAuth } from "../../middleware/auth";

export const conversationsRouter = Router();

const sendSchema = z.object({
  body: z.string().trim().min(1).max(4000),
});

function actorOf(req: { user?: RlsActor }): RlsActor {
  return { id: req.user!.id, role: req.user!.role };
}

const conversationSelect = {
  id: true,
  orderId: true,
  createdAt: true,
  updatedAt: true,
  order: {
    select: {
      id: true,
      status: true,
      amountCents: true,
      buyerId: true,
      sellerId: true,
      listing: { select: { id: true, title: true } },
      buyer: { select: { id: true, name: true } },
      seller: { select: { id: true, name: true } },
    },
  },
} as const;

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
        orderBy: { updatedAt: "desc" },
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
    res.json({ conversation });
  }),
);

conversationsRouter.get(
  "/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const actor = actorOf(req);
    const id = routeParam(req.params.id);
    const conversation = await withRlsTransaction({ actor }, (tx) =>
      tx.conversation.findUnique({
        where: { id },
        select: conversationSelect,
      }),
    );
    if (!conversation) {
      throw new AppError(404, "Conversation not found", "CONVERSATION_NOT_FOUND");
    }
    res.json({ conversation });
  }),
);

conversationsRouter.get(
  "/:id/messages",
  requireAuth,
  asyncHandler(async (req, res) => {
    const actor = actorOf(req);
    const id = routeParam(req.params.id);
    const cursor = typeof req.query.cursor === "string" ? req.query.cursor : undefined;
    const take = Math.min(Number(req.query.limit) || 50, 100);

    const messages = await withRlsTransaction({ actor }, async (tx) => {
      const conversation = await tx.conversation.findUnique({ where: { id } });
      if (!conversation) {
        throw new AppError(404, "Conversation not found", "CONVERSATION_NOT_FOUND");
      }

      return tx.message.findMany({
        where: { conversationId: id },
        orderBy: { createdAt: "asc" },
        take,
        ...(cursor
          ? { skip: 1, cursor: { id: cursor } }
          : {}),
        select: {
          id: true,
          body: true,
          senderId: true,
          createdAt: true,
          sender: { select: { id: true, name: true } },
        },
      });
    });

    res.json({ messages });
  }),
);

conversationsRouter.post(
  "/:id/messages",
  requireAuth,
  asyncHandler(async (req, res) => {
    const actor = actorOf(req);
    const id = routeParam(req.params.id);
    const parsed = sendSchema.parse(req.body);
    const body = sanitizeUserText(parsed.body, 4000);
    if (!body) {
      throw new AppError(400, "Message body is required", "VALIDATION_ERROR");
    }

    const message = await withRlsTransaction({ actor }, async (tx) => {
      const conversation = await tx.conversation.findUnique({
        where: { id },
        include: { order: { select: { status: true, buyerId: true, sellerId: true } } },
      });
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

      const closed = ["COMPLETED", "REFUNDED", "CANCELLED", "EXPIRED"].includes(
        order.status,
      );
      if (closed && actor.role !== "ADMIN") {
        throw new AppError(409, "Conversation is closed", "CONVERSATION_CLOSED");
      }

      // Participants may INSERT messages (RLS); conversation UPDATE is service-only.
      return tx.message.create({
        data: {
          conversationId: id,
          senderId: actor.id,
          body,
        },
        select: {
          id: true,
          body: true,
          senderId: true,
          createdAt: true,
          sender: { select: { id: true, name: true } },
        },
      });
    });

    res.status(201).json({ message });
  }),
);
