import { z } from "zod";
import { loadEnvironment } from "./load-env";
import { resolveSslCertPath, withPostgresSsl } from "./ssl";

loadEnvironment();

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3333),
  CORS_ORIGIN: z.string().default("http://localhost:3000"),
  APP_URL: z.string().default("http://localhost:3333"),
  FRONTEND_URL: z.string().default("http://localhost:3000"),
  DATABASE_URL: z.string().min(1),
  DATABASE_SSL_CERT_PATH: z.string().optional(),
  DATABASE_SSL_CERT: z.string().optional(),
  REDIS_URL: z.string().optional(),
  REDIS_SSL_CERT_PATH: z.string().optional(),
  REDIS_SSL_CERT: z.string().optional(),
  JWT_SECRET: z.string().min(16),
  JWT_EXPIRES_IN: z.string().default("7d"),
  PLATFORM_FEE_BPS: z.coerce.number().int().min(0).max(10_000).default(1000),
  ESCROW_AUTO_RELEASE_HOURS: z.coerce.number().int().positive().default(48),
  PAYMENT_PROVIDER: z.enum(["sandbox"]).default("sandbox"),
  CHECKOUT_RESERVE_SECONDS: z.coerce.number().int().positive().default(900),
  JOB_SECRET: z.string().optional(),
  JOB_POLL_MS: z.coerce.number().int().min(0).default(60_000),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  DISCORD_CLIENT_ID: z.string().optional(),
  DISCORD_CLIENT_SECRET: z.string().optional(),

  /** local = disk under MEDIA_LOCAL_DIR; s3 = S3/R2 compatible */
  MEDIA_DRIVER: z.enum(["local", "s3"]).default("local"),
  MEDIA_LOCAL_DIR: z.string().default("./storage/media"),
  /** Public base for CDN URLs (R2 custom domain / CloudFront). Empty = API serves content. */
  MEDIA_PUBLIC_BASE_URL: z.string().optional(),
  MEDIA_MAX_BYTES: z.coerce.number().int().positive().default(5_242_880),
  MEDIA_SIGNING_SECRET: z.string().optional(),
  MEDIA_SIGN_TTL_SECONDS: z.coerce.number().int().positive().default(900),

  MEDIA_S3_ENDPOINT: z.string().optional(),
  MEDIA_S3_REGION: z.string().default("auto"),
  MEDIA_S3_BUCKET: z.string().optional(),
  MEDIA_S3_ACCESS_KEY_ID: z.string().optional(),
  MEDIA_S3_SECRET_ACCESS_KEY: z.string().optional(),
  MEDIA_S3_FORCE_PATH_STYLE: z
    .enum(["true", "false"])
    .default("true")
    .transform((v) => v === "true"),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("Invalid environment variables:", parsed.error.flatten().fieldErrors);
  process.exit(1);
}

const data = parsed.data;

const postgresCertPath = resolveSslCertPath({
  pathEnv: data.DATABASE_SSL_CERT_PATH,
  contentEnv: data.DATABASE_SSL_CERT,
  filename: "postgres.pem",
});

const redisCertPath = resolveSslCertPath({
  pathEnv: data.REDIS_SSL_CERT_PATH,
  contentEnv: data.REDIS_SSL_CERT,
  filename: "redis.pem",
});

if (postgresCertPath) {
  process.env.DATABASE_URL = withPostgresSsl(data.DATABASE_URL, postgresCertPath);
}

const s3Configured = Boolean(
  data.MEDIA_S3_BUCKET &&
    data.MEDIA_S3_ACCESS_KEY_ID &&
    data.MEDIA_S3_SECRET_ACCESS_KEY,
);

if (data.MEDIA_DRIVER === "s3" && !s3Configured) {
  console.error(
    "MEDIA_DRIVER=s3 requires MEDIA_S3_BUCKET, MEDIA_S3_ACCESS_KEY_ID, MEDIA_S3_SECRET_ACCESS_KEY",
  );
  process.exit(1);
}

export const env = {
  ...data,
  DATABASE_URL: process.env.DATABASE_URL!,
  postgresCertPath,
  redisCertPath,
  googleEnabled: Boolean(data.GOOGLE_CLIENT_ID && data.GOOGLE_CLIENT_SECRET),
  discordEnabled: Boolean(data.DISCORD_CLIENT_ID && data.DISCORD_CLIENT_SECRET),
  mediaSigningSecret: data.MEDIA_SIGNING_SECRET || data.JWT_SECRET,
  s3Configured,
};
