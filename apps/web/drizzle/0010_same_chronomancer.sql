CREATE TYPE "public"."entitlement_source" AS ENUM('purchase', 'grant', 'pass');--> statement-breakpoint
CREATE TABLE "entitlements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"sku" text NOT NULL,
	"source" "entitlement_source" NOT NULL,
	"platform" text,
	"store_txn_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "entitlements_store_txn_id_unique" UNIQUE("store_txn_id")
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "equipped" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "entitlements" ADD CONSTRAINT "entitlements_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "entitlements_user_idx" ON "entitlements" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "entitlements_user_sku_active" ON "entitlements" USING btree ("user_id","sku") WHERE "entitlements"."revoked_at" is null;