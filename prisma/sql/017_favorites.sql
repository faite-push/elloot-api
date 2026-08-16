-- Favorites synced to account (replaces local-only storage for logged users).

CREATE TABLE IF NOT EXISTS favorites (
  id TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  "listingId" TEXT NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS favorites_user_listing_uidx
  ON favorites ("userId", "listingId");

CREATE INDEX IF NOT EXISTS favorites_user_created_idx
  ON favorites ("userId", "createdAt");

ALTER TABLE favorites ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS favorites_select ON favorites;
CREATE POLICY favorites_select ON favorites FOR SELECT
  USING (
    "userId" = app_current_user_id()
    OR app_is_admin()
    OR app_is_service()
  );

DROP POLICY IF EXISTS favorites_insert ON favorites;
CREATE POLICY favorites_insert ON favorites FOR INSERT
  WITH CHECK (
    "userId" = app_current_user_id()
    OR app_is_service()
  );

DROP POLICY IF EXISTS favorites_delete ON favorites;
CREATE POLICY favorites_delete ON favorites FOR DELETE
  USING (
    "userId" = app_current_user_id()
    OR app_is_admin()
    OR app_is_service()
  );

DROP POLICY IF EXISTS favorites_update ON favorites;
CREATE POLICY favorites_update ON favorites FOR UPDATE
  USING (app_is_service() OR app_is_admin())
  WITH CHECK (app_is_service() OR app_is_admin());
