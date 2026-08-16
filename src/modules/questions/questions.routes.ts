import { Router } from "express";
import { z } from "zod";
import {
  withRlsTransaction,
  type RlsActor,
} from "../../databases";
import { asyncHandler } from "../../lib/async-handler";
import { AppError } from "../../lib/errors";
import { routeParam } from "../../lib/route-param";
import { sanitizeUserText } from "../../lib/sanitize";
import { requireAuth } from "../../middleware/auth";
import { notifyUser } from "../conversations/notifications.notify";

export const questionsRouter = Router();

function actorOf(req: { user?: RlsActor }): RlsActor {
  return { id: req.user!.id, role: req.user!.role };
}

const questionSelect = {
  id: true,
  listingId: true,
  askerId: true,
  body: true,
  answer: true,
  answeredAt: true,
  answeredById: true,
  moderated: true,
  createdAt: true,
  asker: { select: { id: true, name: true, avatarUrl: true } },
  answeredBy: { select: { id: true, name: true, avatarUrl: true } },
  listing: {
    select: {
      id: true,
      title: true,
      sellerId: true,
      media: {
        take: 1,
        orderBy: { sortOrder: "asc" as const },
        select: { url: true },
      },
    },
  },
} as const;

const createSchema = z.object({
  body: z.string().trim().min(5).max(1000),
});

const answerSchema = z.object({
  answer: z.string().trim().min(2).max(2000),
});

/** Public list for a listing. */
questionsRouter.get(
  "/by-listing/:listingId",
  asyncHandler(async (req, res) => {
    const listingId = routeParam(req.params.listingId, "listingId");
    const cursor =
      typeof req.query.cursor === "string" ? req.query.cursor : undefined;
    const take = Math.min(Number(req.query.limit) || 20, 50);

    const questions = await withRlsTransaction({}, async (tx) => {
      const listing = await tx.listing.findUnique({
        where: { id: listingId },
        select: { id: true, status: true },
      });
      if (!listing) {
        throw new AppError(404, "Listing not found", "LISTING_NOT_FOUND");
      }

      return tx.listingQuestion.findMany({
        where: {
          listingId,
          moderated: false,
          ...(cursor ? { id: { lt: cursor } } : {}),
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take,
        select: questionSelect,
      });
    });

    res.json({
      questions,
      nextCursor:
        questions.length === take
          ? (questions[questions.length - 1]?.id ?? null)
          : null,
    });
  }),
);

/** Questions I asked (buyer). */
questionsRouter.get(
  "/mine",
  requireAuth,
  asyncHandler(async (req, res) => {
    const actor = actorOf(req);
    const questions = await withRlsTransaction({ actor }, async (tx) =>
      tx.listingQuestion.findMany({
        where: { askerId: actor.id, moderated: false },
        orderBy: { createdAt: "desc" },
        take: 50,
        select: questionSelect,
      }),
    );
    res.json({ questions });
  }),
);

/** Questions on my listings (seller). */
questionsRouter.get(
  "/received",
  requireAuth,
  asyncHandler(async (req, res) => {
    const actor = actorOf(req);
    const unansweredOnly =
      req.query.unanswered === "1" || req.query.unanswered === "true";

    const questions = await withRlsTransaction({ actor }, async (tx) =>
      tx.listingQuestion.findMany({
        where: {
          moderated: false,
          listing: { sellerId: actor.id },
          ...(unansweredOnly ? { answer: null } : {}),
        },
        orderBy: { createdAt: "desc" },
        take: 50,
        select: questionSelect,
      }),
    );
    res.json({ questions });
  }),
);

questionsRouter.post(
  "/by-listing/:listingId",
  requireAuth,
  asyncHandler(async (req, res) => {
    const actor = actorOf(req);
    const listingId = routeParam(req.params.listingId, "listingId");
    const parsed = createSchema.parse(req.body);
    const body = sanitizeUserText(parsed.body, 1000);
    if (body.length < 5) {
      throw new AppError(400, "Question is too short", "VALIDATION_ERROR");
    }

    const result = await withRlsTransaction({ actor }, async (tx) => {
      const listing = await tx.listing.findUnique({
        where: { id: listingId },
        select: { id: true, status: true, sellerId: true, title: true },
      });
      if (!listing || listing.status !== "ACTIVE") {
        throw new AppError(404, "Listing not found", "LISTING_NOT_FOUND");
      }
      if (listing.sellerId === actor.id) {
        throw new AppError(
          400,
          "Cannot ask on your own listing",
          "INVALID_ASKER",
        );
      }

      const question = await tx.listingQuestion.create({
        data: {
          listingId,
          askerId: actor.id,
          body,
        },
        select: questionSelect,
      });

      return { question, sellerId: listing.sellerId, title: listing.title };
    });

    void notifyUser({
      userId: result.sellerId,
      type: "QUESTION",
      title: "Nova pergunta no anúncio",
      body: `Pergunta em “${result.title}”: ${body.slice(0, 80)}`,
      href: `/dashboard/questions/received`,
      meta: { questionId: result.question.id, listingId },
    });

    res.status(201).json({ question: result.question });
  }),
);

questionsRouter.post(
  "/:id/answer",
  requireAuth,
  asyncHandler(async (req, res) => {
    const actor = actorOf(req);
    const id = routeParam(req.params.id);
    const parsed = answerSchema.parse(req.body);
    const answer = sanitizeUserText(parsed.answer, 2000);
    if (answer.length < 2) {
      throw new AppError(400, "Answer is too short", "VALIDATION_ERROR");
    }

    const result = await withRlsTransaction({ actor }, async (tx) => {
      const existing = await tx.listingQuestion.findUnique({
        where: { id },
        include: {
          listing: { select: { id: true, sellerId: true, title: true } },
        },
      });
      if (!existing || existing.moderated) {
        throw new AppError(404, "Question not found", "QUESTION_NOT_FOUND");
      }
      if (
        existing.listing.sellerId !== actor.id &&
        actor.role !== "ADMIN"
      ) {
        throw new AppError(403, "Forbidden", "FORBIDDEN");
      }

      const question = await tx.listingQuestion.update({
        where: { id },
        data: {
          answer,
          answeredAt: new Date(),
          answeredById: actor.id,
        },
        select: questionSelect,
      });

      return {
        question,
        askerId: existing.askerId,
        listingId: existing.listingId,
        title: existing.listing.title,
      };
    });

    void notifyUser({
      userId: result.askerId,
      type: "QUESTION",
      title: "Sua pergunta foi respondida",
      body: `Resposta em “${result.title}”: ${answer.slice(0, 80)}`,
      href: `/listings/${result.listingId}`,
      meta: { questionId: result.question.id, listingId: result.listingId },
    });

    res.json({ question: result.question });
  }),
);
