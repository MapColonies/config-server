CREATE TABLE IF NOT EXISTS "config" (
	"name" text NOT NULL,
	"schema_id" text NOT NULL,
	"version" integer NOT NULL,
	"config" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"created_by" text NOT NULL,
	CONSTRAINT "config_name_version_pk" PRIMARY KEY("name","version"),
	"textsearchable_index_col" tsvector GENERATED ALWAYS AS (to_tsvector('english', name || ' ' || schema_id || ' ' || version::text || ' ' || created_by ) || jsonb_to_tsvector('english', config, '"all"') ) STORED
);

CREATE INDEX textsearch_idx ON config USING GIN (textsearchable_index_col);
