import { Router } from "express";
import { withRlsTransaction, type RlsActor } from "../../databases";
import { asyncHandler } from "../../lib/async-handler";
import { AppError } from "../../lib/errors";
import { routeParam } from "../../lib/route-param";
import { requireAuth } from "../../middleware/auth";

export const walletRouter = Router();

function actorOf(req: { user?: RlsActor }): RlsActor {
  return { id: req.user!.id, role: req.user!.role };
}

/** Read-only wallet. Ledger is append-only at DB level; no user write routes. */
walletRouter.get(
  "/",
  requireAuth,
  asyncHandler(async (req, res) => {
    const actor = actorOf(req);
    const data = await withRlsTransaction({ actor }, async (tx) => {
      const last = await tx.walletLedger.findFirst({
        where: { userId: actor.id },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      });
      const entries = await tx.walletLedger.findMany({
        where: { userId: actor.id },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 50,
        select: {
          id: true,
          type: true,
          amountCents: true,
          balanceAfter: true,
          description: true,
          orderId: true,
          createdAt: true,
        },
      });
      return { balanceCents: last?.balanceAfter ?? 0, entries };
    });
    res.json(data);
  }),
);

walletRouter.get(
  "/:userId",
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = routeParam(req.params.userId, "userId");
    const actor = actorOf(req);
    if (actor.id !== userId && actor.role !== "ADMIN") {
      throw new AppError(403, "Forbidden", "FORBIDDEN");
    }

    const balanceCents = await withRlsTransaction({ actor }, async (tx) => {
      const last = await tx.walletLedger.findFirst({
        where: { userId },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      });
      return last?.balanceAfter ?? 0;
    });

    res.json({ balanceCents });
  }),
);
