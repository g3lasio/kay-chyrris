-- Partner Portal enhancements — additive, IDEMPOTENT migration.
-- Also mirrored by server/partner/ensure-tables.ts (Kai's deploy runs
-- `pnpm start`, not `drizzle-kit migrate`). Guards let both paths coexist.
DO $$ BEGIN CREATE TYPE "public"."partner_invitation_status" AS ENUM('pending_approval', 'sent', 'registered', 'active', 'declined'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
ALTER TYPE "public"."partner_doc_type" ADD VALUE IF NOT EXISTS 'revenue_projection';--> statement-breakpoint
ALTER TYPE "public"."partner_doc_type" ADD VALUE IF NOT EXISTS 'features';--> statement-breakpoint
ALTER TYPE "public"."partner_doc_type" ADD VALUE IF NOT EXISTS 'term_sheet_info';--> statement-breakpoint
ALTER TYPE "public"."partner_doc_type" ADD VALUE IF NOT EXISTS 'term_sheet_signed';--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "app_settings" (
	"key" varchar(100) PRIMARY KEY NOT NULL,
	"value" text,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "partner_invitations" (
	"id" serial PRIMARY KEY NOT NULL,
	"partner_id" integer NOT NULL,
	"email" varchar(255) NOT NULL,
	"token" varchar(64) NOT NULL,
	"status" "partner_invitation_status" DEFAULT 'sent' NOT NULL,
	"registered_user_id" varchar(100),
	"sent_at" timestamp,
	"registered_at" timestamp,
	"activated_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "partner_invitations_token_unique" UNIQUE("token")
);
--> statement-breakpoint
ALTER TABLE "partner_documents" ADD COLUMN IF NOT EXISTS "uploaded_by" varchar(20) DEFAULT 'partner' NOT NULL;--> statement-breakpoint
ALTER TABLE "referral_partners" ADD COLUMN IF NOT EXISTS "materials_reviewed_at" timestamp;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "partner_invitations" ADD CONSTRAINT "partner_invitations_partner_id_referral_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."referral_partners"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_partner_invitations_partner" ON "partner_invitations" USING btree ("partner_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_partner_invitations_email" ON "partner_invitations" USING btree ("email");
