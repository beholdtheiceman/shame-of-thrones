ALTER TABLE "thrones" ADD COLUMN "source" text;--> statement-breakpoint
ALTER TABLE "thrones" ADD COLUMN "source_id" text;--> statement-breakpoint
CREATE UNIQUE INDEX "thrones_source_unique" ON "thrones" USING btree ("source","source_id") WHERE "thrones"."source" is not null;