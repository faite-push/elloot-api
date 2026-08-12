import { withServiceTransaction } from "../databases";

const MAX_PRESENCE_IDS = 20;

/**
 * Who may be observed via presence:subscribe:
 * - self
 * - order counterparties (buyer/seller)
 * - sellers of ACTIVE listings (public marketplace ON badge)
 */
export async function filterAllowedPresenceIds(
  viewerId: string,
  requested: string[],
): Promise<string[]> {
  const unique = [
    ...new Set(
      requested.filter((id) => typeof id === "string" && id.length > 0),
    ),
  ].slice(0, MAX_PRESENCE_IDS);

  if (unique.length === 0) return [];

  const allowed = new Set<string>();
  if (unique.includes(viewerId)) {
    allowed.add(viewerId);
  }

  const remaining = unique.filter((id) => id !== viewerId);
  if (remaining.length === 0) {
    return unique.filter((id) => allowed.has(id));
  }

  await withServiceTransaction(async (tx) => {
    const orderPeers = await tx.order.findMany({
      where: {
        OR: [
          { buyerId: viewerId, sellerId: { in: remaining } },
          { sellerId: viewerId, buyerId: { in: remaining } },
        ],
      },
      select: { buyerId: true, sellerId: true },
      take: 100,
    });
    for (const o of orderPeers) {
      if (o.buyerId !== viewerId) allowed.add(o.buyerId);
      if (o.sellerId !== viewerId) allowed.add(o.sellerId);
    }

    const activeSellers = await tx.listing.findMany({
      where: {
        sellerId: { in: remaining },
        status: "ACTIVE",
      },
      select: { sellerId: true },
      distinct: ["sellerId"],
    });
    for (const row of activeSellers) {
      allowed.add(row.sellerId);
    }
  });

  return unique.filter((id) => allowed.has(id));
}
