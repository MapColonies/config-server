ALTER TABLE "config_server"."config"
ADD COLUMN "is_latest" boolean;

UPDATE "config_server"."config"
SET
  "is_latest" = CASE
    WHEN "version" = (
      SELECT
        max(VERSION)
      FROM
        "config_server"."config" AS sub
      WHERE
        sub.name = "config"."name"
    ) THEN TRUE
    ELSE FALSE
  END;

ALTER TABLE "config_server"."config"
ALTER COLUMN "is_latest"
SET NOT NULL;
