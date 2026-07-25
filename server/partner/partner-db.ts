/**
 * Partner Portal — data access for the partner dashboard and Kai admin.
 *
 * MULTI-TENANT RULE (brief §7.3): every partner-facing function takes the
 * partnerId FROM THE SESSION and filters every query by it. Nothing here
 * accepts a partnerId chosen by the portal client.
 */
import { and, desc, eq, gte, inArray, isNull, lte, sql } from "drizzle-orm";
import { addMonths } from "date-fns";
import { getDb } from "../db";
import {
  partnerDocuments,
  referralAttributions,
  referralCommissions,
  referralPartners,
  referralPayouts,
  type PartnerDocument,
  type ReferralPartner,
} from "../../drizzle/schema";
import { storagePut, storageGet } from "../storage";
import { buildReferralLink, fetchReferredUsersInfo, reversalKey } from "./commission-engine";

// ── Onboarding (brief §7.1) ────────────────────────────────────────────────
// Step 1 contract  → a 'contract' document exists (verified by admin or uploaded signed)
// Step 2 W-9       → a 'w9' document uploaded
// Step 3 ACH       → an 'ach_authorization' document uploaded
// Step 4 contact   → partner confirmed their contact data (contact_confirmed_at)

export interface OnboardingState {
  steps: {
    contract: { done: boolean; status: string | null };
    w9: { done: boolean; status: string | null };
    ach: { done: boolean; status: string | null };
    contact: { done: boolean };
  };
  completedCount: number;
  totalSteps: 4;
  complete: boolean;
}

function docStepDone(doc: PartnerDocument | undefined): boolean {
  return !!doc && (doc.status === "uploaded" || doc.status === "verified");
}

export async function getOnboardingState(partner: ReferralPartner): Promise<OnboardingState> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const docs = await db
    .select()
    .from(partnerDocuments)
    .where(eq(partnerDocuments.partnerId, partner.id))
    .orderBy(desc(partnerDocuments.createdAt));

  // Latest document per type drives the step state.
  const latestByType = new Map<string, PartnerDocument>();
  for (const doc of docs) {
    if (!latestByType.has(doc.docType)) latestByType.set(doc.docType, doc);
  }

  const contract = latestByType.get("contract");
  const w9 = latestByType.get("w9");
  const ach = latestByType.get("ach_authorization");

  const steps = {
    contract: { done: docStepDone(contract), status: contract?.status ?? null },
    w9: { done: docStepDone(w9), status: w9?.status ?? null },
    ach: { done: docStepDone(ach), status: ach?.status ?? null },
    contact: { done: partner.contactConfirmedAt != null },
  };
  const completedCount = [steps.contract.done, steps.w9.done, steps.ach.done, steps.contact.done]
    .filter(Boolean).length;
  const complete = completedCount === 4;

  // Persist the flag the first time all 4 steps are done (unlocks dashboard).
  if (complete !== partner.onboardingComplete) {
    await db
      .update(referralPartners)
      .set({ onboardingComplete: complete, updatedAt: new Date() })
      .where(eq(referralPartners.id, partner.id));
  }

  return { steps, completedCount, totalSteps: 4, complete };
}

// ── Documents zone (upload via the Kai storage proxy) ─────────────────────

const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024; // 10 MB
const ALLOWED_DOC_MIME = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
]);

