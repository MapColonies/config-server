CREATE TABLE IF NOT EXISTS "config_server"."config_refs" (
	"name" text NOT NULL,
	"version" integer NOT NULL,
	"ref_name" text NOT NULL,
	"ref_version" integer
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_config_name_version" ON "config_server"."config_refs" ("name","version");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "config_server"."config_refs" ADD CONSTRAINT "config_refs_original_config_fk" FOREIGN KEY ("name","version") REFERENCES "config_server"."config"("name","version") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "config_server"."config_refs" ADD CONSTRAINT "config_refs_child_config_fk" FOREIGN KEY ("ref_name","ref_version") REFERENCES "config_server"."config"("name","version") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
