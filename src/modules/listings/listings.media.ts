import type { Prisma } from "@prisma/client";
import { AppError } from "../../lib/errors";

type Tx = Prisma.TransactionClient;

/**
 * Resolve listing media to owned LISTING assets only.
 * Prefer mediaAssetIds; mediaUrls are accepted only when they match those assets.
 */
export async function resolveOwnedListingMedia(
  tx: Tx,
  ownerId: string,
  input: { mediaAssetIds?: string[]; mediaUrls?: string[] },
): Promise<Array<{ url: string; sortOrder: number }>> {
  const ids = [...new Set(input.mediaAssetIds ?? [])];
  const urls = [...new Set(input.mediaUrls ?? [])];

  if (!ids.length && !urls.length) return [];

  const assets = await tx.mediaAsset.findMany({
    where: {
      deletedAt: null,
      ownerId,
      purpose: "LISTING",
      visibility: "PUBLIC",
      OR: [
        ...(ids.length ? [{ id: { in: ids } }] : []),
        ...(urls.length ? [{ url: { in: urls } }] : []),
      ],
    },
    select: { id: true, url: true },
  });

  const byId = new Map(assets.map((a) => [a.id, a]));
  const byUrl = new Map(assets.map((a) => [a.url, a]));

  const ordered: Array<{ url: string; sortOrder: number }> = [];
  const seen = new Set<string>();

  if (ids.length) {
    for (const id of ids) {
      const asset = byId.get(id);
      if (!asset) {
        throw new AppError(
          400,
          "Invalid media asset for listing",
          "MEDIA_ASSET_INVALID",
        );
      }
      if (seen.has(asset.id)) continue;
      seen.add(asset.id);
      ordered.push({ url: asset.url, sortOrder: ordered.length });
    }
    return ordered;
  }

  for (const url of urls) {
    const asset = byUrl.get(url);
    if (!asset) {
      throw new AppError(
        400,
        "Media URL must belong to your LISTING uploads",
        "MEDIA_URL_INVALID",
      );
    }
    if (seen.has(asset.id)) continue;
    seen.add(asset.id);
    ordered.push({ url: asset.url, sortOrder: ordered.length });
  }

  return ordered;
}

/** Category must be ACTIVE and a leaf (no ACTIVE children). */
export async function assertLeafCategory(tx: Tx, categoryId: string) {
  const category = await tx.category.findFirst({
    where: { id: categoryId, status: "ACTIVE" },
    select: { id: true },
  });
  if (!category) {
    throw new AppError(404, "Category not found", "CATEGORY_NOT_FOUND");
  }

  const child = await tx.category.findFirst({
    where: { parentId: categoryId, status: "ACTIVE" },
    select: { id: true },
  });
  if (child) {
    throw new AppError(
      400,
      "Select a leaf category (subcategory)",
      "CATEGORY_NOT_LEAF",
    );
  }

  return category;
}
