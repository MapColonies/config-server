ALTER TABLE "config_server"."config" ADD COLUMN "is_latest" boolean;

UPDATE "config_server"."config" 
SET "is_latest" = CASE 
    WHEN "version" = (select max(version) from "config_server"."config" as sub where sub.name = "config"."name") THEN true
    ELSE false
END;

ALTER TABLE "config_server"."config" ALTER COLUMN "is_latest" SET NOT NULL;


