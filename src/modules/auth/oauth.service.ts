import { randomBytes } from "node:crypto";
import { env } from "../../config/env";
import {
  connectRedis,
  oauthStateKey,
  redis,
  withServiceTransaction,
} from "../../databases";
import { AppError } from "../../lib/errors";
import { sanitizeUserText } from "../../lib/sanitize";
import { signAccessToken } from "../../middleware/auth";

export type OAuthProvider = "google" | "discord";

type OAuthProfile = {
  provider: OAuthProvider;
  providerAccountId: string;
  email: string;
  name?: string;
  avatarUrl?: string;
};

const memoryStates = new Map<string, number>();

async function saveState(state: string) {
  const key = oauthStateKey(state);
  if (redis) {
    try {
      await connectRedis();
      await redis.set(key, "1", "EX", 600);
      return;
    } catch {
      // fall through to memory
    }
  }
  memoryStates.set(state, Date.now() + 600_000);
}

async function consumeState(state: string) {
  const key = oauthStateKey(state);
  if (redis) {
    try {
      await connectRedis();
      const ok = await redis.get(key);
      if (!ok) return false;
      await redis.del(key);
      return true;
    } catch {
      // fall through to memory
    }
  }
  const expires = memoryStates.get(state);
  memoryStates.delete(state);
  return Boolean(expires && expires > Date.now());
}

function requireGoogleConfig() {
  if (!env.googleEnabled) {
    throw new AppError(
      503,
      "Google login is not configured",
      "OAUTH_NOT_CONFIGURED",
    );
  }
}

function requireDiscordConfig() {
  if (!env.discordEnabled) {
    throw new AppError(
      503,
      "Discord login is not configured",
      "OAUTH_NOT_CONFIGURED",
    );
  }
}

export async function getGoogleAuthUrl() {
  requireGoogleConfig();
  const state = randomBytes(24).toString("hex");
  await saveState(state);

  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", env.GOOGLE_CLIENT_ID!);
  url.searchParams.set("redirect_uri", `${env.APP_URL}/api/auth/google/callback`);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid email profile");
  url.searchParams.set("access_type", "online");
  url.searchParams.set("prompt", "select_account");
  url.searchParams.set("state", state);
  return url.toString();
}

export async function getDiscordAuthUrl() {
  requireDiscordConfig();
  const state = randomBytes(24).toString("hex");
  await saveState(state);

  const url = new URL("https://discord.com/api/oauth2/authorize");
  url.searchParams.set("client_id", env.DISCORD_CLIENT_ID!);
  url.searchParams.set(
    "redirect_uri",
    `${env.APP_URL}/api/auth/discord/callback`,
  );
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "identify email");
  url.searchParams.set("state", state);
  url.searchParams.set("prompt", "consent");
  return url.toString();
}

async function exchangeGoogleCode(code: string): Promise<OAuthProfile> {
  requireGoogleConfig();
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID!,
      client_secret: env.GOOGLE_CLIENT_SECRET!,
      redirect_uri: `${env.APP_URL}/api/auth/google/callback`,
      grant_type: "authorization_code",
    }),
  });

  if (!tokenRes.ok) {
    throw new AppError(401, "Google token exchange failed", "OAUTH_TOKEN_FAILED");
  }

  const tokenJson = (await tokenRes.json()) as { access_token?: string };
  if (!tokenJson.access_token) {
    throw new AppError(401, "Google access token missing", "OAUTH_TOKEN_FAILED");
  }

  const profileRes = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
    headers: { Authorization: `Bearer ${tokenJson.access_token}` },
  });
  if (!profileRes.ok) {
    throw new AppError(401, "Google profile fetch failed", "OAUTH_PROFILE_FAILED");
  }

  const profile = (await profileRes.json()) as {
    sub: string;
    email?: string;
    email_verified?: boolean;
    name?: string;
    picture?: string;
  };

  if (!profile.email || profile.email_verified === false) {
    throw new AppError(400, "Google account email is not verified", "OAUTH_EMAIL_REQUIRED");
  }

  return {
    provider: "google",
    providerAccountId: profile.sub,
    email: profile.email.toLowerCase(),
    name: profile.name,
    avatarUrl: profile.picture,
  };
}

