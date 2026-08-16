-- Allow sellers to update/supersede their own PENDING moderation queue rows.

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