export async function uploadPartnerDocument(input: {
  partnerId: number;
  docType: "contract" | "w9" | "ach_authorization" | "other";
  fileName: string;
  contentType: string;
  base64Data: string;
}): Promise<PartnerDocument> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  if (!ALLOWED_DOC_MIME.has(input.contentType)) {
    throw new Error("Formato no permitido. Sube PDF o imagen (PNG/JPG/WEBP).");
  }
  const buffer = Buffer.from(input.base64Data, "base64");
  if (buffer.length === 0) throw new Error("Archivo vacío");
  if (buffer.length > MAX_DOCUMENT_BYTES) {
    throw new Error("El archivo supera el máximo de 10 MB");
  }

  const safeName = input.fileName.replace(/[^\w.\-]+/g, "_").slice(0, 120) || "documento";
  const key = `partner-documents/${input.partnerId}/${input.docType}/${Date.now()}-${safeName}`;
  const { url } = await storagePut(key, buffer, input.contentType);

  const now = new Date();
  const rows = await db
    .insert(partnerDocuments)
    .values({
      partnerId: input.partnerId,
      docType: input.docType,
      fileUrl: url,
      fileName: safeName,
      status: "uploaded",
      uploadedAt: now,
    })
    .returning();
  return rows[0]!;
}

export async function listPartnerDocuments(partnerId: number): Promise<PartnerDocument[]> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db
    .select()
    .from(partnerDocuments)
    .where(eq(partnerDocuments.partnerId, partnerId))
    .orderBy(desc(partnerDocuments.createdAt));
}

/** Fresh download URL for one of the partner's OWN documents. */
export async function getPartnerDocumentUrl(
  partnerId: number,
  documentId: number
): Promise<string | null> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const rows = await db
    .select()
    .from(partnerDocuments)
    .where(and(eq(partnerDocuments.id, documentId), eq(partnerDocuments.partnerId, partnerId)))
    .limit(1);
  const doc = rows[0];
  if (!doc?.fileUrl) return null;
  // Re-sign through the storage proxy when the stored URL is a key-style path.
  try {
    const marker = "partner-documents/";
    const idx = doc.fileUrl.indexOf(marker);
    if (idx >= 0) {
      const key = doc.fileUrl.slice(doc.fileUrl.indexOf(marker));
      const { url } = await storageGet(key.split("?")[0]!);
      return url;
    }
  } catch {
    // fall through to the stored URL
  }
  return doc.fileUrl;
}

// ── Dashboard (brief §7.2) ────────────────────────────────────────────────

export interface PartnerDashboard {
  kpis: {
    totalReferrals: number;
    activePaying: number;
    pendingFirstPayment: number;
    commissionThisMonth: string;
    commissionYtd: string;
    commissionAllTime: string;
    pendingBalance: string;
  };
  freeAccount: {
    current: number;
    threshold: number;
    achieved: boolean;
  };
  referralLink: string;
  referralCode: string;
}

function sumRows(rows: Array<{ total: string | null }>): string {
  return rows[0]?.total ?? "0.00";
}

export async function getPartnerDashboard(partner: ReferralPartner): Promise<PartnerDashboard> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const counts = await db
    .select({
      total: sql<number>`COUNT(*)::int`,
      active: sql<number>`COUNT(*) FILTER (WHERE ${referralAttributions.status} = 'active')::int`,
      pending: sql<number>`COUNT(*) FILTER (WHERE ${referralAttributions.status} = 'pending_first_payment')::int`,
    })
    .from(referralAttributions)
    .where(eq(referralAttributions.partnerId, partner.id));

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const yearStart = new Date(now.getFullYear(), 0, 1);

  const monthSum = await db
    .select({ total: sql<string>`COALESCE(SUM(${referralCommissions.commissionAmount}), 0)::numeric(12,2)::text` })
    .from(referralCommissions)
    .where(and(eq(referralCommissions.partnerId, partner.id), gte(referralCommissions.chargeDate, monthStart)));

  const ytdSum = await db
    .select({ total: sql<string>`COALESCE(SUM(${referralCommissions.commissionAmount}), 0)::numeric(12,2)::text` })
    .from(referralCommissions)
    .where(and(eq(referralCommissions.partnerId, partner.id), gte(referralCommissions.chargeDate, yearStart)));

  const allTimeSum = await db
    .select({ total: sql<string>`COALESCE(SUM(${referralCommissions.commissionAmount}), 0)::numeric(12,2)::text` })
    .from(referralCommissions)
    .where(eq(referralCommissions.partnerId, partner.id));

  const pendingSum = await db
    .select({ total: sql<string>`COALESCE(SUM(${referralCommissions.commissionAmount}), 0)::numeric(12,2)::text` })
    .from(referralCommissions)
    .where(and(eq(referralCommissions.partnerId, partner.id), eq(referralCommissions.payoutStatus, "pending")));

  const activeCount = counts[0]?.active ?? 0;
  return {
    kpis: {
      totalReferrals: counts[0]?.total ?? 0,
      activePaying: activeCount,
      pendingFirstPayment: counts[0]?.pending ?? 0,
      commissionThisMonth: sumRows(monthSum),
      commissionYtd: sumRows(ytdSum),
      commissionAllTime: sumRows(allTimeSum),
      pendingBalance: sumRows(pendingSum),
    },
    freeAccount: {
      current: activeCount,
      threshold: partner.freeAccountThreshold,
      achieved: activeCount >= partner.freeAccountThreshold,
    },
    referralLink: buildReferralLink(partner.referralCode),
    referralCode: partner.referralCode,
  };
}

