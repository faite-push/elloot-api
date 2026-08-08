-- Buyers/sellers must still read listings (and media) tied to their orders
-- after status leaves ACTIVE (e.g. SOLD on confirm).
BEGIN;

DROP POLICY IF EXISTS listings_select ON listings;
CREATE POLICY listings_select ON listings FOR SELECT
  USING (
    status = 'ACTIVE'
    OR "sellerId" = app_current_user_id()
    OR app_is_admin()
    OR app_is_service()
    OR EXISTS (
      SELECT 1 FROM orders o
      WHERE o."listingId" = listings.id
        AND (
          o."buyerId" = app_current_user_id()
          OR o."sellerId" = app_current_user_id()
        )
    )
  );

DROP POLICY IF EXISTS listing_media_select ON listing_media;
CREATE POLICY listing_media_select ON listing_media FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM listings l
      WHERE l.id = "listingId"
        AND (
          l.status = 'ACTIVE'
          OR l."sellerId" = app_current_user_id()
          OR app_is_admin()
          OR app_is_service()
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

COMMIT;
