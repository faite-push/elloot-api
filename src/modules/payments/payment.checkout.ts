import { env } from "../../config/env";
import type { RlsActor } from "../../databases";
import { createEfiPayment } from "./efi/efi.service";
import { createSandboxPayment } from "./sandbox.service";

export async function createOrderCheckout(orderId: string, actor: RlsActor) {
  if (env.PAYMENT_PROVIDER === "efi") {
    return createEfiPayment(orderId, actor);
  }
  return createSandboxPayment(orderId, actor);
}