// ── Referrals table (sanitized — brief §7.2: no contractor PII) ───────────

export interface PartnerReferralRow {
  attributionId: number;
  business: string;
  signupDate: Date;
  status: "pending_first_payment" | "active" | "inactive";
  stage: "year1" | "year2" | null;
  stagePct: string | null;
  plan: string | null;
  commissionThisMonth: string;
}

export async function getPartnerReferrals(partner: ReferralPartner): Promise<PartnerReferralRow[]> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const attributions = await db
    .select()
    .from(referralAttributions)
    .where(eq(referralAttributions.partnerId, partner.id))
    .orderBy(desc(referralAttributions.signupDate));
  if (attributions.length === 0) return [];

  const info = await fetchReferredUsersInfo(attributions.map(a => a.referredUserId));

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthByAttribution = await db
    .select({
      attributionId: referralCommissions.attributionId,
      total: sql<string>`COALESCE(SUM(${referralCommissions.commissionAmount}), 0)::numeric(12,2)::text`,
    })
    .from(referralCommissions)
    .where(
      and(
        eq(referralCommissions.partnerId, partner.id),
        gte(referralCommissions.chargeDate, monthStart)
      )
    )
    .groupBy(referralCommissions.attributionId);
  const monthMap = new Map(monthByAttribution.map(r => [r.attributionId, r.total]));

  return attributions.map((a, idx) => {
    const user = info.get(a.referredUserId);
    let stage: "year1" | "year2" | null = null;
    let stagePct: string | null = null;
    if (a.firstPaymentDate) {
      const boundary = addMonths(a.firstPaymentDate, 12);
      stage = now.getTime() <= boundary.getTime() ? "year1" : "year2";
      stagePct = stage === "year1" ? partner.tierYear1Pct : partner.tierYear2Pct;
    }
    return {
      attributionId: a.id,
      // Business identifier only — never email/phone/payment data.
      business: user?.businessName || `Referido #${attributions.length - idx}`,
      signupDate: a.signupDate,
      status: a.status,
      stage,
      stagePct,
      plan: user?.plan ?? null,
      commissionThisMonth: monthMap.get(a.id) ?? "0.00",
    };
  });
}

// ── Payout history ────────────────────────────────────────────────────────

export async function getPartnerPayouts(partnerId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db
    .select()
    .from(referralPayouts)
    .where(eq(referralPayouts.partnerId, partnerId))
    .orderBy(desc(referralPayouts.periodEnd));
}

// ══════════════════════════════════════════════════════════════════════════
// ADMIN SIDE (kai.chyrris.com) — full visibility over every partner
// ══════════════════════════════════════════════════════════════════════════

export interface AdminPartnerSummary extends ReferralPartner {
  totalReferrals: number;
  activeReferrals: number;
  pendingCommission: string;
  totalCommission: string;
}

