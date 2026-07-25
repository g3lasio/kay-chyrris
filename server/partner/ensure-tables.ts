/**
 * Partner Portal — idempotent table bootstrap
 *
 * Kai does not run drizzle migrations automatically on deploy (scripts/
 * start.js only builds and starts), so — following the seedApplications()
 * pattern in _core/index.ts — this creates the referral_* tables on startup
 * with IF NOT EXISTS guards. 100% additive: no ALTER/DROP of existing
 * objects, safe to run on every boot. The canonical migration lives in
 * drizzle/0001_daffy_magdalene.sql for `pnpm db:push` users.
 */
import { sql } from "drizzle-orm";
import { getDb } from "../db";

const ENUMS: Array<[string, string[]]> = [
  ["referral_partner_status", ["invited", "active", "paused", "inactive"]],
  ["partner_doc_type", ["contract", "w9", "ach_authorization", "other"]],
  ["partner_doc_status", ["pending", "uploaded", "verified"]],
  ["attribution_status", ["pending_first_payment", "active", "inactive"]],
  ["commission_payout_status", ["pending", "paid"]],
  ["payout_status", ["pending", "paid"]],
  ["partner_invitation_status", ["pending_approval", "sent", "registered", "active", "declined"]],
];

// Values added to partner_doc_type AFTER the original enum shipped. ALTER TYPE
// ... ADD VALUE IF NOT EXISTS runs outside a transaction (autocommit) and is a
// no-op once present, so this is safe on every boot.
const ENUM_ADDED_VALUES: Array<[string, string[]]> = [
  ["partner_doc_type", ["revenue_projection", "features", "term_sheet_info", "term_sheet_signed"]],
];

// Columns added to existing tables (additive). ADD COLUMN IF NOT EXISTS.
const ADDED_COLUMNS: string[] = [
  `ALTER TABLE partner_documents ADD COLUMN IF NOT EXISTS uploaded_by varchar(20) DEFAULT 'partner' NOT NULL`,
  `ALTER TABLE referral_partners ADD COLUMN IF NOT EXISTS materials_reviewed_at timestamp`,
];

