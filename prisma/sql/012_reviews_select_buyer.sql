-- Buyers must read their own reviews even if the listing is no longer ACTIVE.
DROP POLICY IF EXISTS reviews_select ON reviews;
CREATE POLICY reviews_select ON reviews FOR SELECT
  USING (
    "buyerId" = app_current_user_id()
    OR "sellerId" = app_current_user_id()
    OR app_is_admin()
    OR app_is_service()
    OR EXISTS (
      SELECT 1 FROM listings l
      WHERE l.id = reviews."listingId"
        AND l.status = 'ACTIVE'
    )
  );
