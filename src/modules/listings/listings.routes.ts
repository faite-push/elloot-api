import { Router } from "express";
import {
  withRlsTransaction,
  type RlsActor,
} from "../../databases";
import { asyncHandler } from "../../lib/async-handler";
import { AppError } from "../../lib/errors";
import { routeParam } from "../../lib/route-param";
import { sanitizeUserText } from "../../lib/sanitize";
import { setAuthCookie } from "../../lib/auth-cookie";
import { optionalAuth } from "../../middleware/optional-auth";
import {
  invalidateAuthUserCache,
  requireAuth,
  signAccessToken,
  verifyAccessToken,
} from "../../middleware/auth";
import { revokeAccessToken } from "../auth/token-revoke";
import { createListingSchema, reorderOffersSchema, updateListingSchema } from "./listings.schemas";
import {
  assertLeafCategory,
  resolveOwnedListingMedia,
} from "./listings.media";
import {
  applyImmediateOffersOnlyTx,
  applyListingUpdateTx,
  getPendingModerationForListingTx,
  splitListingUpdate,
  submitListingForReviewTx,
  upsertPendingRevisionTx,
} from "./listings.moderation";
import {
  listingPublicSelect,
  serializeListingPublic,
  aggregateSellerReviews,
  emptySellerReviewAgg,
} from "./listings.shared";
import {
  listingEventBodySchema,
  recordListingEvent,
} from "./listings.events";

export const listingsRouter = Router();

function actorOf(req: { user?: RlsActor }): RlsActor {
  return { id: req.user!.id, role: req.user!.role };
}

function hasPayloadKeys(obj: Record<string, unknown>) {
  return Object.keys(obj).length > 0;
}

function attachModerationMeta<T extends Record<string, unknown>>(
  listing: T,
  extra: {
    moderationNote?: string | null;
    submittedForReviewAt?: Date | null;
    pendingModeration?: Awaited<
      ReturnType<typeof getPendingModerationForListingTx>
    >;
  },
) {
  return {
    ...listing,
    moderationNote: extra.moderationNote ?? null,
    submittedForReviewAt:
      extra.submittedForReviewAt?.toISOString() ?? null,
    pendingModeration: extra.pendingModeration
      ? {
          id: extra.pendingModeration.id,
          type: extra.pendingModeration.type,
          status: extra.pendingModeration.status,
          changedFields: extra.pendingModeration.changedFields,
          reviewNote: extra.pendingModeration.reviewNote,
          createdAt: extra.pendingModeration.createdAt.toISOString(),
          updatedAt: extra.pendingModeration.updatedAt.toISOString(),
        }
      : null,
  } as T & {
    moderationNote: string | null;
    submittedForReviewAt: string | null;
    pendingModeration: {
      id: string;
      type: string;
      status: string;
      changedFields: string[];
      reviewNote: string | null;
      createdAt: string;
      updatedAt: string;
    } | null;
  };
}

