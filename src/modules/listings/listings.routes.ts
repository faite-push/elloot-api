import { Router } from "express";
import {
  withRlsTransaction,
  type RlsActor,
} from "../../databases";
import { asyncHandler } from "../../lib/async-handler";
import { AppError } from "../../lib/errors";
import { routeParam } from "../../lib/route-param";
import { sanitizeUserText } from "../../lib/sanitize";
import { optionalAuth } from "../../middleware/optional-auth";
import { requireAuth, signAccessToken } from "../../middleware/auth";
import { createListingSchema, updateListingSchema } from "./listings.schemas";
import { listingPublicSelect } from "./listings.shared";

export const listingsRouter = Router();

function actorOf(req: { user?: RlsActor }): RlsActor {
  return { id: req.user!.id, role: req.user!.role };
}

listingsRouter.get(
  "/mine",
  requireAuth,
  asyncHandler(async (req, res) => {
    const actor = actorOf(req);
    const listings = await withRlsTransaction({ actor }, (tx) =>
      tx.listing.findMany({
        where: { sellerId: actor.id, status: { not: "REMOVED" } },
        orderBy: { updatedAt: "desc" },
        select: listingPublicSelect,
      }),
    );
    res.json({ listings });
  }),
);

listingsRouter.post(
  "/",
  requireAuth,
  asyncHandler(async (req, res) => {
    const body = createListingSchema.parse(req.body);
    const title = sanitizeUserText(body.title, 120);
    const description = sanitizeUserText(body.description, 5000);
    const actor = actorOf(req);

    let promotedToSeller = false;
    const listing = await withRlsTransaction({ actor }, async (tx) => {
      const category = await tx.category.findFirst({
        where: { id: body.categoryId, status: "ACTIVE" },
      });
      if (!category) {
        throw new AppError(404, "Category not found", "CATEGORY_NOT_FOUND");
      }

      if (actor.role === "BUYER") {
        await tx.user.update({
          where: { id: actor.id },
          data: { role: "SELLER" },
        });
        actor.role = "SELLER";
        req.user!.role = "SELLER";
        promotedToSeller = true;
      }

      const listingModel = body.listingModel ?? "NORMAL";
      const offers = body.offers ?? [];
      const priceCents =
        listingModel === "DYNAMIC"
          ? Math.min(...offers.map((o) => o.priceCents))
          : body.priceCents!;

      return tx.listing.create({
        data: {
          sellerId: actor.id,
          categoryId: body.categoryId,
          title,
          description,
          priceCents,
          stockQuantity: body.stockQuantity ?? 1,
          productType: body.productType ?? null,
          listingModel,
          status: body.publish ? "ACTIVE" : "DRAFT",
          media: body.mediaUrls.length
            ? {
                create: body.mediaUrls.map((url, index) => ({
                  url,
                  sortOrder: index,
                })),
              }
            : undefined,
          offers:
            listingModel === "DYNAMIC"
              ? {
                  create: offers.map((offer, index) => ({
                    title: sanitizeUserText(offer.title, 120),
                    priceCents: offer.priceCents,
                    stockQuantity: offer.stockQuantity ?? 1,
                    sortOrder: index,
                  })),
                }
              : undefined,
        },
        select: listingPublicSelect,
      });
    });

    const accessToken = promotedToSeller
      ? signAccessToken({
          id: req.user!.id,
          email: req.user!.email,
          role: "SELLER",
        })
      : undefined;

    res.status(201).json({ listing, ...(accessToken ? { accessToken } : {}) });
  }),
);

listingsRouter.get(
  "/:id",
  optionalAuth,
  asyncHandler(async (req, res) => {
    const id = routeParam(req.params.id);
    const actor = req.user
      ? { id: req.user.id, role: req.user.role }
      : null;

    const listing = await withRlsTransaction({ actor }, (tx) =>
      tx.listing.findUnique({ where: { id }, select: listingPublicSelect }),
    );

    if (!listing || listing.status === "REMOVED") {
      throw new AppError(404, "Listing not found", "LISTING_NOT_FOUND");
    }

    const isOwner =
      req.user?.id === listing.seller.id || req.user?.role === "ADMIN";
    if (listing.status !== "ACTIVE" && !isOwner) {
      throw new AppError(404, "Listing not found", "LISTING_NOT_FOUND");
    }

    res.json({ listing });
  }),
);

