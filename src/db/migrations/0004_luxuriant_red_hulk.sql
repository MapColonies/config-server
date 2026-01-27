-- Add hash column as nullable first
ALTER TABLE "config_server"."config"
ADD COLUMN "hash" text;

-- Backfill with a temporary placeholder hash (will be recalculated on first update)
UPDATE "config_server"."config"
SET
  "hash" = 'pending-recalculation';

-- Make the column NOT NULL
ALTER TABLE "config_server"."config"
ALTER COLUMN "hash"
SET NOT NULL;