async function exchangeDiscordCode(code: string): Promise<OAuthProfile> {
  requireDiscordConfig();
  const tokenRes = await fetch("https://discord.com/api/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: env.DISCORD_CLIENT_ID!,
      client_secret: env.DISCORD_CLIENT_SECRET!,
      redirect_uri: `${env.APP_URL}/api/auth/discord/callback`,
      grant_type: "authorization_code",
    }),
  });

  if (!tokenRes.ok) {
    throw new AppError(401, "Discord token exchange failed", "OAUTH_TOKEN_FAILED");
  }

  const tokenJson = (await tokenRes.json()) as { access_token?: string };
  if (!tokenJson.access_token) {
    throw new AppError(401, "Discord access token missing", "OAUTH_TOKEN_FAILED");
  }

  const profileRes = await fetch("https://discord.com/api/users/@me", {
    headers: { Authorization: `Bearer ${tokenJson.access_token}` },
  });
  if (!profileRes.ok) {
    throw new AppError(401, "Discord profile fetch failed", "OAUTH_PROFILE_FAILED");
  }

  const profile = (await profileRes.json()) as {
    id: string;
    email?: string | null;
    verified?: boolean;
    global_name?: string | null;
    username: string;
    avatar?: string | null;
  };

  if (!profile.email || !profile.verified) {
    throw new AppError(
      400,
      "Discord account email is required and must be verified",
      "OAUTH_EMAIL_REQUIRED",
    );
  }

  const avatarUrl = profile.avatar
    ? `https://cdn.discordapp.com/avatars/${profile.id}/${profile.avatar}.png`
    : undefined;

  return {
    provider: "discord",
    providerAccountId: profile.id,
    email: profile.email.toLowerCase(),
    name: profile.global_name || profile.username,
    avatarUrl,
  };
}

export async function upsertOAuthUser(profile: OAuthProfile) {
  const safeName = profile.name
    ? sanitizeUserText(profile.name, 80)
    : undefined;

  return withServiceTransaction(async (tx) => {
    const existingAccount = await tx.account.findUnique({
      where: {
        provider_providerAccountId: {
          provider: profile.provider,
          providerAccountId: profile.providerAccountId,
        },
      },
      include: { user: true },
    });

    if (existingAccount) {
      return tx.user.update({
        where: { id: existingAccount.userId },
        data: {
          name: safeName ?? existingAccount.user.name,
          avatarUrl: profile.avatarUrl ?? existingAccount.user.avatarUrl,
        },
      });
    }

    const byEmail = await tx.user.findUnique({
      where: { email: profile.email },
    });

    if (byEmail) {
      await tx.account.create({
        data: {
          userId: byEmail.id,
          provider: profile.provider,
          providerAccountId: profile.providerAccountId,
        },
      });
      return tx.user.update({
        where: { id: byEmail.id },
        data: {
          name: safeName ?? byEmail.name,
          avatarUrl: profile.avatarUrl ?? byEmail.avatarUrl,
        },
      });
    }

    return tx.user.create({
      data: {
        email: profile.email,
        name: safeName,
        avatarUrl: profile.avatarUrl,
        role: "BUYER",
        emailVerifiedAt: new Date(),
        lastSeenAt: new Date(),
        accounts: {
          create: {
            provider: profile.provider,
            providerAccountId: profile.providerAccountId,
          },
        },
      },
    });
  });
}

export async function handleOAuthCallback(
  provider: OAuthProvider,
  code: string | undefined,
  state: string | undefined,
) {
  if (!code || !state) {
    throw new AppError(400, "Missing OAuth code or state", "OAUTH_INVALID_REQUEST");
  }

  const validState = await consumeState(state);
  if (!validState) {
    throw new AppError(400, "Invalid or expired OAuth state", "OAUTH_INVALID_STATE");
  }

  const profile =
    provider === "google"
      ? await exchangeGoogleCode(code)
      : await exchangeDiscordCode(code);

  const user = await upsertOAuthUser(profile);
  const accessToken = signAccessToken({
    id: user.id,
    email: user.email,
    role: user.role,
  });

  return {
    accessToken,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      avatarUrl: user.avatarUrl,
      role: user.role,
      kycStatus: user.kycStatus,
      createdAt: user.createdAt,
    },
  };
}

export function buildFrontendRedirect(accessToken: string) {
  const url = new URL("/auth/callback", env.FRONTEND_URL);
  url.searchParams.set("accessToken", accessToken);
  return url.toString();
}