listingsRouter.patch(
  "/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const body = updateListingSchema.parse(req.body);
    const actor = actorOf(req);
    const id = routeParam(req.params.id);

    const updated = await withRlsTransaction({ actor }, async (tx) => {
      const listing = await getOwnedListingTx(tx, id, actor);
      if (listing.status === "SOLD") {
        throw new AppError(409, "Listing already sold", "LISTING_SOLD");
      }

      if (body.categoryId) {
        const category = await tx.category.findFirst({
          where: { id: body.categoryId, status: "ACTIVE" },
        });
        if (!category) {
          throw new AppError(404, "Category not found", "CATEGORY_NOT_FOUND");
        }
      }

      if (body.mediaUrls) {
        await tx.listingMedia.deleteMany({ where: { listingId: listing.id } });
        if (body.mediaUrls.length) {
          await tx.listingMedia.createMany({
            data: body.mediaUrls.map((url, index) => ({
              listingId: listing.id,
              url,
              sortOrder: index,
            })),
          });
        }
      }

      return tx.listing.update({
        where: { id: listing.id },
        data: {
          categoryId: body.categoryId,
          title: body.title ? sanitizeUserText(body.title, 120) : undefined,
          description: body.description
            ? sanitizeUserText(body.description, 5000)
            : undefined,
          priceCents: body.priceCents,
        },
        select: listingPublicSelect,
      });
    });

    res.json({ listing: updated });
  }),
);

listingsRouter.post(
  "/:id/publish",
  requireAuth,
  asyncHandler(async (req, res) => {
    const actor = actorOf(req);
    const updated = await withRlsTransaction({ actor }, async (tx) => {
      const listing = await getOwnedListingTx(tx, routeParam(req.params.id), actor);
      if (listing.status === "SOLD") {
        throw new AppError(409, "Listing already sold", "LISTING_SOLD");
      }
      return tx.listing.update({
        where: { id: listing.id },
        data: { status: "ACTIVE" },
        select: listingPublicSelect,
      });
    });
    res.json({ listing: updated });
  }),
);

listingsRouter.post(
  "/:id/pause",
  requireAuth,
  asyncHandler(async (req, res) => {
    const actor = actorOf(req);
    const updated = await withRlsTransaction({ actor }, async (tx) => {
      const listing = await getOwnedListingTx(tx, routeParam(req.params.id), actor);
      if (listing.status !== "ACTIVE") {
        throw new AppError(
          409,
          "Only active listings can be paused",
          "INVALID_STATUS",
        );
      }
      return tx.listing.update({
        where: { id: listing.id },
        data: { status: "PAUSED" },
        select: listingPublicSelect,
      });
    });
    res.json({ listing: updated });
  }),
);

listingsRouter.delete(
  "/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const actor = actorOf(req);
    const updated = await withRlsTransaction({ actor }, async (tx) => {
      const listing = await getOwnedListingTx(tx, routeParam(req.params.id), actor);
      return tx.listing.update({
        where: { id: listing.id },
        data: { status: "REMOVED" },
        select: listingPublicSelect,
      });
    });
    res.json({ listing: updated });
  }),
);

async function getOwnedListingTx(
  tx: Parameters<Parameters<typeof withRlsTransaction>[1]>[0],
  id: string,
  actor: RlsActor,
) {
  const listing = await tx.listing.findUnique({ where: { id } });
  if (!listing || listing.status === "REMOVED") {
    throw new AppError(404, "Listing not found", "LISTING_NOT_FOUND");
  }
  if (listing.sellerId !== actor.id && actor.role !== "ADMIN") {
    throw new AppError(403, "Forbidden", "FORBIDDEN");
  }
  return listing;
}
