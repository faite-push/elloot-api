import { AppError } from "../../lib/errors";
import { sanitizeUserText } from "../../lib/sanitize";
import {
  lockOrderForUpdate,
  withServiceTransaction,
  type RlsActor,
} from "../../databases";
import {
  completeOrderTx,
  refundOrderTx,
  settlePartialOrderTx,
} from "../orders/orders.lifecycle";
import { routes } from "../conversations/hrefs";
import { notifyUser } from "../conversations/notifications.notify";

export async function openDispute(input: {
  orderId: string;
  reason: string;
  actor: RlsActor;
}) {
  const reason = sanitizeUserText(input.reason, 2000);
  if (reason.length < 10) {
    throw new AppError(400, "Reason is too short", "VALIDATION_ERROR");
  }

  const result = await withServiceTransaction(async (tx) => {
    const order = await lockOrderForUpdate(tx, input.orderId);
    if (!order) throw new AppError(404, "Order not found", "ORDER_NOT_FOUND");

    const isParty =
      order.buyerId === input.actor.id ||
      order.sellerId === input.actor.id ||
      input.actor.role === "ADMIN";
    if (!isParty) {
      throw new AppError(403, "Forbidden", "FORBIDDEN");
    }
    if (order.status !== "PAID" && order.status !== "DELIVERED") {
      throw new AppError(409, "Order cannot be disputed", "INVALID_STATUS");
    }

    const existing = await tx.dispute.findUnique({
      where: { orderId: order.id },
    });
    if (existing) {
      throw new AppError(409, "Dispute already exists", "DISPUTE_EXISTS");
    }

    await tx.order.update({
      where: { id: order.id },
      data: { status: "DISPUTED" },
    });

    const dispute = await tx.dispute.create({
      data: {
        orderId: order.id,
        openedById: input.actor.id,
        reason,
        status: "OPEN",
      },
    });

    await tx.auditLog.create({
      data: {
        actorId: input.actor.id,
        action: "dispute.opened",
        entityType: "Dispute",
        entityId: dispute.id,
        meta: { orderId: order.id },
      },
    });

    return {
      dispute,
      recipientId:
        order.buyerId === input.actor.id ? order.sellerId : order.buyerId,
      orderId: order.id,
    };
  }, input.actor);

  if (result.recipientId !== input.actor.id) {
    void notifyUser({
      userId: result.recipientId,
      type: "DISPUTE",
      title: "Disputa aberta",
      body: "Um pedido em que você participa entrou em disputa.",
      href: routes.order(result.orderId),
      meta: { disputeId: result.dispute.id, orderId: result.orderId },
    });
  }

  return result.dispute;
}

export async function resolveDispute(input: {
  disputeId: string;
  resolution: "RELEASE_TO_SELLER" | "REFUND_BUYER" | "PARTIAL";
  notes?: string;
  sellerAmountCents?: number;
  actor: RlsActor;
}) {
  if (input.actor.role !== "ADMIN") {
    throw new AppError(403, "Forbidden", "FORBIDDEN");
  }

  const notes = input.notes
    ? sanitizeUserText(input.notes, 2000)
    : undefined;

  const result = await withServiceTransaction(async (tx) => {
    const dispute = await tx.dispute.findUnique({
      where: { id: input.disputeId },
    });
    if (!dispute) {
      throw new AppError(404, "Dispute not found", "DISPUTE_NOT_FOUND");
    }
    if (dispute.status !== "OPEN") {
      throw new AppError(409, "Dispute is not open", "INVALID_STATUS");
    }

    const order = await lockOrderForUpdate(tx, dispute.orderId);
    if (!order) throw new AppError(404, "Order not found", "ORDER_NOT_FOUND");
    if (order.status !== "DISPUTED") {
      throw new AppError(409, "Order is not disputed", "INVALID_STATUS");
    }

    if (input.resolution === "RELEASE_TO_SELLER") {
      await completeOrderTx(tx, order.id, { allowDisputed: true });
    } else if (input.resolution === "REFUND_BUYER") {
      await refundOrderTx(tx, order.id);
    } else {
      if (
        input.sellerAmountCents == null ||
        input.sellerAmountCents <= 0 ||
        input.sellerAmountCents >= order.amountCents
      ) {
        throw new AppError(
          400,
          "sellerAmountCents must be between 1 and amountCents-1",
          "VALIDATION_ERROR",
        );
      }
      await settlePartialOrderTx(tx, order.id, input.sellerAmountCents);
    }

    const updated = await tx.dispute.update({
      where: { id: dispute.id },
      data: {
        status: "RESOLVED",
        resolution: input.resolution,
        notes,
      },
    });

    await tx.auditLog.create({
      data: {
        actorId: input.actor.id,
        action: "dispute.resolved",
        entityType: "Dispute",
        entityId: dispute.id,
        meta: {
          resolution: input.resolution,
          sellerAmountCents: input.sellerAmountCents ?? null,
        },
      },
    });

    return {
      dispute: updated,
      buyerId: order.buyerId,
      sellerId: order.sellerId,
      orderId: order.id,
      resolution: input.resolution,
    };
  }, input.actor);

  const resolutionLabel =
    result.resolution === "RELEASE_TO_SELLER"
      ? "Valor liberado ao vendedor."
      : result.resolution === "REFUND_BUYER"
        ? "Reembolso ao comprador."
        : "Acordo parcial aplicado.";

  for (const userId of [result.buyerId, result.sellerId]) {
    void notifyUser({
      userId,
      type: "DISPUTE",
      title: "Disputa resolvida",
      body: resolutionLabel,
      href: routes.order(result.orderId),
      meta: {
        disputeId: result.dispute.id,
        orderId: result.orderId,
        resolution: result.resolution,
      },
    });
  }

  return result.dispute;
}
