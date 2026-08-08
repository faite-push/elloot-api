import { Router } from "express";
import { env } from "../../config/env";
import { pingRedis, prisma } from "../../databases";

export const healthRouter = Router();

healthRouter.get("/", async (_req, res) => {
  let db: "up" | "down" = "down";
  try {
    await prisma.$queryRaw`SELECT 1`;
    db = "up";
  } catch {
    db = "down";
  }

  const redisStatus = await pingRedis();
  // Redis is optional: "disabled" or even "down" should not block the API
  const ok = db === "up";

  res.status(ok ? 200 : 503).json({
    ok,
    service: "elloot-api",
    db,
    redis: redisStatus,
    ssl: {
      postgres: Boolean(env.postgresCertPath),
      redis: Boolean(env.redisCertPath),
    },
    timestamp: new Date().toISOString(),
  });
});

healthRouter.get("/live", (_req, res) => {
  res.json({ ok: true, service: "elloot-api" });
});
