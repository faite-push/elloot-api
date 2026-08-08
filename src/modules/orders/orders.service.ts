import { env } from "../../config/env";
import { AppError } from "../../lib/errors";
import {
  lockListingForUpdate,
  lockOrderForUpdate,
  withRlsTransaction,
  withServiceTransaction,
  type RlsActor,
} from "../../databases";
import { completeOrderTx } from "./orders.lifecycle";
import { calcFeeCents } from "./orders.fees";
import {
  clearListingReservation,
  getListingReservation,
  tryReserveListing,
} from "./orders.reserve";

export { calcFeeCents };

/**
 * Create order under service RLS context so FOR UPDATE can see competing
 * checkouts on the same listing (user-scoped RLS would hide them).
 */
export async function createOrderFromListing(input: {
  listingId: string;
  buyerId: string;
  actor: RlsActor;
}) {
  if (input.actor.id !== input.buyerId) {
    throw new AppError(403, "Forbidden", "FORBIDDEN");
  }

  return withServiceTransaction(async (tx) => {
    const listing = await lockListingForUpdate(tx, input.listingId);

    if (!listing || listing.status !== "ACTIVE") {
      throw new AppError(404, "Listing unavailable", "LISTING_UNAVAILABLE");
    }
    if (listing.sellerId === input.buyerId) {
      throw new AppError(400, "You cannot buy your own listing", "SELF_PURCHASE");
    }

    const reservedBy = await getListingReservation(listing.id);
    if (reservedBy) {
      throw new AppError(
        409,
        "Listing reserved in another checkout",
        "LISTING_RESERVED",
      );
    }

    const blocking = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM orders
      WHERE "listingId" = ${listing.id}
        AND status IN ('PENDING_PAYMENT', 'PAID', 'DELIVERED', 'DISPUTED')
      LIMIT 1
      FOR UPDATE
    `;
    if (blocking[0]) {
      throw new AppError(409, "Listing currently unavailable", "LISTING_BUSY");
    }

    const feeCents = calcFeeCents(listing.priceCents);
    const expiresAt = new Date(Date.now() + env.CHECKOUT_RESERVE_SECONDS * 1000);

    const order = await tx.order.create({
      data: {
        listingId: listing.id,
        buyerId: input.buyerId,
        sellerId: listing.sellerId,
        amountCents: listing.priceCents,
        feeCents,
        status: "PENDING_PAYMENT",
        expiresAt,
      },
    });

    const reserved = await tryReserveListing(listing.id, order.id);
    if (!reserved) {
      throw new AppError(
        409,
        "Listing reserved in another checkout",
        "LISTING_RESERVED",
      );
    }

    return order;
  }, input.actor);
}

export async function markOrderDelivered(
  orderId: string,
  sellerId: string,
  actor: RlsActor,
) {
  return withRlsTransaction({ actor }, async (tx) => {
    const order = await lockOrderForUpdate(tx, orderId);
    if (!order) throw new AppError(404, "Order not found", "ORDER_NOT_FOUND");
    if (order.sellerId !== sellerId) {
      throw new AppError(403, "Forbidden", "FORBIDDEN");
    }
    if (order.status !== "PAID") {
      throw new AppError(409, "Order is not awaiting delivery", "INVALID_STATUS");
    }

    return tx.order.update({
      where: { id: orderId },
      data: { status: "DELIVERED", deliveredAt: new Date() },
    });
  });
}

export async function confirmOrderByBuyer(
  orderId: string,
  buyerId: string,
  actor: RlsActor,
) {
  if (actor.id !== buyerId) {
    throw new AppError(403, "Forbidden", "FORBIDDEN");
  }

  return withServiceTransaction(async (tx) => {
    const order = await lockOrderForUpdate(tx, orderId);
    if (!order) throw new AppError(404, "Order not found", "ORDER_NOT_FOUND");
    if (order.buyerId !== buyerId) {
      throw new AppError(403, "Forbidden", "FORBIDDEN");
    }
    if (order.status !== "PAID" && order.status !== "DELIVERED") {
      throw new AppError(409, "Order cannot be confirmed", "INVALID_STATUS");
    }

    return completeOrderTx(tx, order.id);
  }, actor);
}

export async function completeOrder(orderId: string, actor?: RlsActor | null) {
  return withServiceTransaction(async (tx) => completeOrderTx(tx, orderId), actor);
}
