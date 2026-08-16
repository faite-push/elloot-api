-- Listing moderation: review queue + extended listing status.

ALTER TYPE "ListingStatus" ADD VALUE IF NOT EXISTS 'PENDING_REVIEW';
ALTER TYPE "ListingStatus" ADD VALUE IF NOT EXISTS 'REJECTED';

DO $$ BEGIN
  CREATE TYPE "ListingModerationType" AS ENUM ('INITIAL', 'REVISION');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "ListingModerationStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'SUPERSEDED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE listings
  ADD COLUMN IF NOT EXISTS "moderationNote" TEXT,
  ADD COLUMN IF NOT EXISTS "submittedForReviewAt" TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS listing_moderation_queue (
  id TEXT PRIMARY KEY,
  "listingId" TEXT NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  type "ListingModerationType" NOT NULL,
  status "ListingModerationStatus" NOT NULL DEFAULT 'PENDING',
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  "changedFields" TEXT[] NOT NULL DEFAULT '{}',
  "reviewNote" TEXT,
  "reviewedById" TEXT REFERENCES users(id),
  "reviewedAt" TIMESTAMPTZ,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS listing_moderation_queue_status_created_idx
  ON listing_moderation_queue (status, "createdAt");

CREATE INDEX IF NOT EXISTS listing_moderation_queue_listing_status_idx
  ON listing_moderation_queue ("listingId", status);

ALTER TABLE listing_moderation_queue ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS listing_moderation_queue_select ON listing_moderation_queue;
CREATE POLICY listing_moderation_queue_select ON listing_moderation_queue FOR SELECT
  USING (
    app_is_admin()
    OR app_is_service()
    OR EXISTS (
      SELECT 1 FROM listings l
      WHERE l.id = "listingId" AND l."sellerId" = app_current_user_id()
    )
  );

DROP POLICY IF EXISTS listing_moderation_queue_insert ON listing_moderation_queue;
CREATE POLICY listing_moderation_queue_insert ON listing_moderation_queue FOR INSERT
  WITH CHECK (
    app_is_service()
    OR EXISTS (
      SELECT 1 FROM listings l
      WHERE l.id = "listingId" AND l."sellerId" = app_current_user_id()
    )
  );

DROP POLICY IF EXISTS listing_moderation_queue_update ON listing_moderation_queue;
CREATE POLICY listing_moderation_queue_update ON listing_moderation_queue FOR UPDATE
  USING (
    app_is_admin()
    OR app_is_service()
    OR (
      status = 'PENDING'
      AND EXISTS (
        SELECT 1 FROM listings l
        WHERE l.id = "listingId" AND l."sellerId" = app_current_user_id()
      )
    )
  )
  WITH CHECK (
    app_is_admin()
    OR app_is_service()
    OR (
      status IN ('PENDING', 'SUPERSEDED')
      AND EXISTS (
        SELECT 1 FROM listings l
        WHERE l.id = "listingId" AND l."sellerId" = app_current_user_id()
      )
    )
  );

DROP POLICY IF EXISTS listing_moderation_queue_delete ON listing_moderation_queue;
CREATE POLICY listing_moderation_queue_delete ON listing_moderation_queue FOR DELETE
  USING (app_is_admin() OR app_is_service());
