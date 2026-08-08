import { env } from "../../config/env";

export function calcFeeCents(amountCents: number) {
  return Math.round((amountCents * env.PLATFORM_FEE_BPS) / 10_000);
}
