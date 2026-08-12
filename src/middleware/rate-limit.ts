import rateLimit from "express-rate-limit";

/** Login / register / oauth exchange — tight. */
export const authStrictLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: {
      code: "RATE_LIMITED",
      message: "Too many auth attempts. Try again later.",
    },
  },
});

/** OAuth start redirects — moderate. */
export const authOauthStartLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: {
      code: "RATE_LIMITED",
      message: "Too many requests. Try again later.",
    },
  },
});

/** Media uploads. */
export const mediaUploadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: {
      code: "RATE_LIMITED",
      message: "Upload rate limit exceeded. Try again later.",
    },
  },
});

/** General API abuse brake (per IP). */
export const apiGeneralLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: {
      code: "RATE_LIMITED",
      message: "Too many requests. Slow down.",
    },
  },
});