listingsRouter.get(
  "/mine",
  requireAuth,
  asyncHandler(async (req, res) => {
    const actor = actorOf(req);
    const listings = await withRlsTransaction({ actor }, async (tx) => {
      const rows = await tx.listing.findMany({
        where: { sellerId: actor.id, status: { not: "REMOVED" } },
        orderBy: { updatedAt: "desc" },
        select: {
          ...listingPublicSelect,
          moderationNote: true,
          submittedForReviewAt: true,
        },
      });

      return Promise.all(
        rows.map(async (row) => {
          const pending = await getPendingModerationForListingTx(tx, row.id);
          const { moderationNote, submittedForReviewAt, ...listing } = row;
          return attachModerationMeta(listing, {
            moderationNote,
            submittedForReviewAt,
            pendingModeration: pending,
          });
        }),
      );
    });
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
    const result = await withRlsTransaction({ actor }, async (tx) => {
      await assertLeafCategory(tx, body.categoryId);

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

      const mediaRows = await resolveOwnedListingMedia(tx, actor.id, {
        mediaAssetIds: body.mediaAssetIds,
        mediaUrls: body.mediaUrls,
      });

      const listing = await tx.listing.create({
        data: {
          sellerId: actor.id,
          categoryId: body.categoryId,
          title,
          description,
          priceCents,
          stockQuantity: body.stockQuantity ?? 1,
          productType: body.productType ?? null,
          listingModel,
          deliveryMode:
            listingModel === "DYNAMIC"
              ? offers.some((o) => o.deliveryMode === "AUTO")
                ? "AUTO"
                : "MANUAL"
              : (body.deliveryMode ?? "MANUAL"),
          status: body.publish ? "PENDING_REVIEW" : "DRAFT",
          submittedForReviewAt: body.publish ? new Date() : null,
          media: mediaRows.length
            ? {
                create: mediaRows.map((row) => ({
                  url: row.url,
                  sortOrder: row.sortOrder,
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
                    deliveryMode: offer.deliveryMode ?? "MANUAL",
                    sortOrder: index,
                  })),
                }
              : undefined,
        },
        select: listingPublicSelect,
      });

      if (body.publish) {
        await tx.listingModerationQueue.create({
          data: {
            listingId: listing.id,
            type: "INITIAL",
            status: "PENDING",
            payload: {},
            changedFields: ["initial"],
          },
        });
      }

      return listing;
    });

    if (promotedToSeller) {
      const accessToken = signAccessToken({
        id: req.user!.id,
        email: req.user!.email,
        role: "SELLER",
      });
      if (req.accessToken) {
        try {
          const prev = verifyAccessToken(req.accessToken);
          await revokeAccessToken(req.accessToken, {
            jti: prev.jti,
            expiresAtMs: prev.exp ? prev.exp * 1000 : undefined,
          });
        } catch {
          /* ignore */
        }
      }
      invalidateAuthUserCache(req.user!.id);
      setAuthCookie(res, accessToken);
    }

    res.status(201).json({
      listing: result,
      moderation: body.publish
        ? {
            status: "PENDING_REVIEW",
            message:
              "Anúncio enviado para análise. Você será notificado quando for aprovado.",
          }
        : null,
    });
  }),
);

listingsRouter.post(
  "/:id/events",
  optionalAuth,
  asyncHandler(async (req, res) => {
    const id = routeParam(req.params.id);
    const body = listingEventBodySchema.parse(req.body);
    const result = await recordListingEvent({
      listingId: id,
      type: body.type,
      visitorKey: body.visitorKey,
      viewerUserId: req.user?.id ?? null,
      amountCents: body.amountCents,
    });
    res.status(202).json(result);
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

    const row = await withRlsTransaction({ actor }, async (tx) => {
      const listing = await tx.listing.findUnique({
        where: { id },
        select: {
          ...listingPublicSelect,
          moderationNote: true,
          submittedForReviewAt: true,
        },
      });
      if (!listing) return null;

      const isOwner =
        req.user?.id === listing.seller.id || req.user?.role === "ADMIN";
      if (listing.status !== "ACTIVE" && !isOwner) {
        return null;
      }

      let pendingModeration = null;
      if (isOwner) {
        pendingModeration = await getPendingModerationForListingTx(tx, id);
      }

      return { listing, isOwner, pendingModeration };
    });

    if (!row || row.listing.status === "REMOVED") {
      throw new AppError(404, "Listing not found", "LISTING_NOT_FOUND");
    }

    const reviewRows = await withRlsTransaction({ actor }, (tx) =>
      tx.review.findMany({
        where: { sellerId: row.listing.seller.id },
        select: { rating: true },
        take: 5000,
      }),
    ).catch(() => [] as Array<{ rating: number }>);

    const reviewAgg =
      reviewRows.length > 0
        ? aggregateSellerReviews(reviewRows)
        : emptySellerReviewAgg();

    const { moderationNote, submittedForReviewAt, ...publicListing } =
      row.listing;

    let listingPayload = serializeListingPublic(publicListing, reviewAgg) as Record<
      string,
      unknown
    >;
    if (row.isOwner) {
      listingPayload = attachModerationMeta(listingPayload, {
        moderationNote,
        submittedForReviewAt,
        pendingModeration: row.pendingModeration,
      });
    }

    res.json({ listing: listingPayload });
  }),
);

