import { z } from "zod";

export const mediaPurposeSchema = z.enum([
  "GENERAL",
  "LISTING",
  "AVATAR",
  "CATEGORY",
]);

export const mediaVisibilitySchema = z.enum(["PUBLIC", "PRIVATE"]);

const emptyToUndefined = (v: unknown) =>
  v === "" || v === null || v === undefined ? undefined : v;

export const uploadFieldsSchema = z.object({
  purpose: z.preprocess(
    emptyToUndefined,
    mediaPurposeSchema.default("GENERAL"),
  ),
  visibility: z.preprocess(
    emptyToUndefined,
    mediaVisibilitySchema.default("PUBLIC"),
  ),
});

export const presignSchema = z.object({
  mimeType: z.enum(["image/jpeg", "image/png", "image/webp"]),
  purpose: mediaPurposeSchema.default("GENERAL"),
  visibility: mediaVisibilitySchema.default("PUBLIC"),
  originalName: z.string().max(180).optional(),
});

export const confirmSchema = z.object({
  assetId: z.string().min(1),
});
