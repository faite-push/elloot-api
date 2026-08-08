import { env } from "../../config/env";
import { listingReserveKey, redis } from "../../databases";

/** Returns false when Redis already holds a reserve for another order. */
export async function tryReserveListing(listingId: string, orderId: string) {
  if (!redis) return true;
  try {
    const result = await redis.set(
      listingReserveKey(listingId),
      orderId,
      "EX",
      env.CHECKOUT_RESERVE_SECONDS,
      "NX",
    );
    return result === "OK";
  } catch {
    return true;
  }
}

export async function getListingReservation(listingId: string) {
  if (!redis) return null;
  try {
    return await redis.get(listingReserveKey(listingId));
  } catch {
    return null;
  }
}

export async function clearListingReservation(listingId: string) {
  if (!redis) return;
  try {
    await redis.del(listingReserveKey(listingId));
  } catch {
    // ignore
  }
}
