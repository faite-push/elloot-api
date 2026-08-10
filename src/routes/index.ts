import { Router } from "express";
import { authRouter } from "../modules/auth/auth.routes";
import { catalogRouter } from "../modules/catalog/catalog.routes";
import { conversationsRouter } from "../modules/conversations/conversations.routes";
import { disputesRouter } from "../modules/disputes/disputes.routes";
import { healthRouter } from "../modules/health/health.routes";
import { jobsRouter } from "../modules/jobs/jobs.routes";
import { listingsRouter } from "../modules/listings/listings.routes";
import { mediaRouter } from "../modules/media/media.routes";
import { notificationsRouter } from "../modules/notifications/notifications.routes";
import { ordersRouter } from "../modules/orders/orders.routes";
import { paymentsRouter } from "../modules/payments/payments.routes";
import { walletRouter } from "../modules/wallet/wallet.routes";

export const apiRouter = Router();

apiRouter.use("/health", healthRouter);
apiRouter.use("/auth", authRouter);
apiRouter.use("/catalog", catalogRouter);
apiRouter.use("/media", mediaRouter);
apiRouter.use("/listings", listingsRouter);
apiRouter.use("/orders", ordersRouter);
apiRouter.use("/payments", paymentsRouter);
apiRouter.use("/wallet", walletRouter);
apiRouter.use("/conversations", conversationsRouter);
apiRouter.use("/disputes", disputesRouter);
apiRouter.use("/notifications", notificationsRouter);
apiRouter.use("/jobs", jobsRouter);
