-- Listing offers — Row Level Security
-- Run after prisma db push (table listing_offers must exist)

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE listing_offers TO elloot_app;

ALTER TABLE listing_offers ENABLE ROW LEVEL SECURITY;
ALTER TABLE listing_offers FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS listing_offers_select ON listing_offers;
CREATE POLICY listing_offers_select ON listing_offers FOR SELECT
  USING (
    app_is_service()
    OR app_is_admin()
    OR EXISTS (
      SELECT 1 FROM listings l
      WHERE l.id = "listingId"
        AND (
          l.status = 'ACTIVE'
          OR l."sellerId" = app_current_user_id()
          OR EXISTS (
            SELECT 1 FROM orders o
            WHERE o."listingId" = l.id
              AND (
                o."buyerId" = app_current_user_id()
                OR o."sellerId" = app_current_user_id()
              )
          )
        )
    )
  );

DROP POLICY IF EXISTS listing_offers_insert ON listing_offers;
CREATE POLICY listing_offers_insert ON listing_offers FOR INSERT
  WITH CHECK (
    app_is_service()
    OR app_is_admin()
    OR EXISTS (
      SELECT 1 FROM listings l
      WHERE l.id = "listingId"
        AND l."sellerId" = app_current_user_id()
    )
  );

DROP POLICY IF EXISTS listing_offers_update ON listing_offers;
CREATE POLICY listing_offers_update ON listing_offers FOR UPDATE
  USING (
    app_is_service()
    OR app_is_admin()
    OR EXISTS (
      SELECT 1 FROM listings l
      WHERE l.id = "listingId"
        AND l."sellerId" = app_current_user_id()
    )
  )
  WITH CHECK (
    app_is_service()
    OR app_is_admin()
    OR EXISTS (
      SELECT 1 FROM listings l
      WHERE l.id = "listingId"
        AND l."sellerId" = app_current_user_id()
    )
  );

DROP POLICY IF EXISTS listing_offers_delete ON listing_offers;
CREATE POLICY listing_offers_delete ON listing_offers FOR DELETE
  USING (
    app_is_service()
    OR app_is_admin()
    OR EXISTS (
      SELECT 1 FROM listings l
      WHERE l.id = "listingId"
        AND l."sellerId" = app_current_user_id()
    )
  );
