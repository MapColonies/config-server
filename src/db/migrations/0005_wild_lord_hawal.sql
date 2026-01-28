CREATE TABLE "config_server"."locks" (
  "key" text NOT NULL,
  "caller_id" text NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "expires_at" timestamp NOT NULL,
  "limit" integer NOT NULL,
  CONSTRAINT "locks_key_caller_id_pk" PRIMARY KEY ("key", "caller_id")
);
