ALTER TABLE "config_server"."config_refs"
DROP CONSTRAINT "config_refs_original_config_fk";

--> statement-breakpoint
ALTER TABLE "config_server"."config_refs"
DROP CONSTRAINT "config_refs_child_config_fk";

--> statement-breakpoint
ALTER TABLE "config_server"."config"
DROP CONSTRAINT "config_name_version_pk";

--> statement-breakpoint
ALTER TABLE "config_server"."config_refs"
ADD COLUMN "schema_id" text;

--> statement-breakpoint
ALTER TABLE "config_server"."config_refs"
ADD COLUMN "ref_schema_id" text;

--> statement-breakpoint
UPDATE "config_server"."config_refs"
SET
  "schema_id" = (
    SELECT
      c."schema_id"
    FROM
      "config_server"."config" c
    WHERE
      c."name" = "config_refs"."name"
    LIMIT
      1
  );

--> statement-breakpoint
UPDATE "config_server"."config_refs"
SET
  "ref_schema_id" = (
    SELECT
      c."schema_id"
    FROM
      "config_server"."config" c
    WHERE
      c."name" = "config_refs"."ref_name"
    LIMIT
      1
  );

--> statement-breakpoint
ALTER TABLE "config_server"."config_refs"
ALTER COLUMN "schema_id"
SET NOT NULL;

--> statement-breakpoint
ALTER TABLE "config_server"."config_refs"
ALTER COLUMN "ref_schema_id"
SET NOT NULL;

--> statement-breakpoint
ALTER TABLE "config_server"."config"
ADD CONSTRAINT "config_name_schema_id_version_pk" PRIMARY KEY ("name", "schema_id", "version");

--> statement-breakpoint
ALTER TABLE "config_server"."config_refs"
ADD CONSTRAINT "config_refs_original_config_fk" FOREIGN KEY ("name", "schema_id", "version") REFERENCES "config_server"."config" ("name", "schema_id", "version") ON DELETE no action ON UPDATE no action;

--> statement-breakpoint
ALTER TABLE "config_server"."config_refs"
ADD CONSTRAINT "config_refs_child_config_fk" FOREIGN KEY ("ref_name", "ref_schema_id", "ref_version") REFERENCES "config_server"."config" ("name", "schema_id", "version") ON DELETE no action ON UPDATE no action;

ALTER TABLE "config_server"."config"
ADD COLUMN "config_schema_version" text DEFAULT 'v2';

--> statement-breakpoint
UPDATE "config_server"."config"
SET
  "config_schema_version" = 'v1';

--> statement-breakpoint
ALTER TABLE "config_server"."config"
ALTER COLUMN "config_schema_version"
SET NOT NULL;

--> statement-breakpoint
