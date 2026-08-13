import { env } from "../../../config/env";
import { AppError } from "../../../lib/errors";
import {
  lockOrderForUpdate,
  withServiceTransaction,
  type RlsActor,
} from "../../../databases";
import { markOrderPaid } from "../payment.lifecycle";
import { centsToEfiAmount, orderToEfiTxid, wrapEfiError } from "./efi.errors";
import { getEfiPay } from "./efi.sdk";

const PROVIDER = "efi";

export type EfiCheckout = {
  provider: typeof PROVIDER;
  providerRef: string;
  amountCents: number;
  expiresAt: string | null;
  pixCopyPaste: string;
  qrCodeImage?: string | null;
  instructions: string;
};

type EfiCob = {
  txid: string;
  status: string;
  pixCopiaECola?: string;
  loc?: { id: number };
  calendario?: { expiracao?: number };
};

function checkoutExpiry(orderExpiresAt: Date | null, cob?: EfiCob) {
  if (orderExpiresAt) return orderExpiresAt.toISOString();
  const seconds = cob?.calendario?.expiracao ?? env.CHECKOUT_RESERVE_SECONDS;
  return new Date(Date.now() + seconds * 1000).toISOString();
}

async function fetchPixCopyPaste(locId: number) {
  const efipay = getEfiPay();
  const qr = (await efipay.pixGenerateQRCode({ id: locId })) as {
    qrcode?: string;
    imagemQrcode?: string;
  };
  if (!qr.qrcode) {
    throw new AppError(
      502,
      "Efi não retornou o código PIX",
      "EFI_PIX_UNAVAILABLE",
    );
  }
  return {
    pixCopyPaste: qr.qrcode,
    qrCodeImage: qr.imagemQrcode ?? null,
  };
}

function formatCheckout(
  providerRef: string,
  amountCents: number,
  expiresAt: Date | null,
  pixCopyPaste: string,
  qrCodeImage?: string | null,
): EfiCheckout {
  return {
    provider: PROVIDER,
    providerRef,
    amountCents,
    expiresAt: checkoutExpiry(expiresAt),
    pixCopyPaste,
    qrCodeImage: qrCodeImage ?? null,
    instructions:
      "Pague via PIX. A confirmação é verificada automaticamente em alguns segundos.",
  };
}

export async function createEfiPayment(orderId: string, actor: RlsActor) {
  try {
    return await withServiceTransaction(async (tx) => {
      const order = await lockOrderForUpdate(tx, orderId);
      if (!order) throw new AppError(404, "Order not found", "ORDER_NOT_FOUND");
      if (order.buyerId !== actor.id && actor.role !== "ADMIN") {
        throw new AppError(403, "Forbidden", "FORBIDDEN");
      }
      if (order.status !== "PENDING_PAYMENT") {
        throw new AppError(
          409,
          "Order is not pending payment",
          "INVALID_STATUS",
        );
      }

      const existing = await tx.payment.findUnique({ where: { orderId } });
      if (existing) {
        const raw = existing.rawWebhook as {
          pixCopyPaste?: string;
          qrCodeImage?: string;
          locId?: number;
        } | null;

        let pixCopyPaste = raw?.pixCopyPaste;
        let qrCodeImage = raw?.qrCodeImage ?? null;

        if (!pixCopyPaste) {
          const efipay = getEfiPay();
          const cob = (await efipay.pixDetailCharge({
            txid: existing.providerRef,
          })) as unknown as EfiCob;

          if (cob.pixCopiaECola) {
            pixCopyPaste = cob.pixCopiaECola;
          } else if (cob.loc?.id) {
            const qr = await fetchPixCopyPaste(cob.loc.id);
            pixCopyPaste = qr.pixCopyPaste;
            qrCodeImage = qr.qrCodeImage;
          }
        }

        if (!pixCopyPaste) {
          throw new AppError(
            502,
            "Could not load Efi PIX copy-paste",
            "EFI_PIX_UNAVAILABLE",
          );
        }

        return formatCheckout(
          existing.providerRef,
          existing.amountCents,
          order.expiresAt,
          pixCopyPaste,
          qrCodeImage,
        );
      }

      const txid = orderToEfiTxid(order.id);
      const expiracao = Math.min(
        env.CHECKOUT_RESERVE_SECONDS,
        order.expiresAt
          ? Math.max(
              60,
              Math.floor((order.expiresAt.getTime() - Date.now()) / 1000),
            )
          : env.CHECKOUT_RESERVE_SECONDS,
      );

      const efipay = getEfiPay();
      const cob = (await efipay.pixCreateCharge(
        { txid },
        {
          calendario: { expiracao },
          valor: { original: centsToEfiAmount(order.amountCents) },
          chave: env.EFI_PIX_KEY!,
          solicitacaoPagador: `Elloot pedido ${order.id.slice(-8)}`,
        },
      )) as unknown as EfiCob;

      let pixCopyPaste = cob.pixCopiaECola;
      let qrCodeImage: string | null = null;

      if (!pixCopyPaste && cob.loc?.id) {
        const qr = await fetchPixCopyPaste(cob.loc.id);
        pixCopyPaste = qr.pixCopyPaste;
        qrCodeImage = qr.qrCodeImage;
      }

      if (!pixCopyPaste) {
        throw new AppError(
          502,
          "Efi did not return PIX copy-paste",
          "EFI_PIX_UNAVAILABLE",
        );
      }

      await tx.payment.create({
        data: {
          orderId: order.id,
          provider: PROVIDER,
          providerRef: txid,
          status: "PENDING",
          amountCents: order.amountCents,
          rawWebhook: {
            locId: cob.loc?.id,
            pixCopyPaste,
            qrCodeImage,
            status: cob.status,
          },
        },
      });

      return formatCheckout(
        txid,
        order.amountCents,
        order.expiresAt,
        pixCopyPaste,
        qrCodeImage,
      );
    }, actor);
  } catch (err) {
    throw wrapEfiError(err);
  }
}

export async function syncEfiPayment(providerRef: string, actor: RlsActor) {
  try {
    const efipay = getEfiPay();
    const cob = (await efipay.pixDetailCharge({
      txid: providerRef,
    })) as unknown as EfiCob;

    if (cob.status === "CONCLUIDA") {
      return markOrderPaid(providerRef, actor, {
        provider: PROVIDER,
        providerRef,
        auditAction: "payment.efi.sync.paid",
        webhookMeta: { efiStatus: cob.status },
      });
    }

    return {
      ok: true,
      paid: false,
      status: cob.status,
    };
  } catch (err) {
    throw wrapEfiError(err);
  }
}
