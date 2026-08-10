-- Seller profile fields, listing sales counters, reviews & listing Q&A.

ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "lastSeenAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "emailVerifiedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "phone" TEXT,
  ADD COLUMN IF NOT EXISTS "phoneVerifiedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "reputationScore" INTEGER NOT NULL DEFAULT 0;

-- Backfill: treat existing accounts as email-verified at creation time.
UPDATE "users"
SET "emailVerifiedAt" = "createdAt"
WHERE "emailVerifiedAt" IS NULL;

ALTER TABLE "listings"
  ADD COLUMN IF NOT EXISTS "unitsSold" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "salesCount" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS "reviews" (
  "id" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "listingId" TEXT NOT NULL,
  "sellerId" TEXT NOT NULL,
  "buyerId" TEXT NOT NULL,
  "rating" INTEGER NOT NULL,
  "comment" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "reviews_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "reviews_orderId_key" ON "reviews"("orderId");
CREATE INDEX IF NOT EXISTS "reviews_sellerId_createdAt_idx" ON "reviews"("sellerId", "createdAt");
CREATE INDEX IF NOT EXISTS "reviews_listingId_createdAt_idx" ON "reviews"("listingId", "createdAt");

DO $$ BEGIN
  ALTER TABLE "reviews"
    ADD CONSTRAINT "reviews_orderId_fkey"
    FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "reviews"
    ADD CONSTRAINT "reviews_listingId_fkey"
    FOREIGN KEY ("listingId") REFERENCES "listings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "reviews"
    ADD CONSTRAINT "reviews_sellerId_fkey"
    FOREIGN KEY ("sellerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "reviews"
    ADD CONSTRAINT "reviews_buyerId_fkey"
    FOREIGN KEY ("buyerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "listing_questions" (
  "id" TEXT NOT NULL,
  "listingId" TEXT NOT NULL,
  "askerId" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "answer" TEXT,
  "answeredAt" TIMESTAMP(3),
  "answeredById" TEXT,
  "moderated" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "listing_questions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "listing_questions_listingId_createdAt_idx"
  ON "listing_questions"("listingId", "createdAt");
CREATE INDEX IF NOT EXISTS "listing_questions_askerId_idx"
  ON "listing_questions"("askerId");

DO $$ BEGIN
  ALTER TABLE "listing_questions"
    ADD CONSTRAINT "listing_questions_listingId_fkey"
    FOREIGN KEY ("listingId") REFERENCES "listings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "listing_questions"
    ADD CONSTRAINT "listing_questions_askerId_fkey"
    FOREIGN KEY ("askerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "listing_questions"
    ADD CONSTRAINT "listing_questions_answeredById_fkey"
    FOREIGN KEY ("answeredById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- RLS: public read of reviews / questions; write via service role.
GRANT SELECT ON TABLE reviews TO elloot_app;
GRANT SELECT, INSERT ON TABLE listing_questions TO elloot_app;
GRANT UPDATE (answer, "answeredAt", "answeredById", moderated) ON TABLE listing_questions TO elloot_app;

ALTER TABLE reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE reviews FORCE ROW LEVEL SECURITY;
ALTER TABLE listing_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE listing_questions FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS reviews_select ON reviews;
CREATE POLICY reviews_select ON reviews FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM listings l
      WHERE l.id = reviews."listingId"
        AND (
          l.status = 'ACTIVE'
          OR l."sellerId" = NULLIF(current_setting('app.user_id', true), '')
          OR current_setting('app.role', true) = 'ADMIN'
          OR current_setting('app.role', true) = 'SERVICE'
        )
    )
  );

DROP POLICY IF EXISTS listing_questions_select ON listing_questions;
CREATE POLICY listing_questions_select ON listing_questions FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM listings l
      WHERE l.id = listing_questions."listingId"
        AND (
          l.status = 'ACTIVE'
          OR l."sellerId" = NULLIF(current_setting('app.user_id', true), '')
          OR current_setting('app.role', true) = 'ADMIN'
          OR current_setting('app.role', true) = 'SERVICE'
        )
    )
  );

DROP POLICY IF EXISTS listing_questions_insert ON listing_questions;
CREATE POLICY listing_questions_insert ON listing_questions FOR INSERT
  WITH CHECK (
    "askerId" = NULLIF(current_setting('app.user_id', true), '')
    AND EXISTS (
      SELECT 1 FROM listings l
      WHERE l.id = listing_questions."listingId" AND l.status = 'ACTIVE'
    )
  );

DROP POLICY IF EXISTS listing_questions_update ON listing_questions;
CREATE POLICY listing_questions_update ON listing_questions FOR UPDATE
  USING (
    current_setting('app.role', true) IN ('ADMIN', 'SERVICE')
    OR EXISTS (
      SELECT 1 FROM listings l
      WHERE l.id = listing_questions."listingId"
        AND l."sellerId" = NULLIF(current_setting('app.user_id', true), '')
    )
  );