export async function adminListPartners(): Promise<AdminPartnerSummary[]> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const partners = await db.select().from(referralPartners).orderBy(desc(referralPartners.createdAt));
  if (partners.length === 0) return [];
  const ids = partners.map(p => p.id);

  const attributionAgg = await db
    .select({
      partnerId: referralAttributions.partnerId,
      total: sql<number>`COUNT(*)::int`,
      active: sql<number>`COUNT(*) FILTER (WHERE ${referralAttributions.status} = 'active')::int`,
    })
    .from(referralAttributions)
    .where(inArray(referralAttributions.partnerId, ids))
    .groupBy(referralAttributions.partnerId);
  const attributionMap = new Map(attributionAgg.map(r => [r.partnerId, r]));

  const commissionAgg = await db
    .select({
      partnerId: referralCommissions.partnerId,
      pending: sql<string>`COALESCE(SUM(${referralCommissions.commissionAmount}) FILTER (WHERE ${referralCommissions.payoutStatus} = 'pending'), 0)::numeric(12,2)::text`,
      total: sql<string>`COALESCE(SUM(${referralCommissions.commissionAmount}), 0)::numeric(12,2)::text`,
    })
    .from(referralCommissions)
    .where(inArray(referralCommissions.partnerId, ids))
    .groupBy(referralCommissions.partnerId);
  const commissionMap = new Map(commissionAgg.map(r => [r.partnerId, r]));

  return partners.map(p => ({
    ...p,
    totalReferrals: attributionMap.get(p.id)?.total ?? 0,
    activeReferrals: attributionMap.get(p.id)?.active ?? 0,
    pendingCommission: commissionMap.get(p.id)?.pending ?? "0.00",
    totalCommission: commissionMap.get(p.id)?.total ?? "0.00",
  }));
}

export async function adminGetPartnerDetail(partnerId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const partnerRows = await db
    .select()
    .from(referralPartners)
    .where(eq(referralPartners.id, partnerId))
    .limit(1);
  const partner = partnerRows[0];
  if (!partner) return null;

  const [attributions, commissions, documents, payouts] = await Promise.all([
    db
      .select()
      .from(referralAttributions)
      .where(eq(referralAttributions.partnerId, partnerId))
      .orderBy(desc(referralAttributions.signupDate)),
    db
      .select()
      .from(referralCommissions)
      .where(eq(referralCommissions.partnerId, partnerId))
      .orderBy(desc(referralCommissions.chargeDate))
      .limit(500),
    db
      .select()
      .from(partnerDocuments)
      .where(eq(partnerDocuments.partnerId, partnerId))
      .orderBy(desc(partnerDocuments.createdAt)),
    db
      .select()
      .from(referralPayouts)
      .where(eq(referralPayouts.partnerId, partnerId))
      .orderBy(desc(referralPayouts.periodEnd)),
  ]);

  // Admin view may include the referred users' business names (still no
  // payment data — that never leaves LeadPrime).
  let referredInfo: Record<string, { businessName: string | null; plan: string | null }> = {};
  try {
    const info = await fetchReferredUsersInfo(attributions.map(a => a.referredUserId));
    info.forEach((v, id) => {
      referredInfo[id] = { businessName: v.businessName, plan: v.plan };
    });
  } catch (error) {
    console.error("[Partner DB] Referred info lookup failed:", error);
  }

  return { partner, attributions, commissions, documents, payouts, referredInfo };
}

/**
 * Generate a payout for every pending commission in the period.
 *
 * ATOMIC & double-payout-safe: runs in a transaction and CLAIMS the pending
 * rows with a single guarded UPDATE (payout_id IS NULL AND payout_status =
 * 'pending', returning the claimed rows). Two concurrent calls (double-click /
 * two admins) cannot both stamp the same commissions: the second UPDATE
 * matches zero rows and rolls back. The payout total is computed from the rows
 * actually claimed, so it always equals what was stamped.
 */
