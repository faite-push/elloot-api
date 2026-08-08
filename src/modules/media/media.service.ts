import { randomUUID } from "node:crypto";
import type { MediaPurpose, MediaVisibility, Prisma } from "@prisma/client";
import { env } from "../../config/env";
import { AppError } from "../../lib/errors";
import {
  processImageUpload,
  sanitizeOriginalName,
} from "./media.image";
import {
  createPresignedUpload,
  deleteObject,
  getObjectBuffer,
  objectExists,
  publicUrlForAsset,
  putObject,
  sha256Hex,
  signContentAccess,
  verifyContentAccess,
} from "./media.storage";

export type MediaActor = {
  id: string;
  role: "BUYER" | "SELLER" | "ADMIN";
};

const MAX_ASSETS_PER_USER = 200;

function buildObjectKey(input: {
  ownerId: string;
  extension: string;
  purpose: MediaPurpose;
}) {
  const yyyy = new Date().getUTCFullYear();
  const mm = String(new Date().getUTCMonth() + 1).padStart(2, "0");
  const id = randomUUID().replace(/-/g, "");
  return `media/${input.purpose.toLowerCase()}/${input.ownerId}/${yyyy}/${mm}/${id}.${input.extension}`;
}

function serializeAsset(asset: {
  id: string;
  key: string;
  url: string;
  mimeType: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  purpose: MediaPurpose;
  visibility: MediaVisibility;
  originalName: string | null;
  createdAt: Date;
}) {
  return {
    id: asset.id,
    url: asset.url,
    mimeType: asset.mimeType,
    sizeBytes: asset.sizeBytes,
    width: asset.width,
    height: asset.height,
    purpose: asset.purpose,
    visibility: asset.visibility,
    originalName: asset.originalName,
    createdAt: asset.createdAt.toISOString(),
  };
}

async function assertUploadQuota(
  tx: Prisma.TransactionClient,
  ownerId: string,
) {
  const count = await tx.mediaAsset.count({
    where: { ownerId, deletedAt: null },
  });
  if (count >= MAX_ASSETS_PER_USER) {
    throw new AppError(
      429,
      `Upload limit reached (${MAX_ASSETS_PER_USER} files)`,
      "MEDIA_QUOTA",
    );
  }
}

export async function uploadImage(
  tx: Prisma.TransactionClient,
  actor: MediaActor,
  input: {
    buffer: Buffer;
    originalName?: string;
    purpose: MediaPurpose;
    visibility: MediaVisibility;
  },
) {
  if (input.purpose === "CATEGORY" && actor.role !== "ADMIN") {
    throw new AppError(403, "Only admins can upload catalog media", "FORBIDDEN");
  }

  await assertUploadQuota(tx, actor.id);

  const processed = await processImageUpload(input.buffer, {
    preferWebp: true,
    maxEdge: input.purpose === "AVATAR" ? 512 : 2048,
  });

  const key = buildObjectKey({
    ownerId: actor.id,
    extension: processed.extension,
    purpose: input.purpose,
  });

  await putObject({
    key,
    body: processed.buffer,
    mimeType: processed.mimeType,
  });

  // Temporary url; rewritten with id after create
  const placeholderUrl = "pending";

  const created = await tx.mediaAsset.create({
    data: {
      ownerId: actor.id,
      key,
      url: placeholderUrl,
      mimeType: processed.mimeType,
      sizeBytes: processed.buffer.byteLength,
      width: processed.width,
      height: processed.height,
      purpose: input.purpose,
      visibility: input.visibility,
      originalName: sanitizeOriginalName(input.originalName),
      checksumSha256: sha256Hex(processed.buffer),
    },
  });

  const url = publicUrlForAsset({ id: created.id, key: created.key });
  const asset = await tx.mediaAsset.update({
    where: { id: created.id },
    data: { url },
  });

  return serializeAsset(asset);
}

export async function createPresignSession(
  tx: Prisma.TransactionClient,
  actor: MediaActor,
  input: {
    mimeType: string;
    purpose: MediaPurpose;
    visibility: MediaVisibility;
    originalName?: string;
  },
) {
  if (env.MEDIA_DRIVER !== "s3") {
    throw new AppError(
      400,
      "Presigned uploads require MEDIA_DRIVER=s3",
      "MEDIA_PRESIGN_UNSUPPORTED",
    );
  }

  if (input.purpose === "CATEGORY" && actor.role !== "ADMIN") {
    throw new AppError(403, "Only admins can upload catalog media", "FORBIDDEN");
  }

  const allowed = new Set(["image/jpeg", "image/png", "image/webp"]);
  if (!allowed.has(input.mimeType)) {
    throw new AppError(415, "Unsupported MIME type", "MEDIA_UNSUPPORTED_TYPE");
  }

  await assertUploadQuota(tx, actor.id);

  const extension =
    input.mimeType === "image/png"
      ? "png"
      : input.mimeType === "image/webp"
        ? "webp"
        : "jpg";

  const key = buildObjectKey({
    ownerId: actor.id,
    extension,
    purpose: input.purpose,
  });

  const created = await tx.mediaAsset.create({
    data: {
      ownerId: actor.id,
      key,
      url: "pending",
      mimeType: input.mimeType,
      sizeBytes: 0,
      purpose: input.purpose,
      visibility: input.visibility,
      originalName: sanitizeOriginalName(input.originalName),
    },
  });

  const { uploadUrl, headers } = await createPresignedUpload({
    key,
    mimeType: input.mimeType,
  });

  return {
    asset: serializeAsset({ ...created, url: publicUrlForAsset(created) }),
    upload: {
      method: "PUT" as const,
      url: uploadUrl,
      headers,
      maxBytes: env.MEDIA_MAX_BYTES,
      expiresInSeconds: env.MEDIA_SIGN_TTL_SECONDS,
    },
  };
}

