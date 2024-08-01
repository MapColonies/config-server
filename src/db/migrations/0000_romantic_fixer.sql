CREATE SCHEMA IF NOT EXISTS "config_server";

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "config_server"."config" (
  "name" text NOT NULL COLLATE "C",
  "schema_id" text NOT NULL COLLATE "C",
  "version" integer NOT NULL,
  "config" jsonb NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "created_by" text NOT NULL COLLATE "C",
  CONSTRAINT "config_name_version_pk" PRIMARY KEY ("name", "version"),
  "textsearchable_index_col" tsvector GENERATED ALWAYS AS (
    to_tsvector(
      'english',
      name || ' ' || schema_id || ' ' || VERSION::text || ' ' || created_by
    ) || jsonb_to_tsvector('english', config, '"all"')
  ) STORED
);

CREATE INDEX textsearch_idx ON "config_server"."config" USING GIN (textsearchable_index_col);
