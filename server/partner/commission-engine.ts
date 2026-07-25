/**
 * Partner Portal — referral attribution + commission engine
 *
 * READS the existing LeadPrime payment records (invoices mirror + wallet
 * ledger + Stripe refunds) and WRITES only to Kai's own referral_* tables.
 * It never touches the payment flow itself (brief §8: Stripe/Stax and the
 * subscription logic are read-only from here).
 *
 * Commission rules (term sheet, brief §6.3):
 *  - Commission ONLY on revenue actually collected, never on signups.
 *  - The FIRST collected payment anchors the 12-month clock
 *    (first_payment_date). charge_date <= first_payment_date + 12 months
 *    → tier_year1_pct (default 20%); after that → tier_year2_pct (10%).
 *  - A referred user who cancels before paying never generates commission
 *    (attribution simply stays pending_first_payment with zero rows).
 *  - Refund/chargeback → compensating NEGATIVE commission row
 *    (is_reversal=true, keyed by the Stripe refund id) — append-only ledger.
 *  - A referred user who cancels → attribution 'inactive'; stops generating
 *    new commissions; already-generated rows are kept.
 *
 * What counts as a collected charge:
 *  1. LeadPrime `invoices` rows with amount_paid > 0 (paid Stripe invoices —
 *     subscription/license revenue). Key: lp-inv:<stripe_invoice_id>.
 *  2. LeadPrime `wallet_transactions` with amount_cents > 0 AND type IN
 *     ('purchase','stripe_purchase','stripe_recharge','recharge') — real-money
 *     wallet top-ups. Key: lp-wtx:<id>. 'subscription_recharge' is EXCLUDED
 *     because those credits are funded by the subscription invoice already
 *     counted in (1) — counting both would double-pay the commission.
 */
