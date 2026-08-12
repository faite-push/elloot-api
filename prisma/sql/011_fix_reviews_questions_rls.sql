-- Fix reviews / listing_questions RLS to use app.user_role + app_is_service()
-- (008 incorrectly used current_setting('app.role'), which the runtime never sets).
-- Also enable RLS on notifications.

DROP POLICY IF EXISTS reviews_select ON reviews;
CREATE POLICY reviews_select ON reviews FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM listings l
      WHERE l.id = reviews."listingId"
        AND (
          l.status = 'ACTIVE'
          OR l."sellerId" = app_current_user_id()
          OR app_is_admin()
          OR app_is_service()
        )
    )
  );

-- Inserts go through service tx today; keep policy for defense-in-depth.
DROP POLICY IF EXISTS reviews_insert ON reviews;
CREATE POLICY reviews_insert ON reviews FOR INSERT
  WITH CHECK (
    app_is_service()
    OR (
      "buyerId" = app_current_user_id()
      AND EXISTS (
        SELECT 1 FROM orders o
        WHERE o.id = reviews."orderId"
          AND o."buyerId" = app_current_user_id()
          AND o.status = 'COMPLETED'
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
          OR l."sellerId" = app_current_user_id()
          OR listing_questions."askerId" = app_current_user_id()
          OR app_is_admin()
          OR app_is_service()
        )
    )
  );

DROP POLICY IF EXISTS listing_questions_insert ON listing_questions;
CREATE POLICY listing_questions_insert ON listing_questions FOR INSERT
  WITH CHECK (
    (
      "askerId" = app_current_user_id()
      OR app_is_service()
    )
    AND EXISTS (
      SELECT 1 FROM listings l
      WHERE l.id = listing_questions."listingId" AND l.status = 'ACTIVE'
    )
  );

DROP POLICY IF EXISTS listing_questions_update ON listing_questions;
CREATE POLICY listing_questions_update ON listing_questions FOR UPDATE
  USING (
    app_is_admin()
    OR app_is_service()
    OR EXISTS (
      SELECT 1 FROM listings l
      WHERE l.id = listing_questions."listingId"
        AND l."sellerId" = app_current_user_id()
    )
  )
  WITH CHECK (
    app_is_admin()
    OR app_is_service()
    OR EXISTS (
      SELECT 1 FROM listings l
      WHERE l.id = listing_questions."listingId"
        AND l."sellerId" = app_current_user_id()
    )
  );

-- Notifications RLS
ALTER TABLE IF EXISTS notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS notifications FORCE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE ON TABLE notifications TO elloot_app;

DROP POLICY IF EXISTS notifications_select ON notifications;
CREATE POLICY notifications_select ON notifications FOR SELECT
  USING (
    "userId" = app_current_user_id()
    OR app_is_admin()
    OR app_is_service()
  );

DROP POLICY IF EXISTS notifications_insert ON notifications;
CREATE POLICY notifications_insert ON notifications FOR INSERT
  WITH CHECK (app_is_service() OR app_is_admin());

DROP POLICY IF EXISTS notifications_update ON notifications;
CREATE POLICY notifications_update ON notifications FOR UPDATE
  USING (
    "userId" = app_current_user_id()
    OR app_is_admin()
    OR app_is_service()
  )
  WITH CHECK (
    "userId" = app_current_user_id()
    OR app_is_admin()
    OR app_is_service()
  );
