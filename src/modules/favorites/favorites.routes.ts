import { Router } from "express";
import { z } from "zod";
import { withRlsTransaction, type RlsActor } from "../../databases";
import { asyncHandler } from "../../lib/async-handler";
import { AppError } from "../../lib/errors";
import { routeParam } from "../../lib/route-param";
import { requireAuth } from "../../middleware/auth";

export const favoritesRouter = Router();

function actorOf(req: { user?: RlsActor }): RlsActor {
  return { id: req.user!.id, role: req.user!.role };
}

favoritesRouter.get(
  "/mine",
  requireAuth,
  asyncHandler(async (req, res) => {
    const actor = actorOf(req);
    const favorites = await withRlsTransaction({ actor }, (tx) =>
      tx.favorite.findMany({
        where: { userId: actor.id },
        orderBy: { createdAt: "desc" },
        take: 200,
        select: { listingId: true, createdAt: true },
      }),
    );
    res.json({
      listingIds: favorites.map((row) => row.listingId),
      favorites,
    });
  }),
);

const toggleSchema = z.object({
  listingId: z.string().min(1),
});

favoritesRouter.post(
  "/toggle",
  requireAuth,
  asyncHandler(async (req, res) => {
    const actor = actorOf(req);
    const body = toggleSchema.parse(req.body);

    const result = await withRlsTransaction({ actor }, async (tx) => {
      const listing = await tx.listing.findUnique({
        where: { id: body.listingId },
        select: { id: true, status: true },
      });
      if (!listing || listing.status === "REMOVED") {
        throw new AppError(404, "Listing not found", "LISTING_NOT_FOUND");
      }

      const existing = await tx.favorite.findUnique({
        where: {
          userId_listingId: {
            userId: actor.id,
            listingId: body.listingId,
          },
        },
        select: { id: true },
      });

      if (existing) {
        await tx.favorite.delete({ where: { id: existing.id } });
        return { favorited: false as const };
      }

      await tx.favorite.create({
        data: {
          userId: actor.id,
          listingId: body.listingId,
        },
      });
      return { favorited: true as const };
    });

    res.json(result);
  }),
);

favoritesRouter.delete(
  "/:listingId",
  requireAuth,
  asyncHandler(async (req, res) => {
    const actor = actorOf(req);
    const listingId = routeParam(req.params.listingId, "listingId");
    await withRlsTransaction({ actor }, async (tx) => {
      await tx.favorite.deleteMany({
        where: { userId: actor.id, listingId },
      });
    });
    res.json({ ok: true });
  }),
);