import { Pool } from "pg";
import { addMonths } from "date-fns";
import { and, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "../db";
import {
  referralAttributions,
  referralCommissions,
  referralPartners,
  type ReferralPartner,
} from "../../drizzle/schema";

let enginePool: Pool | null = null;

function getLeadPrimePool(): Pool {
  if (!enginePool) {
    const url = process.env.LEADPRIME_DATABASE_URL;
    if (!url) {
      throw new Error("LEADPRIME_DATABASE_URL environment variable is not set");
    }
    enginePool = new Pool({
      connectionString: url,
      ssl: { rejectUnauthorized: false },
      max: 3,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
    });
    console.log("[Commission Engine] LeadPrime pool initialized");
  }
  return enginePool;
}

// ── LeadPrime schema probes (graceful degradation, same 42P01/42703 policy
//    used across the leadprime-* services) ────────────────────────────────
const columnProbeCache = new Map<string, boolean>();

async function leadprimeColumnExists(table: string, column: string): Promise<boolean> {
  const key = `${table}.${column}`;
  if (columnProbeCache.has(key)) return columnProbeCache.get(key)!;
  try {
    const pool = getLeadPrimePool();
    const res = await pool.query(
      `SELECT 1 FROM information_schema.columns WHERE table_name = $1 AND column_name = $2 LIMIT 1`,
      [table, column]
    );
    const exists = res.rows.length > 0;
    columnProbeCache.set(key, exists);
    return exists;
  } catch (error) {
    console.error(`[Commission Engine] Column probe failed for ${key}:`, error);
    return false;
  }
}

export interface SyncSummary {
  attributionsCreated: number;
  firstPaymentsAnchored: number;
  commissionsCreated: number;
  reversalsCreated: number;
  attributionsDeactivated: number;
  attributionsReactivated: number;
  errors: string[];
}

function emptySummary(): SyncSummary {
  return {
    attributionsCreated: 0,
    firstPaymentsAnchored: 0,
    commissionsCreated: 0,
    reversalsCreated: 0,
    attributionsDeactivated: 0,
    attributionsReactivated: 0,
    errors: [],
  };
}

/** The public signup link shown to partners: <base>?ref=<CODE> */
export function getReferralSignupBase(): string {
  return process.env.REFERRAL_SIGNUP_URL || "https://leadprime.chyrris.com/signup";
}

export function buildReferralLink(referralCode: string): string {
  const base = getReferralSignupBase();
  const sep = base.includes("?") ? "&" : "?";
  return `${base}${sep}ref=${encodeURIComponent(referralCode)}`;
}

/** Validate a referral code → partner (case-insensitive), or null. */
export async function findPartnerByCode(code: string): Promise<ReferralPartner | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db
    .select()
    .from(referralPartners)
    .where(sql`UPPER(${referralPartners.referralCode}) = UPPER(${code.trim()})`)
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Create an attribution for an existing LeadPrime contractor. Used by the
 * public capture endpoint (called from the LeadPrime signup) and by the
 * admin manual-attribution mutation. Idempotent: UNIQUE(referred_user_id)
 * means the first attribution wins and repeats are no-ops.
 */
export async function createAttribution(input: {
  referralCode: string;
  referredUserId: string;
}): Promise<{ success: boolean; created: boolean; error?: string }> {
  try {
    const db = await getDb();
    if (!db) return { success: false, created: false, error: "Database not available" };

    const partner = await findPartnerByCode(input.referralCode);
    if (!partner || partner.status === "inactive") {
      return { success: false, created: false, error: "Invalid referral code" };
    }

    // The referred user must exist in LeadPrime (no phantom attributions).
    const pool = getLeadPrimePool();
    const contractor = await pool.query(
      `SELECT id, created_at FROM contractors WHERE id = $1 LIMIT 1`,
      [input.referredUserId]
    );
    if (contractor.rows.length === 0) {
      return { success: false, created: false, error: "Referred user not found" };
    }

    const signupDate: Date = contractor.rows[0].created_at ?? new Date();
    const inserted = await db
      .insert(referralAttributions)
      .values({
        partnerId: partner.id,
        referredUserId: input.referredUserId,
        referralCode: partner.referralCode,
        signupDate,
      })
      .onConflictDoNothing({ target: referralAttributions.referredUserId })
      .returning({ id: referralAttributions.id });

    return { success: true, created: inserted.length > 0 };
  } catch (error: any) {
    console.error("[Commission Engine] createAttribution failed:", error);
    return { success: false, created: false, error: error.message };
  }
}

/**
 * Sweep LeadPrime signups that carried a referral code. Requires the
 * nullable column contractors.referral_code (added by
 * scripts/leadprime-add-referral-code.sql — additive, zero destructive).
 * Silently skips if the column does not exist yet.
 */
async function syncAttributionsFromSignups(summary: SyncSummary): Promise<void> {
  const hasColumn = await leadprimeColumnExists("contractors", "referral_code");
  if (!hasColumn) return;

  const db = await getDb();
  if (!db) return;

  const pool = getLeadPrimePool();
  const res = await pool.query(
    `SELECT id, referral_code, created_at
     FROM contractors
     WHERE referral_code IS NOT NULL AND TRIM(referral_code) <> ''
     ORDER BY created_at ASC
     LIMIT 2000`
  );
  if (res.rows.length === 0) return;
  if (res.rows.length === 2000) {
    console.warn("[Commission Engine] Signup sweep hit the 2000-row cap; remaining rows sync next run");
  }

  const partners = await db.select().from(referralPartners);
  const byCode = new Map(partners.map(p => [p.referralCode.toUpperCase(), p]));

  for (const row of res.rows) {
    const partner = byCode.get(String(row.referral_code).trim().toUpperCase());
    if (!partner || partner.status === "inactive") continue;
    const inserted = await db
      .insert(referralAttributions)
      .values({
        partnerId: partner.id,
        referredUserId: row.id,
        referralCode: partner.referralCode,
        signupDate: row.created_at ?? new Date(),
      })
      .onConflictDoNothing({ target: referralAttributions.referredUserId })
      .returning({ id: referralAttributions.id });
    if (inserted.length > 0) summary.attributionsCreated += 1;
  }
}

interface LeadPrimeCharge {
  sourcePaymentId: string;
  contractorId: string;
  amountCents: number;
  chargeDate: Date;
}

/** Collected charges for a set of contractors, oldest first. */
async function fetchCollectedCharges(contractorIds: string[]): Promise<LeadPrimeCharge[]> {
  if (contractorIds.length === 0) return [];
  const pool = getLeadPrimePool();
  const charges: LeadPrimeCharge[] = [];

  // 1) Paid invoices (subscription/license revenue). Only rows with a
  //    stripe_invoice_id can be tracked idempotently; rows without one are
  //    skipped and logged.
  try {
    const res = await pool.query(
      `SELECT contractor_id, stripe_invoice_id, amount_paid,
              COALESCE(paid_at, created_at) AS charge_date
       FROM invoices
       WHERE contractor_id = ANY($1)
         AND amount_paid > 0`,
      [contractorIds]
    );
    let skipped = 0;
    for (const row of res.rows) {
      if (!row.stripe_invoice_id) {
        skipped += 1;
        continue;
      }
      charges.push({
        sourcePaymentId: `lp-inv:${row.stripe_invoice_id}`,
        contractorId: row.contractor_id,
        amountCents: parseInt(row.amount_paid, 10) || 0,
        chargeDate: new Date(row.charge_date),
      });
    }
    if (skipped > 0) {
      console.warn(`[Commission Engine] ${skipped} paid invoices without stripe_invoice_id skipped`);
    }
  } catch (error: any) {
    if (error?.code !== "42P01") throw error; // invoices table missing → wallet-only
    console.warn("[Commission Engine] invoices table not found in LeadPrime DB");
  }

  // 2) Real-money wallet top-ups ('subscription_recharge' excluded — funded
  //    by the invoice already counted above).
  try {
    const res = await pool.query(
      `SELECT id, contractor_id, amount_cents, created_at
       FROM wallet_transactions
       WHERE contractor_id = ANY($1)
         AND amount_cents > 0
         AND type IN ('purchase','stripe_purchase','stripe_recharge','recharge')`,
      [contractorIds]
    );
    for (const row of res.rows) {
      charges.push({
        sourcePaymentId: `lp-wtx:${row.id}`,
        contractorId: row.contractor_id,
        amountCents: parseInt(row.amount_cents, 10) || 0,
        chargeDate: new Date(row.created_at),
      });
    }
  } catch (error: any) {
    if (error?.code !== "42P01") throw error;
    console.warn("[Commission Engine] wallet_transactions table not found in LeadPrime DB");
  }

  charges.sort((a, b) => a.chargeDate.getTime() - b.chargeDate.getTime());
  return charges;
}

/** Year-1 vs year-2 stage for a charge given the anchored first payment. */
export function resolveAppliedPct(
  chargeDate: Date,
  firstPaymentDate: Date,
  tierYear1Pct: string,
  tierYear2Pct: string
): { pct: string; stage: "year1" | "year2" } {
  const year1Boundary = addMonths(firstPaymentDate, 12);
  if (chargeDate.getTime() <= year1Boundary.getTime()) {
    return { pct: tierYear1Pct, stage: "year1" };
  }
  return { pct: tierYear2Pct, stage: "year2" };
}

/** commission_cents = round(charge_cents × pct / 100) */
export function computeCommissionCents(chargeCents: number, pct: string): number {
  return Math.round((chargeCents * parseFloat(pct)) / 100);
}

export function centsToDecimal(cents: number): string {
  return (cents / 100).toFixed(2);
}

/**
 * Core sweep: for every attribution of active partners, ingest new collected
 * charges as commission rows and anchor first_payment_date on the first one.
 */
async function syncCommissionCharges(summary: SyncSummary): Promise<void> {
  const db = await getDb();
  if (!db) return;

  // Paused/inactive partners stop accruing NEW commissions (existing rows
  // are preserved); invited/active partners accrue normally.
  const partners = await db
    .select()
    .from(referralPartners)
    .where(inArray(referralPartners.status, ["invited", "active"]));
  if (partners.length === 0) return;
  const partnerById = new Map(partners.map(p => [p.id, p]));

  const attributions = await db
    .select()
    .from(referralAttributions)
    .where(inArray(referralAttributions.partnerId, partners.map(p => p.id)));
  if (attributions.length === 0) return;

  // Attributions marked inactive keep their history but generate nothing new.
  const liveAttributions = attributions.filter(a => a.status !== "inactive");
  if (liveAttributions.length === 0) return;
  const attributionByUser = new Map(liveAttributions.map(a => [a.referredUserId, a]));

  const charges = await fetchCollectedCharges(liveAttributions.map(a => a.referredUserId));

  for (const charge of charges) {
    const attribution = attributionByUser.get(charge.contractorId);
    if (!attribution) continue;
    const partner = partnerById.get(attribution.partnerId);
    if (!partner) continue;
    if (charge.amountCents <= 0) continue;

    // First collected payment anchors the 12-month clock and activates the
    // attribution (charges are processed oldest-first, so the anchor is the
    // true first payment).
    if (!attribution.firstPaymentDate) {
      attribution.firstPaymentDate = charge.chargeDate;
      attribution.status = "active";
      await db
        .update(referralAttributions)
        .set({
          firstPaymentDate: charge.chargeDate,
          status: "active",
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(referralAttributions.id, attribution.id),
            sql`${referralAttributions.firstPaymentDate} IS NULL`
          )
        );
      summary.firstPaymentsAnchored += 1;
    }

    const { pct } = resolveAppliedPct(
      charge.chargeDate,
      attribution.firstPaymentDate,
      partner.tierYear1Pct,
      partner.tierYear2Pct
    );
    const commissionCents = computeCommissionCents(charge.amountCents, pct);

    const inserted = await db
      .insert(referralCommissions)
      .values({
        partnerId: partner.id,
        attributionId: attribution.id,
        sourcePaymentId: charge.sourcePaymentId,
        chargeAmount: centsToDecimal(charge.amountCents),
        appliedPct: pct,
        commissionAmount: centsToDecimal(commissionCents),
        chargeDate: charge.chargeDate,
        isReversal: false,
      })
      .onConflictDoNothing()
      .returning({ id: referralCommissions.id });
    if (inserted.length > 0) summary.commissionsCreated += 1;
  }
}

/**
 * Refund sweep (best effort): looks at Stripe refunds from the last 90 days
 * and, when a refund's charge belongs to an invoice we paid commission on,
 * writes a compensating negative row keyed by the refund id (idempotent).
 * Skips silently when Stripe is not configured. The admin reversal mutation
 * covers anything this misses (wallet top-up refunds, chargebacks).
 */
async function syncRefundsFromStripe(summary: SyncSummary): Promise<void> {
  let stripe: any = null;
  try {
    const { getStripe } = await import("../services/leadprime-finance");
    stripe = getStripe();
  } catch {
    return;
  }
  if (!stripe) return;

  const db = await getDb();
  if (!db) return;

  // Commissioned invoices → commission row, for O(1) matching below.
  const invoiceCommissions = await db
    .select()
    .from(referralCommissions)
    .where(
      and(
        eq(referralCommissions.isReversal, false),
        sql`${referralCommissions.sourcePaymentId} LIKE 'lp-inv:%'`
      )
    );
  if (invoiceCommissions.length === 0) return;
  const byInvoiceId = new Map(
    invoiceCommissions.map(c => [c.sourcePaymentId.slice("lp-inv:".length), c])
  );

  // Sources already compensated MANUALLY (admin reversal keeps the original
  // source_payment_id). Skipping them here prevents double compensation when
  // the Stripe sweep later sees the same refund.
  const manualReversals = await db
    .select({ sourcePaymentId: referralCommissions.sourcePaymentId })
    .from(referralCommissions)
    .where(
      and(
        eq(referralCommissions.isReversal, true),
        sql`${referralCommissions.sourcePaymentId} LIKE 'lp-inv:%'`
      )
    );
  const manuallyReversed = new Set(manualReversals.map(r => r.sourcePaymentId));

  try {
    const since = Math.floor(Date.now() / 1000) - 90 * 24 * 60 * 60;
    const refunds = await stripe.refunds.list({
      created: { gte: since },
      limit: 100,
      expand: ["data.charge"],
    });

    for (const refund of refunds.data as any[]) {
      if (refund.status && refund.status !== "succeeded") continue;
      const charge = typeof refund.charge === "object" ? refund.charge : null;
      const invoiceId =
        charge && typeof charge.invoice === "string"
          ? charge.invoice
          : charge?.invoice?.id ?? null;
      if (!invoiceId) continue;
      const original = byInvoiceId.get(invoiceId);
      if (!original) continue;
      if (manuallyReversed.has(original.sourcePaymentId)) continue;

      const refundCents = refund.amount ?? 0;
      if (refundCents <= 0) continue;
      const reversalCents = computeCommissionCents(refundCents, original.appliedPct);

      const inserted = await db
        .insert(referralCommissions)
        .values({
          partnerId: original.partnerId,
          attributionId: original.attributionId,
          sourcePaymentId: `lp-refund:${refund.id}`,
          chargeAmount: centsToDecimal(-refundCents),
          appliedPct: original.appliedPct,
          commissionAmount: centsToDecimal(-reversalCents),
          chargeDate: new Date((refund.created ?? Math.floor(Date.now() / 1000)) * 1000),
          isReversal: true,
        })
        .onConflictDoNothing()
        .returning({ id: referralCommissions.id });
      if (inserted.length > 0) summary.reversalsCreated += 1;
    }
  } catch (error: any) {
    summary.errors.push(`Stripe refund sweep failed: ${error.message}`);
    console.error("[Commission Engine] Refund sweep failed:", error);
  }
}

/**
 * Subscription-state sweep: referred users whose subscriptions were all
 * canceled go 'inactive' (stop accruing; history kept). If they later
 * resubscribe, a previously-paying attribution is reactivated. Contractors
 * deleted from LeadPrime also go inactive. Wallet-only users (no
 * subscription rows) are left untouched.
 */
async function syncAttributionLifecycle(summary: SyncSummary): Promise<void> {
  const db = await getDb();
  if (!db) return;

  const attributions = await db.select().from(referralAttributions);
  if (attributions.length === 0) return;

  const pool = getLeadPrimePool();
  const ids = attributions.map(a => a.referredUserId);
  const res = await pool.query(
    `SELECT c.id,
            EXISTS(SELECT 1 FROM subscriptions s
                   WHERE s.contractor_id = c.id
                     AND s.status IN ('active','trialing','past_due')) AS has_live_sub,
            EXISTS(SELECT 1 FROM subscriptions s
                   WHERE s.contractor_id = c.id) AS has_any_sub
     FROM contractors c
     WHERE c.id = ANY($1)`,
    [ids]
  );
  const stateById = new Map(res.rows.map(r => [r.id, r]));

  for (const attribution of attributions) {
    const state = stateById.get(attribution.referredUserId);

    // Contractor no longer exists in LeadPrime → inactive.
    if (!state) {
      if (attribution.status !== "inactive") {
        await db
          .update(referralAttributions)
          .set({ status: "inactive", updatedAt: new Date() })
          .where(eq(referralAttributions.id, attribution.id));
        summary.attributionsDeactivated += 1;
      }
      continue;
    }

    if (attribution.status !== "inactive" && state.has_any_sub && !state.has_live_sub) {
      await db
        .update(referralAttributions)
        .set({ status: "inactive", updatedAt: new Date() })
        .where(eq(referralAttributions.id, attribution.id));
      summary.attributionsDeactivated += 1;
    } else if (
      attribution.status === "inactive" &&
      state.has_live_sub &&
      attribution.firstPaymentDate
    ) {
      await db
        .update(referralAttributions)
        .set({ status: "active", updatedAt: new Date() })
        .where(eq(referralAttributions.id, attribution.id));
      summary.attributionsReactivated += 1;
    }
  }
}

export interface ReferredUserInfo {
  id: string;
  businessName: string | null;
  plan: string | null;
  subscriptionStatus: string | null;
}

/**
 * Minimal, SANITIZED info about referred users for the partner dashboard:
 * business identifier + plan only. Deliberately excludes email, phone,
 * payment data and any in-platform activity (brief §7.2).
 */
export async function fetchReferredUsersInfo(
  contractorIds: string[]
): Promise<Map<string, ReferredUserInfo>> {
  const result = new Map<string, ReferredUserInfo>();
  if (contractorIds.length === 0) return result;
  const pool = getLeadPrimePool();
  const res = await pool.query(
    `SELECT c.id,
            COALESCE(NULLIF(TRIM(cp.business_name), ''), NULLIF(TRIM(c.company_name), ''), NULLIF(TRIM(c.name), '')) AS business_name,
            s.plan, s.status AS sub_status
     FROM contractors c
     LEFT JOIN company_profiles cp ON cp.contractor_id = c.id
     LEFT JOIN LATERAL (
       SELECT COALESCE(NULLIF(TRIM(plan_name), ''), plan) AS plan, status
       FROM subscriptions
       WHERE contractor_id = c.id
       ORDER BY CASE status
         WHEN 'active' THEN 0
         WHEN 'trialing' THEN 1
         WHEN 'past_due' THEN 2
         ELSE 3
       END
       LIMIT 1
     ) s ON true
     WHERE c.id = ANY($1)`,
    [contractorIds]
  );
  for (const row of res.rows) {
    result.set(row.id, {
      id: row.id,
      businessName: row.business_name ?? null,
      plan: row.plan ?? null,
      subscriptionStatus: row.sub_status ?? null,
    });
  }
  return result;
}

let syncInFlight: Promise<SyncSummary> | null = null;

/** Full sync. Serialized: concurrent calls share the in-flight run. */
export async function syncReferralSystem(): Promise<SyncSummary> {
  if (syncInFlight) return syncInFlight;
  syncInFlight = (async () => {
    const summary = emptySummary();
    const steps: Array<[string, (s: SyncSummary) => Promise<void>]> = [
      ["attributions", syncAttributionsFromSignups],
      ["charges", syncCommissionCharges],
      ["refunds", syncRefundsFromStripe],
      ["lifecycle", syncAttributionLifecycle],
    ];
    for (const [name, step] of steps) {
      try {
        await step(summary);
      } catch (error: any) {
        summary.errors.push(`${name}: ${error.message}`);
        console.error(`[Commission Engine] Step '${name}' failed:`, error);
      }
    }
    console.log(
      `[Commission Engine] Sync done: +${summary.attributionsCreated} attributions, ` +
        `+${summary.commissionsCreated} commissions, +${summary.reversalsCreated} reversals, ` +
        `${summary.firstPaymentsAnchored} anchored, -${summary.attributionsDeactivated}/+${summary.attributionsReactivated} lifecycle` +
        (summary.errors.length ? `, errors: ${summary.errors.join("; ")}` : "")
    );
    return summary;
  })().finally(() => {
    syncInFlight = null;
  });
  return syncInFlight;
}

const SYNC_INTERVAL_MS = 6 * 60 * 60 * 1000; // every 6 hours
let syncTimer: NodeJS.Timeout | null = null;

/** Start the periodic sync (called once from server startup; non-fatal). */
export function startCommissionSyncSchedule(): void {
  if (syncTimer) return;
  if (!process.env.LEADPRIME_DATABASE_URL) {
    console.warn("[Commission Engine] LEADPRIME_DATABASE_URL missing — periodic sync disabled");
    return;
  }
  syncTimer = setInterval(() => {
    syncReferralSystem().catch(err =>
      console.error("[Commission Engine] Scheduled sync failed:", err)
    );
  }, SYNC_INTERVAL_MS);
  // Kick off one sync shortly after boot so a fresh deploy converges fast.
  setTimeout(() => {
    syncReferralSystem().catch(err =>
      console.error("[Commission Engine] Startup sync failed:", err)
    );
  }, 30_000);
  console.log("[Commission Engine] Periodic sync scheduled every 6h");
}
