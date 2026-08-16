-- Notification preferences + Web Push subscriptions.

CREATE TABLE IF NOT EXISTS "notification_preferences" (
  "id" TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "inApp" BOOLEAN NOT NULL DEFAULT TRUE,
  "push" BOOLEAN NOT NULL DEFAULT TRUE,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "notification_preferences_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "notification_preferences_userId_category_key"
  ON "notification_preferences"("userId", "category");

CREATE INDEX IF NOT EXISTS "notification_preferences_userId_idx"
  ON "notification_preferences"("userId");

CREATE TABLE IF NOT EXISTS "push_subscriptions" (
  "id" TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "endpoint" TEXT NOT NULL,
  "p256dh" TEXT NOT NULL,
  "auth" TEXT NOT NULL,
  "userAgent" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "push_subscriptions_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "push_subscriptions_endpoint_key"
  ON "push_subscriptions"("endpoint");

CREATE INDEX IF NOT EXISTS "push_subscriptions_userId_idx"
  ON "push_subscriptions"("userId");

ALTER TABLE "notification_preferences" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "notification_preferences" FORCE ROW LEVEL SECURITY;
ALTER TABLE "push_subscriptions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "push_subscriptions" FORCE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "notification_preferences" TO elloot_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "push_subscriptions" TO elloot_app;

DROP POLICY IF EXISTS notification_preferences_select ON "notification_preferences";
CREATE POLICY notification_preferences_select ON "notification_preferences" FOR SELECT
  USING (
    "userId" = app_current_user_id()
    OR app_is_admin()
    OR app_is_service()
  );

DROP POLICY IF EXISTS notification_preferences_insert ON "notification_preferences";
CREATE POLICY notification_preferences_insert ON "notification_preferences" FOR INSERT
  WITH CHECK (
    "userId" = app_current_user_id()
    OR app_is_service()
    OR app_is_admin()
  );

DROP POLICY IF EXISTS notification_preferences_update ON "notification_preferences";
CREATE POLICY notification_preferences_update ON "notification_preferences" FOR UPDATE
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

DROP POLICY IF EXISTS notification_preferences_delete ON "notification_preferences";
CREATE POLICY notification_preferences_delete ON "notification_preferences" FOR DELETE
  USING (
    "userId" = app_current_user_id()
    OR app_is_admin()
    OR app_is_service()
  );

DROP POLICY IF EXISTS push_subscriptions_select ON "push_subscriptions";
CREATE POLICY push_subscriptions_select ON "push_subscriptions" FOR SELECT
  USING (
    "userId" = app_current_user_id()
    OR app_is_admin()
    OR app_is_service()
  );

DROP POLICY IF EXISTS push_subscriptions_insert ON "push_subscriptions";
CREATE POLICY push_subscriptions_insert ON "push_subscriptions" FOR INSERT
  WITH CHECK (
    "userId" = app_current_user_id()
    OR app_is_service()
    OR app_is_admin()
  );

DROP POLICY IF EXISTS push_subscriptions_update ON "push_subscriptions";
CREATE POLICY push_subscriptions_update ON "push_subscriptions" FOR UPDATE
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

DROP POLICY IF EXISTS push_subscriptions_delete ON "push_subscriptions";
CREATE POLICY push_subscriptions_delete ON "push_subscriptions" FOR DELETE
  USING (
    "userId" = app_current_user_id()
    OR app_is_admin()
    OR app_is_service()
  );
