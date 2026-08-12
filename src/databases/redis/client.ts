import { readFileSync } from "node:fs";
import Redis from "ioredis";
import { env } from "../../config/env";

const globalForRedis = globalThis as unknown as {
  redis?: Redis | null;
};

function createRedis(): Redis | null {
  if (!env.REDIS_URL) {
    return null;
  }

  const tls =
    env.redisCertPath != null
      ? (() => {
          const pem = readFileSync(env.redisCertPath, "utf8");
          return { ca: pem, cert: pem, key: pem, rejectUnauthorized: true };
        })()
      : env.REDIS_URL.startsWith("rediss://")
        ? { rejectUnauthorized: true }
        : undefined;

  const client = new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: 1,
    enableReadyCheck: true,
    lazyConnect: true,
    retryStrategy: () => null,
    ...(tls ? { tls } : {}),
  });

  // Redis is optional — avoid unhandled error spam when offline
  client.on("error", () => {});

  return client;
}

export const redis =
  globalForRedis.redis === undefined
    ? (globalForRedis.redis = createRedis())
    : globalForRedis.redis;

export async function connectRedis() {
  if (!redis) return;
  if (redis.status === "wait" || redis.status === "end") {
    await redis.connect();
  }
}

export async function pingRedis(): Promise<"up" | "down" | "disabled"> {
  if (!redis) return "disabled";
  try {
    await connectRedis();
    const pong = await redis.ping();
    return pong === "PONG" ? "up" : "down";
  } catch {
    return "down";
  }
}

export function listingReserveKey(listingId: string) {
  return `elloot:listing:reserve:${listingId}`;
}

export function oauthStateKey(state: string) {
  return `elloot:oauth:state:${state}`;
}

export function oauthExchangeKey(code: string) {
  return `elloot:oauth:exchange:${code}`;
}
