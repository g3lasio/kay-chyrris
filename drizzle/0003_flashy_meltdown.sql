-- Partner docs: report category + admin title. Additive, IDEMPOTENT.
-- Also mirrored by server/partner/ensure-tables.ts (Kai deploy runs
-- `pnpm start`, not `drizzle-kit migrate`).
ALTER TYPE "public"."partner_doc_type" ADD VALUE IF NOT EXISTS 'report';--> statement-breakpoint
ALTER TABLE "partner_documents" ADD COLUMN IF NOT EXISTS "title" varchar(255);
