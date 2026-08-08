import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../../lib/async-handler";
import { AppError } from "../../lib/errors";
import { withRlsTransaction, type RlsActor } from "../../databases";
import { routeParam } from "../../lib/route-param";
import { requireAuth } from "../../middleware/auth";
import { createSandboxPayment } from "../payments/sandbox.service";
import { cancelOrderByBuyer } from "./orders.lifecycle";
import {
  confirmOrderByBuyer,
  createOrderFromListing,
  markOrderDelivered,
} from "./orders.service";

export const ordersRouter = Router();

const createOrderSchema = z.object({
  listingId: z.string().min(1),
});

const orderSelect = {
  id: true,
  status: true,
  amountCents: true,
  feeCents: true,
  paidAt: true,
  deliveredAt: true,
  completedAt: true,
  expiresAt: true,
  createdAt: true,
  listing: {
    select: {
      id: true,
      title: true,
      priceCents: true,
      media: {
        take: 1,
        orderBy: { sortOrder: "asc" as const },
        select: { url: true },
      },
    },
  },
  buyer: { select: { id: true, name: true, email: true } },
  seller: { select: { id: true, name: true, email: true } },
  payment: {
    select: {
      id: true,
      provider: true,
      providerRef: true,
      status: true,
      amountCents: true,
    },
  },
  escrowHold: {
    select: {
      amountCents: true,
      releaseAt: true,
      releasedAt: true,
    },
  },
  conversation: { select: { id: true } },
} as const;

function actorOf(req: { user?: RlsActor }): RlsActor {
  return { id: req.user!.id, role: req.user!.role };
}

ordersRouter.post(
  "/",
  requireAuth,
  asyncHandler(async (req, res) => {
    const body = createOrderSchema.parse(req.body);
    const actor = actorOf(req);
    const order = await createOrderFromListing({
      listingId: body.listingId,
      buyerId: actor.id,
      actor,
    });
    const checkout = await createSandboxPayment(order.id, actor);
    const full = await withRlsTransaction({ actor }, (tx) =>
      tx.order.findUniqueOrThrow({ where: { id: order.id }, select: orderSelect }),
    );
    res.status(201).json({ order: full, checkout });
  }),
);

ordersRouter.get(
  "/mine",
  requireAuth,
  asyncHandler(async (req, res) => {
    const actor = actorOf(req);
    const orders = await withRlsTransaction({ actor }, (tx) =>
      tx.order.findMany({
        where: {
          OR: [{ buyerId: actor.id }, { sellerId: actor.id }],
        },
        orderBy: { createdAt: "desc" },
        take: 50,
        select: orderSelect,
      }),
    );
    res.json({ orders });
  }),
);

ordersRouter.get(
  "/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const id = routeParam(req.params.id);
    const actor = actorOf(req);
    const order = await withRlsTransaction({ actor }, (tx) =>
      tx.order.findUnique({ where: { id }, select: orderSelect }),
    );
    if (!order) throw new AppError(404, "Order not found", "ORDER_NOT_FOUND");
    res.json({ order });
  }),
);

ordersRouter.post(
  "/:id/checkout",
  requireAuth,
  asyncHandler(async (req, res) => {
    const id = routeParam(req.params.id);
    const actor = actorOf(req);
    const checkout = await createSandboxPayment(id, actor);
    res.json({ checkout });
  }),
);

ordersRouter.post(
  "/:id/cancel",
  requireAuth,
  asyncHandler(async (req, res) => {
    const actor = actorOf(req);
    const order = await cancelOrderByBuyer(
      routeParam(req.params.id),
      actor.id,
      actor,
    );
    const full = await withRlsTransaction({ actor }, (tx) =>
      tx.order.findUniqueOrThrow({ where: { id: order.id }, select: orderSelect }),
    );
    res.json({ order: full });
  }),
);

ordersRouter.post(
  "/:id/deliver",
  requireAuth,
  asyncHandler(async (req, res) => {
    const actor = actorOf(req);
    const order = await markOrderDelivered(
      routeParam(req.params.id),
      actor.id,
      actor,
    );
    const full = await withRlsTransaction({ actor }, (tx) =>
      tx.order.findUniqueOrThrow({ where: { id: order.id }, select: orderSelect }),
    );
    res.json({ order: full });
  }),
);

ordersRouter.post(
  "/:id/confirm",
  requireAuth,
  asyncHandler(async (req, res) => {
    const actor = actorOf(req);
    const order = await confirmOrderByBuyer(
      routeParam(req.params.id),
      actor.id,
      actor,
    );
    const full = await withRlsTransaction({ actor }, (tx) =>
      tx.order.findUniqueOrThrow({ where: { id: order.id }, select: orderSelect }),
    );
    res.json({ order: full });
  }),
);
