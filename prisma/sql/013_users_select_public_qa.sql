-- Allow public read of marketplace identities used on listing Q&A and reviews.
-- Without this, Prisma required relations (asker / buyer) return null under RLS
-- and GET /api/questions|reviews/by-listing fails with "Field X is required... got null".

DROP POLICY IF EXISTS users_select ON users;
CREATE POLICY users_select ON users FOR SELECT
  USING (
    id = app_current_user_id()
    OR app_is_admin()
    OR app_is_service()
    OR EXISTS (
      SELECT 1 FROM listings l
      WHERE l."sellerId" = users.id AND l.status = 'ACTIVE'
    )
    OR EXISTS (
      SELECT 1 FROM orders o
      WHERE (o."buyerId" = app_current_user_id() OR o."sellerId" = app_current_user_id())
        AND (o."buyerId" = users.id OR o."sellerId" = users.id)
    )
    OR EXISTS (
      SELECT 1
      FROM listing_questions q
      JOIN listings l ON l.id = q."listingId"
      WHERE q."askerId" = users.id
        AND q.moderated = false
        AND (
          l.status = 'ACTIVE'
          OR l."sellerId" = app_current_user_id()
          OR q."askerId" = app_current_user_id()
          OR app_is_admin()
          OR app_is_service()
        )
    )
    OR EXISTS (
      SELECT 1
      FROM reviews r
      JOIN listings l ON l.id = r."listingId"
      WHERE r."buyerId" = users.id
        AND (
          l.status = 'ACTIVE'
          OR l."sellerId" = app_current_user_id()
          OR r."buyerId" = app_current_user_id()
          OR app_is_admin()
          OR app_is_service()
        )
    )
  );