listingsRouter.patch(
  "/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const body = updateListingSchema.parse(req.body);
    const actor = actorOf(req);
    const id = routeParam(req.params.id);

    const outcome = await withRlsTransaction({ actor }, async (tx) => {
      const listing = await getOwnedListingTx(tx, id, actor);
      if (listing.status === "SOLD") {
        throw new AppError(409, "Listing already sold", "LISTING_SOLD");
      }

      if (!["ACTIVE", "PAUSED"].includes(listing.status)) {
        const updated = await applyListingUpdateTx(tx, {
          ownerId: actor.id,
          listing,
          body,
        });
        const meta = await tx.listing.findUnique({
          where: { id: listing.id },
          select: { moderationNote: true, submittedForReviewAt: true },
        });
        const pending = await getPendingModerationForListingTx(tx, listing.id);
        return {
          listing: attachModerationMeta(updated, {
            moderationNote: meta?.moderationNote,
            submittedForReviewAt: meta?.submittedForReviewAt,
            pendingModeration: pending,
          }),
          moderation: {
            appliedImmediately: Object.keys(body),
            pendingRevision: null,
          },
        };
      }

      const existingOffers = await tx.listingOffer.findMany({
        where: { listingId: listing.id },
        orderBy: { sortOrder: "asc" },
        select: {
          id: true,
          title: true,
          priceCents: true,
          stockQuantity: true,
          deliveryMode: true,
          sortOrder: true,
        },
      });

      const existingMedia = await tx.listingMedia.findMany({
        where: { listingId: listing.id },
        orderBy: { sortOrder: "asc" },
        select: { url: true },
      });

      const split = splitListingUpdate(
        body,
        listing.status,
        existingOffers,
        existingMedia.map((m) => m.url),
      );

      let updated = await tx.listing.findUnique({
        where: { id: listing.id },
        select: listingPublicSelect,
      });

      const appliedImmediately: string[] = [];

      if (hasPayloadKeys(split.immediate as Record<string, unknown>)) {
        if (split.immediate.offers?.length) {
          updated =
            (await applyImmediateOffersOnlyTx(
              tx,
              listing.id,
              listing.listingModel,
              split.immediate.offers,
            )) ?? updated;
          appliedImmediately.push(...split.changedFields.filter((f) =>
            f.startsWith("offers."),
          ));
        }

        const scalarImmediate = { ...split.immediate };
        delete scalarImmediate.offers;
        delete scalarImmediate.mediaAssetIds;
        delete scalarImmediate.mediaUrls;

        if (
          scalarImmediate.priceCents !== undefined ||
          scalarImmediate.stockQuantity !== undefined
        ) {
          updated = await tx.listing.update({
            where: { id: listing.id },
            data: {
              priceCents: scalarImmediate.priceCents,
              stockQuantity: scalarImmediate.stockQuantity,
            },
            select: listingPublicSelect,
          });
          if (scalarImmediate.priceCents !== undefined) {
            appliedImmediately.push("priceCents");
          }
          if (scalarImmediate.stockQuantity !== undefined) {
            appliedImmediately.push("stockQuantity");
          }
        }

        if (split.immediate.mediaAssetIds || split.immediate.mediaUrls) {
          await applyListingUpdateTx(tx, {
            ownerId: actor.id,
            listing,
            body: {
              mediaAssetIds: split.immediate.mediaAssetIds,
              mediaUrls: split.immediate.mediaUrls,
            },
          });
          updated = await tx.listing.findUnique({
            where: { id: listing.id },
            select: listingPublicSelect,
          });
          appliedImmediately.push("media");
        }
      }

      let pendingRevision = null;

      if (hasPayloadKeys(split.moderated as Record<string, unknown>)) {
        const moderatedFields = split.changedFields.filter(
          (f) =>
            !appliedImmediately.includes(f) &&
            f !== "priceCents" &&
            f !== "stockQuantity" &&
            !f.startsWith("offers.priceCents") &&
            !f.startsWith("offers.stockQuantity") &&
            f !== "offers.removed",
        );

        pendingRevision = await upsertPendingRevisionTx(
          tx,
          listing.id,
          split.moderated,
          moderatedFields.length ? moderatedFields : split.changedFields,
        );
      }

      const pending = await getPendingModerationForListingTx(tx, listing.id);
      const meta = await tx.listing.findUnique({
        where: { id: listing.id },
        select: { moderationNote: true, submittedForReviewAt: true },
      });

      return {
        listing: attachModerationMeta(updated!, {
          moderationNote: meta?.moderationNote,
          submittedForReviewAt: meta?.submittedForReviewAt,
          pendingModeration: pending,
        }),
        moderation: {
          appliedImmediately: [...new Set(appliedImmediately)],
          pendingRevision: pendingRevision
            ? {
                id: pendingRevision.id,
                changedFields: pendingRevision.changedFields,
                message:
                  "Alterações enviadas para análise. O anúncio continua no ar com a versão atual até aprovação.",
              }
            : null,
        },
      };
    });

    res.json(outcome);
  }),
);

