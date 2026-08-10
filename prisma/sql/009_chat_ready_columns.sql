-- Chat-ready columns (realtime UI later): conversation previews + message clientId/readAt.

ALTER TABLE "conversations"
  ADD COLUMN IF NOT EXISTS "lastMessageAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "lastMessagePreview" TEXT;

CREATE INDEX IF NOT EXISTS "conversations_lastMessageAt_idx"
  ON "conversations"("lastMessageAt");

ALTER TABLE "messages"
  ADD COLUMN IF NOT EXISTS "clientId" TEXT,
  ADD COLUMN IF NOT EXISTS "readAt" TIMESTAMP(3);

-- Unique (conversationId, clientId) only when clientId is present.
CREATE UNIQUE INDEX IF NOT EXISTS "messages_conversationId_clientId_key"
  ON "messages"("conversationId", "clientId")
  WHERE "clientId" IS NOT NULL;