/** After client PUTs to S3: download, sanitize with sharp, rewrite object, finalize row. */
export async function confirmPresignedUpload(
  tx: Prisma.TransactionClient,
  actor: MediaActor,
  assetId: string,
) {
  const asset = await tx.mediaAsset.findFirst({
    where: { id: assetId, deletedAt: null },
  });
  if (!asset) {
    throw new AppError(404, "Media not found", "MEDIA_NOT_FOUND");
  }
  if (asset.ownerId !== actor.id && actor.role !== "ADMIN") {
    throw new AppError(403, "Forbidden", "FORBIDDEN");
  }
  if (asset.sizeBytes > 0 && asset.checksumSha256) {
    return serializeAsset(asset);
  }

  const exists = await objectExists(asset.key);
  if (!exists) {
    throw new AppError(
      400,
      "Upload not found in storage — PUT the file first",
      "MEDIA_UPLOAD_MISSING",
    );
  }

  const { body } = await getObjectBuffer(asset.key);
  if (body.byteLength > env.MEDIA_MAX_BYTES) {
    await deleteObject(asset.key);
    await tx.mediaAsset.update({
      where: { id: asset.id },
      data: { deletedAt: new Date() },
    });
    throw new AppError(413, "File too large", "MEDIA_TOO_LARGE");
  }

  const processed = await processImageUpload(body, {
    preferWebp: true,
    maxEdge: asset.purpose === "AVATAR" ? 512 : 2048,
  });

  const finalKey = asset.key.replace(/\.[a-z0-9]+$/i, `.${processed.extension}`);

  if (finalKey !== asset.key) {
    await deleteObject(asset.key);
  }

  await putObject({
    key: finalKey,
    body: processed.buffer,
    mimeType: processed.mimeType,
    overwrite: true,
  });

  const url = publicUrlForAsset({ id: asset.id, key: finalKey });
  const updated = await tx.mediaAsset.update({
    where: { id: asset.id },
    data: {
      key: finalKey,
      url,
      mimeType: processed.mimeType,
      sizeBytes: processed.buffer.byteLength,
      width: processed.width,
      height: processed.height,
      checksumSha256: sha256Hex(processed.buffer),
    },
  });

  return serializeAsset(updated);
}

export async function listMyMedia(
  tx: Prisma.TransactionClient,
  actor: MediaActor,
) {
  const assets = await tx.mediaAsset.findMany({
    where: { ownerId: actor.id, deletedAt: null },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  return assets.map(serializeAsset);
}

export async function getMediaMeta(
  tx: Prisma.TransactionClient,
  actor: MediaActor | null,
  assetId: string,
) {
  const asset = await tx.mediaAsset.findFirst({
    where: { id: assetId, deletedAt: null },
  });
  if (!asset) {
    throw new AppError(404, "Media not found", "MEDIA_NOT_FOUND");
  }

  if (asset.visibility === "PRIVATE") {
    if (!actor || (asset.ownerId !== actor.id && actor.role !== "ADMIN")) {
      throw new AppError(403, "Forbidden", "FORBIDDEN");
    }
  }

  return serializeAsset(asset);
}

export async function softDeleteMedia(
  tx: Prisma.TransactionClient,
  actor: MediaActor,
  assetId: string,
) {
  const asset = await tx.mediaAsset.findFirst({
    where: { id: assetId, deletedAt: null },
  });
  if (!asset) {
    throw new AppError(404, "Media not found", "MEDIA_NOT_FOUND");
  }
  if (asset.ownerId !== actor.id && actor.role !== "ADMIN") {
    throw new AppError(403, "Forbidden", "FORBIDDEN");
  }

  await deleteObject(asset.key);
  await tx.mediaAsset.update({
    where: { id: asset.id },
    data: { deletedAt: new Date() },
  });

  return { ok: true as const };
}

export async function resolveContentAccess(input: {
  asset: {
    id: string;
    ownerId: string | null;
    visibility: MediaVisibility;
    deletedAt: Date | null;
  };
  actor: MediaActor | null;
  query: { exp?: string; nonce?: string; sig?: string };
}) {
  if (input.asset.deletedAt) {
    throw new AppError(404, "Media not found", "MEDIA_NOT_FOUND");
  }

  if (input.asset.visibility === "PUBLIC") {
    return true;
  }

  if (
    input.actor &&
    (input.actor.id === input.asset.ownerId || input.actor.role === "ADMIN")
  ) {
    return true;
  }

  if (
    input.query.exp &&
    input.query.nonce &&
    input.query.sig &&
    verifyContentAccess({
      assetId: input.asset.id,
      exp: input.query.exp,
      nonce: input.query.nonce,
      sig: input.query.sig,
    })
  ) {
    return true;
  }

  throw new AppError(403, "Forbidden", "FORBIDDEN");
}

export function issueSignedUrl(assetId: string) {
  return signContentAccess(assetId);
}

export { publicUrlForAsset, getObjectBuffer };