export async function adminGeneratePayout(input: {
  partnerId: number;
  periodStart: Date;
  periodEnd: Date;
  method?: string;
  notes?: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  return db.transaction(async tx => {
    // Insert the payout shell first so we have an id to stamp with.
    const payoutRows = await tx
      .insert(referralPayouts)
      .values({
        partnerId: input.partnerId,
        periodStart: input.periodStart,
        periodEnd: input.periodEnd,
        totalAmount: "0.00",
        method: input.method,
        notes: input.notes,
      })
      .returning();
    const payout = payoutRows[0]!;

    // Claim only rows still unpaid & unclaimed — the guard is what makes
    // concurrent generation safe.
    const claimed = await tx
      .update(referralCommissions)
      .set({ payoutId: payout.id })
      .where(
        and(
          eq(referralCommissions.partnerId, input.partnerId),
          eq(referralCommissions.payoutStatus, "pending"),
          isNull(referralCommissions.payoutId),
          gte(referralCommissions.chargeDate, input.periodStart),
          lte(referralCommissions.chargeDate, input.periodEnd)
        )
      )
      .returning();

    if (claimed.length === 0) {
      throw new Error("No hay comisiones pendientes en ese periodo");
    }

    const totalCents = claimed.reduce(
      (acc, c) => acc + Math.round(parseFloat(c.commissionAmount) * 100),
      0
    );
    if (totalCents <= 0) {
      // Rolls back the payout row and the stamping.
      throw new Error("El total del periodo es <= $0 (reversiones superan comisiones)");
    }

    const updatedPayout = await tx
      .update(referralPayouts)
      .set({ totalAmount: (totalCents / 100).toFixed(2) })
      .where(eq(referralPayouts.id, payout.id))
      .returning();

    return { payout: updatedPayout[0]!, commissionCount: claimed.length };
  });
}

/** Mark a payout as paid; its commissions flip to 'paid' with it. */
export async function adminMarkPayoutPaid(payoutId: number, method?: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const rows = await db
    .update(referralPayouts)
    .set({ status: "paid", paidAt: new Date(), ...(method ? { method } : {}) })
    .where(eq(referralPayouts.id, payoutId))
    .returning();
  if (rows.length === 0) throw new Error("Payout not found");

  await db
    .update(referralCommissions)
    .set({ payoutStatus: "paid" })
    .where(eq(referralCommissions.payoutId, payoutId));

  return rows[0]!;
}

/**
 * Manual compensating reversal for a commission (refund/chargeback the
 * automatic Stripe sweep can't see, e.g. wallet top-up refunds).
 *
 * Keyed by the ORIGINAL commission id (`rev:<id>`), the SAME key the Stripe
 * refund sweep uses — so a commission is reversed at most once whichever path
 * fires first (UNIQUE(source_payment_id, is_reversal) dedupes across both).
 */
export async function adminReverseCommission(commissionId: number, reason: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const rows = await db
    .select()
    .from(referralCommissions)
    .where(eq(referralCommissions.id, commissionId))
    .limit(1);
  const original = rows[0];
  if (!original) throw new Error("Commission not found");
  if (original.isReversal) throw new Error("Cannot reverse a reversal row");

  const inserted = await db
    .insert(referralCommissions)
    .values({
      partnerId: original.partnerId,
      attributionId: original.attributionId,
      sourcePaymentId: reversalKey(original.id),
      chargeAmount: (-parseFloat(original.chargeAmount)).toFixed(2),
      appliedPct: original.appliedPct,
      commissionAmount: (-parseFloat(original.commissionAmount)).toFixed(2),
      chargeDate: new Date(),
      isReversal: true,
    })
    .onConflictDoNothing()
    .returning();
  if (inserted.length === 0) {
    throw new Error("Esta comisión ya tiene una reversión registrada");
  }
  console.log(
    `[Partner DB] Commission ${commissionId} reversed (${reason}) → row ${inserted[0]!.id}`
  );
  return inserted[0]!;
}