listingsRouter.post(
  "/:id/publish",
  requireAuth,
  asyncHandler(async (req, res) => {
    const actor = actorOf(req);
    const result = await withRlsTransaction({ actor }, async (tx) => {
      const listing = await getOwnedListingTx(
        tx,
        routeParam(req.params.id),
        actor,
      );
      const updated = await submitListingForReviewTx(tx, listing.id);
      const pending = await getPendingModerationForListingTx(tx, listing.id);
      const meta = await tx.listing.findUnique({
        where: { id: listing.id },
        select: { submittedForReviewAt: true },
      });
      return attachModerationMeta(updated, {
        moderationNote: null,
        submittedForReviewAt: meta?.submittedForReviewAt ?? new Date(),
        pendingModeration: pending,
      });
    });

    res.json({
      listing: result,
      moderation: {
        status: "PENDING_REVIEW",
        message:
          "Anúncio enviado para análise. Você será notificado quando for aprovado.",
      },
    });
  }),
);

listingsRouter.patch(
  "/:id/offers/reorder",
  requireAuth,
  asyncHandler(async (req, res) => {
    const body = reorderOffersSchema.parse(req.body);
    const actor = actorOf(req);
    const listingId = routeParam(req.params.id);

    const listing = await withRlsTransaction({ actor }, async (tx) => {
      const owned = await getOwnedListingTx(tx, listingId, actor);
      if (owned.listingModel !== "DYNAMIC") {
        throw new AppError(
          400,
          "Only dynamic listings have offers to reorder",
          "INVALID_LISTING_MODEL",
        );
      }

      const existing = await tx.listingOffer.findMany({
        where: { listingId: owned.id },
        select: { id: true },
      });
      const existingIds = new Set(existing.map((o) => o.id));

      if (body.offerIds.length !== existing.length) {
        throw new AppError(
          400,
          "offerIds must include every offer exactly once",
          "INVALID_OFFER_ORDER",
        );
      }

      const seen = new Set<string>();
      for (const id of body.offerIds) {
        if (!existingIds.has(id) || seen.has(id)) {
          throw new AppError(400, "Invalid offer id", "OFFER_NOT_FOUND");
        }
        seen.add(id);
      }

      for (const [index, offerId] of body.offerIds.entries()) {
        await tx.listingOffer.update({
          where: { id: offerId },
          data: { sortOrder: index },
        });
      }

      return tx.listing.findUnique({
        where: { id: owned.id },
        select: listingPublicSelect,
      });
    });

    res.json({ listing });
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

listingsRouter.post(
  "/:id/unpause",
  requireAuth,
  asyncHandler(async (req, res) => {
    const actor = actorOf(req);
    const updated = await withRlsTransaction({ actor }, async (tx) => {
      const listing = await getOwnedListingTx(tx, routeParam(req.params.id), actor);
      if (listing.status !== "PAUSED") {
        throw new AppError(
          409,
          "Only paused listings can be resumed",
          "INVALID_STATUS",
        );
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
