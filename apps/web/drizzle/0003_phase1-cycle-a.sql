CREATE TYPE "public"."report_reason" AS ENUM('wrong_info', 'closed', 'inappropriate', 'not_public_restroom', 'harassment', 'spam');--> statement-breakpoint
CREATE TYPE "public"."report_subject" AS ENUM('throne', 'rating');--> statement-breakpoint
ALTER TYPE "public"."influence_reason" ADD VALUE 'reversal';--> statement-breakpoint
ALTER TYPE "public"."review_kind" ADD VALUE 'report';--> statement-breakpoint
ALTER TYPE "public"."review_kind" ADD VALUE 'testimony';--> statement-breakpoint
CREATE TABLE "reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reporter_id" uuid NOT NULL,
	"subject_kind" "report_subject" NOT NULL,
	"subject_id" uuid NOT NULL,
	"reason" "report_reason" NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ratings" ADD COLUMN "testimony" text;--> statement-breakpoint
ALTER TABLE "ratings" ADD COLUMN "hidden_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ratings" ADD COLUMN "hidden_by" uuid;--> statement-breakpoint
ALTER TABLE "ratings" ADD COLUMN "testimony_hidden_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ratings" ADD COLUMN "testimony_hidden_by" uuid;--> statement-breakpoint
ALTER TABLE "thrones" ADD COLUMN "hidden_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "thrones" ADD COLUMN "hidden_by" uuid;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "suspended_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "banned_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_reporter_id_users_id_fk" FOREIGN KEY ("reporter_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "reports_reporter_subject_idx" ON "reports" USING btree ("reporter_id","subject_kind","subject_id");--> statement-breakpoint
CREATE INDEX "reports_subject_idx" ON "reports" USING btree ("subject_kind","subject_id");--> statement-breakpoint
ALTER TABLE "ratings" ADD CONSTRAINT "ratings_hidden_by_users_id_fk" FOREIGN KEY ("hidden_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ratings" ADD CONSTRAINT "ratings_testimony_hidden_by_users_id_fk" FOREIGN KEY ("testimony_hidden_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thrones" ADD CONSTRAINT "thrones_hidden_by_users_id_fk" FOREIGN KEY ("hidden_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;