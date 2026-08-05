-- Partner Referral Portal — LeadPrime DB migration (ADDITIVE, non-destructive)
--
-- Adds the nullable referral_code column to the existing LeadPrime signup
-- table (contractors), per the partner-portal brief §3: "agregar columna
-- nullable referral_code al signup existente de LeadPrime".
--
-- Run ONCE against the LeadPrime Neon database (LEADPRIME_DATABASE_URL):
--   psql "$LEADPRIME_DATABASE_URL" -f scripts/leadprime-add-referral-code.sql
--
-- Kai's commission engine probes for this column and, when present, sweeps
-- signups that carried a referral code into referral_attributions
-- automatically. Until the column exists (or the LeadPrime signup calls
-- POST https://kai.chyrris.com/api/referrals/attribute), attribution can be
-- done manually from Kai (partnerAdmin.attributeReferral).

ALTER TABLE contractors ADD COLUMN IF NOT EXISTS referral_code VARCHAR(50);

CREATE INDEX IF NOT EXISTS idx_contractors_referral_code
  ON contractors (referral_code)
  WHERE referral_code IS NOT NULL;
