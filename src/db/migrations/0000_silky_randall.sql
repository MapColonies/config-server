CREATE TABLE IF NOT EXISTS "config" (
	"name" text PRIMARY KEY NOT NULL,
	"schema_id" text NOT NULL,
	"version" text NOT NULL,
	"config" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"textsearchable_index_col" tsvector GENERATED ALWAYS AS (to_tsvector('english', name || ' ' || schema_id || ' ' || version) || jsonb_to_tsvector('english', config, '"all"') ) STORED
);

CREATE INDEX textsearch_idx ON config USING GIN (textsearchable_index_col);
