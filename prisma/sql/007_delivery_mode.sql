-- Delivery mode for listings and offers (manual chat vs automatic codes/keys).
DO $$ BEGIN
  CREATE TYPE "DeliveryMode" AS ENUM ('MANUAL', 'AUTO');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "listings"
  ADD COLUMN IF NOT EXISTS "deliveryMode" "DeliveryMode" NOT NULL DEFAULT 'MANUAL';

ALTER TABLE "listing_offers"
  ADD COLUMN IF NOT EXISTS "deliveryMode" "DeliveryMode" NOT NULL DEFAULT 'MANUAL';
