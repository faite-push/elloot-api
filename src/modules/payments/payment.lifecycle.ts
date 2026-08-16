import { env } from "../../config/env";
import { AppError } from "../../lib/errors";
import {
  lockOrderForUpdate,
  withServiceTransaction,
  type RlsActor,
} from "../../databases";
import { routes } from "../conversations/hrefs";
import { notifyUser } from "../conversations/notifications.notify";

export type MarkOrderPaidInput = {
  providerRef: string;
  provider: string;
  auditAction: string;
  webhookMeta?: Record<string, unknown>;
};

/**
 * Marks a pending order as paid, creates escrow hold and buyer/seller chat.
 * Idempotent when payment is already PAID.
 */
export async function markOrderPaid(
  providerRef: string,
  actor: RlsActor | null,
  options: MarkOrderPaidInput,
) {
  const result = await withServiceTransaction(async (tx) => {
    const paymentRows = await tx.$queryRaw<
      {
        id: string;
        orderId: string;
        status: string;
        amountCents: number;
        provider: string;
      }[]
    >`
      SELECT id, "orderId", status::text AS status, "amountCents", provider
      FROM payments
      WHERE provider = ${options.provider} AND "providerRef" = ${providerRef}
      FOR UPDATE
    `;
    const payment = paymentRows[0];
    if (!payment) {
      throw new AppError(404, "Payment not found", "PAYMENT_NOT_FOUND");
    }
    if (payment.status === "PAID") {
      return { alreadyPaid: true as const, orderId: payment.orderId };
    }

    const order = await lockOrderForUpdate(tx, payment.orderId);
    if (!order) throw new AppError(404, "Order not found", "ORDER_NOT_FOUND");
    if (order.status !== "PENDING_PAYMENT") {
      throw new AppError(409, "Order is not pending", "INVALID_STATUS");
    }

    if (actor && actor.role !== "ADMIN" && order.buyerId !== actor.id) {
      throw new AppError(403, "Forbidden", "FORBIDDEN");
    }

    const releaseAt = new Date(
      Date.now() + env.ESCROW_AUTO_RELEASE_HOURS * 60 * 60 * 1000,
    );

    const listing = await tx.listing.findUnique({
      where: { id: order.listingId },
      select: { title: true },
    });

    await tx.payment.update({
      where: { id: payment.id },
      data: {
        status: "PAID",
        rawWebhook: {
          provider: options.provider,
          event: options.auditAction,
          providerRef,
          at: new Date().toISOString(),
          ...options.webhookMeta,
        },
      },
    });

    await tx.order.update({
      where: { id: payment.orderId },
      data: { status: "PAID", paidAt: new Date() },
    });

    await tx.escrowHold.create({
      data: {
        orderId: payment.orderId,
        amountCents: payment.amountCents,
        releaseAt,
      },
    });

    await tx.conversation.create({
      data: { orderId: payment.orderId },
    });

    await tx.auditLog.create({
      data: {
        action: options.auditAction,
        entityType: "Order",
        entityId: payment.orderId,
        meta: { providerRef, provider: options.provider },
      },
    });

    return {
      alreadyPaid: false as const,
      orderId: payment.orderId,
      releaseAt,
      buyerId: order.buyerId,
      sellerId: order.sellerId,
      listingTitle: listing?.title ?? "seu anúncio",
    };
  }, actor ?? null);

  if (!result.alreadyPaid) {
    const href = routes.order(result.orderId);
    const title = result.listingTitle;
    void notifyUser({
      userId: result.buyerId,
      type: "ORDER",
      title: "Pagamento confirmado",
      body: `Seu pagamento de “${title}” foi confirmado.`,
      href,
      meta: { orderId: result.orderId },
    });
    void notifyUser({
      userId: result.sellerId,
      type: "ORDER",
      title: "Nova venda paga",
      body: `Você vendeu “${title}”. Entregue o produto ao comprador.`,
      href: routes.dashboardSales,
      meta: { orderId: result.orderId },
    });
  }

  return result;
}
