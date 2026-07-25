-- Partner Referral Portal — additive, IDEMPOTENT migration.
--
-- Written idempotent (guarded CREATEs) on purpose: the app also creates these
-- objects at boot via server/partner/ensure-tables.ts (Kai's deploy runs
-- `pnpm start`, not `drizzle-kit migrate`). Guards let `pnpm db:push` run
-- safely against a database that already booted the new code, and vice versa,
-- without "type/relation already exists" failures.
DO $$ BEGIN CREATE TYPE "public"."attribution_status" AS ENUM('pending_first_payment', 'active', 'inactive'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN CREATE TYPE "public"."commission_payout_status" AS ENUM('pending', 'paid'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN CREATE TYPE "public"."partner_doc_status" AS ENUM('pending', 'uploaded', 'verified'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN CREATE TYPE "public"."partner_doc_type" AS ENUM('contract', 'w9', 'ach_authorization', 'other'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN CREATE TYPE "public"."payout_status" AS ENUM('pending', 'paid'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN CREATE TYPE "public"."referral_partner_status" AS ENUM('invited', 'active', 'paused', 'inactive'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "partner_auth_codes" (
	"id" serial PRIMARY KEY NOT NULL,
	"partner_id" integer NOT NULL,
	"code" varchar(100) NOT NULL,
	"expires_at" timestamp NOT NULL,
	"used" boolean DEFAULT false NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "partner_documents" (
	"id" serial PRIMARY KEY NOT NULL,
	"partner_id" integer NOT NULL,
	"doc_type" "partner_doc_type" NOT NULL,
	"file_url" text,
	"file_name" varchar(255),
	"status" "partner_doc_status" DEFAULT 'pending' NOT NULL,
	"uploaded_at" timestamp,
	"verified_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "partner_sessions" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"partner_id" integer NOT NULL,
	"ip_address" varchar(45),
	"user_agent" text,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "referral_attributions" (
	"id" serial PRIMARY KEY NOT NULL,
	"partner_id" integer NOT NULL,
	"referred_user_id" varchar(100) NOT NULL,
	"referral_code" varchar(50) NOT NULL,
	"signup_date" timestamp NOT NULL,
	"first_payment_date" timestamp,
	"status" "attribution_status" DEFAULT 'pending_first_payment' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "referral_attributions_referred_user_id_unique" UNIQUE("referred_user_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "referral_commissions" (
	"id" serial PRIMARY KEY NOT NULL,
	"partner_id" integer NOT NULL,
	"attribution_id" integer NOT NULL,
	"source_payment_id" varchar(255) NOT NULL,
	"charge_amount" numeric(10, 2) NOT NULL,
	"applied_pct" numeric(5, 2) NOT NULL,
	"commission_amount" numeric(10, 2) NOT NULL,
	"charge_date" timestamp NOT NULL,
	"is_reversal" boolean DEFAULT false NOT NULL,
	"payout_status" "commission_payout_status" DEFAULT 'pending' NOT NULL,
	"payout_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "referral_partners" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(255) NOT NULL,
	"referral_code" varchar(50) NOT NULL,
	"contact_name" varchar(255),
	"contact_email" varchar(255) NOT NULL,
	"contact_phone" varchar(50),
	"status" "referral_partner_status" DEFAULT 'invited' NOT NULL,
	"tier_year1_pct" numeric(5, 2) DEFAULT '20.00' NOT NULL,
	"tier_year2_pct" numeric(5, 2) DEFAULT '10.00' NOT NULL,
	"free_account_threshold" integer DEFAULT 10 NOT NULL,
	"onboarding_complete" boolean DEFAULT false NOT NULL,
	"contact_confirmed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "referral_partners_referral_code_unique" UNIQUE("referral_code"),
	CONSTRAINT "referral_partners_contact_email_unique" UNIQUE("contact_email")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "referral_payouts" (
	"id" serial PRIMARY KEY NOT NULL,
	"partner_id" integer NOT NULL,
	"period_start" timestamp NOT NULL,
	"period_end" timestamp NOT NULL,
	"total_amount" numeric(10, 2) NOT NULL,
	"status" "payout_status" DEFAULT 'pending' NOT NULL,
	"paid_at" timestamp,
	"method" varchar(100),
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "partner_auth_codes" ADD CONSTRAINT "partner_auth_codes_partner_id_referral_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."referral_partners"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "partner_documents" ADD CONSTRAINT "partner_documents_partner_id_referral_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."referral_partners"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "partner_sessions" ADD CONSTRAINT "partner_sessions_partner_id_referral_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."referral_partners"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "referral_attributions" ADD CONSTRAINT "referral_attributions_partner_id_referral_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."referral_partners"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "referral_commissions" ADD CONSTRAINT "referral_commissions_partner_id_referral_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."referral_partners"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "referral_commissions" ADD CONSTRAINT "referral_commissions_attribution_id_referral_attributions_id_fk" FOREIGN KEY ("attribution_id") REFERENCES "public"."referral_attributions"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "referral_commissions" ADD CONSTRAINT "referral_commissions_payout_id_referral_payouts_id_fk" FOREIGN KEY ("payout_id") REFERENCES "public"."referral_payouts"("id") ON DELETE set null ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "referral_payouts" ADD CONSTRAINT "referral_payouts_partner_id_referral_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."referral_partners"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_partner_auth_codes_partner" ON "partner_auth_codes" USING btree ("partner_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_partner_documents_partner" ON "partner_documents" USING btree ("partner_id","doc_type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_referral_attributions_partner" ON "referral_attributions" USING btree ("partner_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_referral_commissions_source" ON "referral_commissions" USING btree ("source_payment_id","is_reversal");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_referral_commissions_partner" ON "referral_commissions" USING btree ("partner_id","payout_status","charge_date");