const TABLE_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS referral_partners (
    id serial PRIMARY KEY,
    name varchar(255) NOT NULL,
    referral_code varchar(50) NOT NULL UNIQUE,
    contact_name varchar(255),
    contact_email varchar(255) NOT NULL UNIQUE,
    contact_phone varchar(50),
    status referral_partner_status DEFAULT 'invited' NOT NULL,
    tier_year1_pct numeric(5,2) DEFAULT '20.00' NOT NULL,
    tier_year2_pct numeric(5,2) DEFAULT '10.00' NOT NULL,
    free_account_threshold integer DEFAULT 10 NOT NULL,
    onboarding_complete boolean DEFAULT false NOT NULL,
    contact_confirmed_at timestamp,
    created_at timestamp DEFAULT now() NOT NULL,
    updated_at timestamp DEFAULT now() NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS partner_documents (
    id serial PRIMARY KEY,
    partner_id integer NOT NULL REFERENCES referral_partners(id) ON DELETE CASCADE,
    doc_type partner_doc_type NOT NULL,
    file_url text,
    file_name varchar(255),
    status partner_doc_status DEFAULT 'pending' NOT NULL,
    uploaded_at timestamp,
    verified_at timestamp,
    created_at timestamp DEFAULT now() NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS referral_attributions (
    id serial PRIMARY KEY,
    partner_id integer NOT NULL REFERENCES referral_partners(id) ON DELETE CASCADE,
    referred_user_id varchar(100) NOT NULL UNIQUE,
    referral_code varchar(50) NOT NULL,
    signup_date timestamp NOT NULL,
    first_payment_date timestamp,
    status attribution_status DEFAULT 'pending_first_payment' NOT NULL,
    created_at timestamp DEFAULT now() NOT NULL,
    updated_at timestamp DEFAULT now() NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS referral_payouts (
    id serial PRIMARY KEY,
    partner_id integer NOT NULL REFERENCES referral_partners(id) ON DELETE CASCADE,
    period_start timestamp NOT NULL,
    period_end timestamp NOT NULL,
    total_amount numeric(10,2) NOT NULL,
    status payout_status DEFAULT 'pending' NOT NULL,
    paid_at timestamp,
    method varchar(100),
    notes text,
    created_at timestamp DEFAULT now() NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS referral_commissions (
    id serial PRIMARY KEY,
    partner_id integer NOT NULL REFERENCES referral_partners(id) ON DELETE CASCADE,
    attribution_id integer NOT NULL REFERENCES referral_attributions(id) ON DELETE CASCADE,
    source_payment_id varchar(255) NOT NULL,
    charge_amount numeric(10,2) NOT NULL,
    applied_pct numeric(5,2) NOT NULL,
    commission_amount numeric(10,2) NOT NULL,
    charge_date timestamp NOT NULL,
    is_reversal boolean DEFAULT false NOT NULL,
    payout_status commission_payout_status DEFAULT 'pending' NOT NULL,
    payout_id integer REFERENCES referral_payouts(id) ON DELETE SET NULL,
    created_at timestamp DEFAULT now() NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS partner_auth_codes (
    id serial PRIMARY KEY,
    partner_id integer NOT NULL REFERENCES referral_partners(id) ON DELETE CASCADE,
    code varchar(100) NOT NULL,
    expires_at timestamp NOT NULL,
    used boolean DEFAULT false NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    created_at timestamp DEFAULT now() NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS partner_sessions (
    id varchar(255) PRIMARY KEY,
    partner_id integer NOT NULL REFERENCES referral_partners(id) ON DELETE CASCADE,
    ip_address varchar(45),
    user_agent text,
    expires_at timestamp NOT NULL,
    created_at timestamp DEFAULT now() NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_partner_documents_partner ON partner_documents (partner_id, doc_type)`,
  `CREATE INDEX IF NOT EXISTS idx_referral_attributions_partner ON referral_attributions (partner_id, status)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS uq_referral_commissions_source ON referral_commissions (source_payment_id, is_reversal)`,
  `CREATE INDEX IF NOT EXISTS idx_referral_commissions_partner ON referral_commissions (partner_id, payout_status, charge_date)`,
  `CREATE INDEX IF NOT EXISTS idx_partner_auth_codes_partner ON partner_auth_codes (partner_id, created_at)`,
  // Enhancements (v2): consent-based referral invitations + portal settings.
  `CREATE TABLE IF NOT EXISTS partner_invitations (
    id serial PRIMARY KEY,
    partner_id integer NOT NULL REFERENCES referral_partners(id) ON DELETE CASCADE,
    email varchar(255) NOT NULL,
    token varchar(64) NOT NULL UNIQUE,
    status partner_invitation_status DEFAULT 'sent' NOT NULL,
    registered_user_id varchar(100),
    sent_at timestamp,
    registered_at timestamp,
    activated_at timestamp,
    created_at timestamp DEFAULT now() NOT NULL,
    updated_at timestamp DEFAULT now() NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS app_settings (
    key varchar(100) PRIMARY KEY,
    value text,
    updated_at timestamp DEFAULT now() NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_partner_invitations_partner ON partner_invitations (partner_id, status)`,
  `CREATE INDEX IF NOT EXISTS idx_partner_invitations_email ON partner_invitations (email)`,
];

export async function ensurePartnerTables(): Promise<void> {
  try {
    const db = await getDb();
    if (!db) {
      console.warn("[Partner Tables] Database not available — skipping bootstrap");
      return;
    }

    for (const [name, values] of ENUMS) {
      const valueList = values.map(v => `'${v}'`).join(", ");
      await db.execute(
        sql.raw(
          `DO $$ BEGIN
             CREATE TYPE "${name}" AS ENUM (${valueList});
           EXCEPTION WHEN duplicate_object THEN NULL;
           END $$;`
        )
      );
    }
    // Add enum values that were introduced after the type first shipped.
    for (const [name, values] of ENUM_ADDED_VALUES) {
      for (const value of values) {
        await db.execute(sql.raw(`ALTER TYPE "${name}" ADD VALUE IF NOT EXISTS '${value}'`));
      }
    }
    for (const statement of ADDED_COLUMNS) {
      await db.execute(sql.raw(statement));
    }
    for (const statement of TABLE_STATEMENTS) {
      await db.execute(sql.raw(statement));
    }
    console.log("[Partner Tables] referral_* tables ensured (v2)");
  } catch (error) {
    // Non-fatal: Kai must keep booting even if the portal bootstrap fails.
    console.error("[Partner Tables] Bootstrap failed:", error);
  }
}
