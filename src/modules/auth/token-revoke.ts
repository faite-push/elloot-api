import { createHash, randomBytes } from "node:crypto";
import { connectRedis, redis } from "../../databases";
import { jwtExpiresMs } from "../../lib/auth-cookie";

const memoryRevoked = new Map<string, number>();

function revokeKey(jti: string) {
  return `elloot:jwt:revoked:${jti}`;
}

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function newTokenId() {
  return randomBytes(16).toString("hex");
}

/** Mark access token as revoked until its natural expiry (or JWT_EXPIRES_IN). */
export async function revokeAccessToken(
  token: string,
  opts?: { jti?: string; expiresAtMs?: number },
) {
  const jti = opts?.jti ?? hashToken(token);
  const ttlMs = Math.max(
    1_000,
    (opts?.expiresAtMs ?? Date.now() + jwtExpiresMs()) - Date.now(),
  );
  const ttlSec = Math.ceil(ttlMs / 1000);

  if (redis) {
    try {
      await connectRedis();
      await redis.set(revokeKey(jti), "1", "EX", ttlSec);
      return;
    } catch {
      // fall through
    }
  }
  memoryRevoked.set(jti, Date.now() + ttlMs);
}

export async function isAccessTokenRevoked(input: {
  jti?: string | null;
  token: string;
}): Promise<boolean> {
  const jti = input.jti || hashToken(input.token);
  if (redis) {
    try {
      await connectRedis();
      const hit = await redis.get(revokeKey(jti));
      if (hit) return true;
      // Also check memory (warm fallback after redis blip)
    } catch {
      // fall through
    }
  }
  const exp = memoryRevoked.get(jti);
  if (!exp) return false;
  if (exp < Date.now()) {
    memoryRevoked.delete(jti);
    return false;
  }
  return true;
}
