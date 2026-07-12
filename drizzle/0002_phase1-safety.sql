CREATE TYPE "public"."review_kind" AS ENUM('rating', 'new_throne', 'confirmation');--> statement-breakpoint
CREATE TYPE "public"."review_severity" AS ENUM('low', 'medium', 'high');--> statement-breakpoint
CREATE TYPE "public"."review_status" AS ENUM('pending', 'resolved');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('user', 'moderator');--> statement-breakpoint
CREATE TABLE "age_attestations" (
	"google_subject" text PRIMARY KEY NOT NULL,
	"over13_confirmed_at" timestamp with time zone,
	"locked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "review_queue" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "review_kind" NOT NULL,
	"subject_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"signals" jsonb NOT NULL,
	"severity" "review_severity" NOT NULL,
	"ai_assessment" text,
	"ai_severity" "review_severity",
	"ai_triaged_at" timestamp with time zone,
	"ai_error" text,
	"status" "review_status" DEFAULT 'pending' NOT NULL,
	"resolved_by" uuid,
	"resolved_at" timestamp with time zone,
	"resolution_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "thrones" ADD COLUMN "public_access_attested" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "role" "user_role" DEFAULT 'user' NOT NULL;--> statement-breakpoint
ALTER TABLE "review_queue" ADD CONSTRAINT "review_queue_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_queue" ADD CONSTRAINT "review_queue_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "review_status_created_idx" ON "review_queue" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "review_user_idx" ON "review_queue" USING btree ("user_id");--> statement-breakpoint
UPDATE thrones SET public_access_attested = true;