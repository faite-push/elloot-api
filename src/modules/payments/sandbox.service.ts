import { env } from "../../config/env";
import { AppError } from "../../lib/errors";
import {
  lockOrderForUpdate,
  withServiceTransaction,
  type RlsActor,
} from "../../databases";

const PROVIDER = "sandbox";

export async function createSandboxPayment(
  orderId: string,
  actor: RlsActor,
) {
  return withServiceTransaction(async (tx) => {
    const order = await lockOrderForUpdate(tx, orderId);
    if (!order) throw new AppError(404, "Order not found", "ORDER_NOT_FOUND");
    if (order.buyerId !== actor.id && actor.role !== "ADMIN") {
      throw new AppError(403, "Forbidden", "FORBIDDEN");
    }
    if (order.status !== "PENDING_PAYMENT") {
      throw new AppError(409, "Order is not pending payment", "INVALID_STATUS");
    }

    const existing = await tx.payment.findUnique({ where: { orderId } });
    if (existing) {
      const full = await tx.order.findUniqueOrThrow({ where: { id: orderId } });
      return formatSandboxCheckout(
        existing.providerRef,
        full.amountCents,
        full.expiresAt,
      );
    }

    const providerRef = `sandbox_${order.id}`;
    const payment = await tx.payment.create({
      data: {
        orderId: order.id,
        provider: PROVIDER,
        providerRef,
        status: "PENDING",
        amountCents: order.amountCents,
      },
    });

    const full = await tx.order.findUniqueOrThrow({ where: { id: orderId } });
    return formatSandboxCheckout(
      payment.providerRef,
      full.amountCents,
      full.expiresAt,
    );
  }, actor);
}

function formatSandboxCheckout(
  providerRef: string,
  amountCents: number,
  expiresAt: Date | null,
) {
  return {
    provider: PROVIDER,
    providerRef,
    amountCents,
    expiresAt,
    pixCopyPaste: `ELLOOT-SANDBOX-${providerRef}-${amountCents}`,
    instructions:
      "Sandbox: call POST /api/payments/sandbox/confirm with this providerRef to simulate a paid PIX.",
  };
}

export async function confirmSandboxPayment(
  providerRef: string,
  actor?: RlsActor | null,
) {
  return withServiceTransaction(async (tx) => {
    const paymentRows = await tx.$queryRaw<
      {
        id: string;
        orderId: string;
        status: string;
        amountCents: number;
      }[]
    >`
      SELECT id, "orderId", status::text AS status, "amountCents"
      FROM payments
      WHERE provider = ${PROVIDER} AND "providerRef" = ${providerRef}
      FOR UPDATE
    `;
    const payment = paymentRows[0];
    if (!payment) {
      throw new AppError(404, "Payment not found", "PAYMENT_NOT_FOUND");
    }
    if (payment.status === "PAID") {
      return { alreadyPaid: true, orderId: payment.orderId };
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

    await tx.payment.update({
      where: { id: payment.id },
      data: {
        status: "PAID",
        rawWebhook: {
          provider: PROVIDER,
          event: "payment.paid",
          providerRef,
          at: new Date().toISOString(),
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
        action: "payment.sandbox.paid",
        entityType: "Order",
        entityId: payment.orderId,
        meta: { providerRef },
      },
    });

    return { alreadyPaid: false, orderId: payment.orderId, releaseAt };
  }, actor ?? null);
}
