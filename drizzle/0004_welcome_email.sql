-- Partner onboarding welcome email: once-ever send lock. Additive, IDEMPOTENT.
-- Also mirrored by server/partner/ensure-tables.ts (Kai deploy runs
-- `pnpm start`, not `drizzle-kit migrate`).
ALTER TABLE "referral_partners" ADD COLUMN IF NOT EXISTS "welcome_email_sent_at" timestamp;
