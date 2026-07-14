CREATE TYPE "public"."photo_status" AS ENUM('pending', 'approved', 'rejected');--> statement-breakpoint
ALTER TYPE "public"."report_subject" ADD VALUE 'photo';--> statement-breakpoint
ALTER TYPE "public"."review_kind" ADD VALUE 'photo';--> statement-breakpoint
CREATE TABLE "photos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"throne_id" uuid NOT NULL,
	"uploaded_by" uuid NOT NULL,
	"bytes" "bytea" NOT NULL,
	"content_type" text NOT NULL,
	"status" "photo_status" DEFAULT 'pending' NOT NULL,
	"ai_verdict" jsonb,
	"rejected_reason" text,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "photos" ADD CONSTRAINT "photos_throne_id_thrones_id_fk" FOREIGN KEY ("throne_id") REFERENCES "public"."thrones"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "photos" ADD CONSTRAINT "photos_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "photos" ADD CONSTRAINT "photos_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "photos_throne_status_idx" ON "photos" USING btree ("throne_id","status");