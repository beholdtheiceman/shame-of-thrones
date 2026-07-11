CREATE TYPE "public"."house_id" AS ENUM('flush', 'bidet', 'plunger', 'porcelain');--> statement-breakpoint
CREATE TYPE "public"."influence_reason" AS ENUM('rating', 'first_of_name', 'new_throne', 'confirmation', 'hearsay');--> statement-breakpoint
CREATE TYPE "public"."throne_category" AS ENUM('cafe', 'restaurant', 'park', 'transit', 'library', 'retail', 'municipal', 'gas_station', 'other');--> statement-breakpoint
CREATE TYPE "public"."throne_status" AS ENUM('rumored', 'verified');--> statement-breakpoint
CREATE TABLE "influence_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"fief_id" text NOT NULL,
	"house_id" "house_id" NOT NULL,
	"user_id" uuid NOT NULL,
	"points" integer NOT NULL,
	"reason" "influence_reason" NOT NULL,
	"throne_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ledger_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"text" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ratings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"throne_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"verdict" integer NOT NULL,
	"tags" text[] DEFAULT '{}' NOT NULL,
	"verified" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "thrones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"lat" double precision NOT NULL,
	"lng" double precision NOT NULL,
	"category" "throne_category" NOT NULL,
	"status" "throne_status" DEFAULT 'rumored' NOT NULL,
	"amenities" jsonb NOT NULL,
	"added_by" uuid NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_confirmed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"google_subject" text NOT NULL,
	"display_name" text NOT NULL,
	"house_id" "house_id" NOT NULL,
	"badges" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_house_switch_at" timestamp with time zone,
	CONSTRAINT "users_google_subject_unique" UNIQUE("google_subject"),
	CONSTRAINT "users_display_name_unique" UNIQUE("display_name")
);
--> statement-breakpoint
ALTER TABLE "influence_events" ADD CONSTRAINT "influence_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "influence_events" ADD CONSTRAINT "influence_events_throne_id_thrones_id_fk" FOREIGN KEY ("throne_id") REFERENCES "public"."thrones"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ratings" ADD CONSTRAINT "ratings_throne_id_thrones_id_fk" FOREIGN KEY ("throne_id") REFERENCES "public"."thrones"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ratings" ADD CONSTRAINT "ratings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thrones" ADD CONSTRAINT "thrones_added_by_users_id_fk" FOREIGN KEY ("added_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "influence_fief_idx" ON "influence_events" USING btree ("fief_id");--> statement-breakpoint
CREATE INDEX "influence_user_idx" ON "influence_events" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "ratings_throne_idx" ON "ratings" USING btree ("throne_id");--> statement-breakpoint
CREATE INDEX "ratings_user_idx" ON "ratings" USING btree ("user_id");