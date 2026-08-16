-- Listing funnel events: views + purchase intent (cart / checkout start).

DO $$ BEGIN
  CREATE TYPE "ListingEventType" AS ENUM ('VIEW', 'PURCHASE_INTENT');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS listing_events (
  id TEXT PRIMARY KEY,
  "listingId" TEXT NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  "sellerId" TEXT NOT NULL,
  type "ListingEventType" NOT NULL,
  "viewerUserId" TEXT REFERENCES users(id) ON DELETE SET NULL,
  "visitorKey" TEXT NOT NULL,
  "amountCents" INTEGER,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS listing_events_seller_type_created_idx
  ON listing_events ("sellerId", type, "createdAt");

CREATE INDEX IF NOT EXISTS listing_events_listing_type_created_idx
  ON listing_events ("listingId", type, "createdAt");

CREATE INDEX IF NOT EXISTS listing_events_listing_visitor_type_created_idx
  ON listing_events ("listingId", "visitorKey", type, "createdAt");

ALTER TABLE listing_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS listing_events_select ON listing_events;
CREATE POLICY listing_events_select ON listing_events FOR SELECT
  USING (
    app_is_admin()
    OR app_is_service()
    OR "sellerId" = app_current_user_id()
  );

-- Inserts go through service transactions (anonymous views allowed).
DROP POLICY IF EXISTS listing_events_insert ON listing_events;
CREATE POLICY listing_events_insert ON listing_events FOR INSERT
  WITH CHECK (app_is_service() OR app_is_admin());

DROP POLICY IF EXISTS listing_events_update ON listing_events;
CREATE POLICY listing_events_update ON listing_events FOR UPDATE
  USING (app_is_service() OR app_is_admin())
  WITH CHECK (app_is_service() OR app_is_admin());

DROP POLICY IF EXISTS listing_events_delete ON listing_events;
CREATE POLICY listing_events_delete ON listing_events FOR DELETE
  USING (app_is_service() OR app_is_admin());
