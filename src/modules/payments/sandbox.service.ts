import { randomBytes } from "node:crypto";
import { env } from "../../config/env";
import { AppError } from "../../lib/errors";
import {
  lockOrderForUpdate,
  withServiceTransaction,
  type RlsActor,
} from "../../databases";
import { markOrderPaid } from "./payment.lifecycle";

const PROVIDER = "sandbox";

export function newSandboxProviderRef(orderId: string) {
  return `sandbox_${orderId}_${randomBytes(16).toString("hex")}`;
}

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

    const providerRef = newSandboxProviderRef(order.id);
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
      "Sandbox: call POST /api/payments/sandbox/confirm (authenticated) with this providerRef to simulate a paid PIX.",
  };
}

export async function confirmSandboxPayment(
  providerRef: string,
  actor?: RlsActor | null,
  options?: { viaWebhook?: boolean },
) {
  if (!actor && !options?.viaWebhook) {
    throw new AppError(401, "Authentication required", "UNAUTHORIZED");
  }

  return markOrderPaid(providerRef, actor ?? null, {
    provider: PROVIDER,
    providerRef,
    auditAction: options?.viaWebhook
      ? "payment.sandbox.webhook.paid"
      : "payment.sandbox.paid",
  });
}
