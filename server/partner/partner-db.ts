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
import { buildReferralLink, buildShortReferralLink, fetchReferredUsersInfo, reversalKey } from "./commission-engine";
import { getPortalSettings } from "./app-settings";
import { isPartnerEmailConfigured, sendPartnerOnboardingCompleteEmail } from "./partner-emails";

// ── Onboarding journey — 3 unlockable stages (brief §1) ────────────────────
// Stage 1 "materiales": partner reviewed the informational docs LeadPrime
//   uploaded (revenue projection, features, informational term sheet) and
//   checked "he revisado" → materials_reviewed_at. NOT a legal signature.
// Stage 2 "firmados": partner uploads the LeadSign-signed term sheet AND the
//   signed contract (signed OUTSIDE the portal; here they're only stored).
// Stage 3 "pago": partner uploads ACH authorization AND confirms contact.
// Completing all three unlocks the referrals/commissions dashboard.

// Informational doc types (admin-uploaded) shown in stage 1 / "Materiales".
export const INFORMATIONAL_DOC_TYPES = ["revenue_projection", "features", "term_sheet_info"] as const;
// Report doc types (admin-uploaded, free title) shown in "Reportes".
export const REPORT_DOC_TYPES = ["report"] as const;
// Signed doc types (partner-uploaded via LeadSign).
export const SIGNED_DOC_TYPES = ["term_sheet_signed", "contract", "ach_authorization", "w9"] as const;

export interface OnboardingJourney {
  stages: {
    materials: { done: boolean; materialsCount: number; reviewedAt: Date | null };
    signed: {
      termSheet: { done: boolean; status: string | null };
      contract: { done: boolean; status: string | null };
      done: boolean;
    };
    payment: {
      ach: { done: boolean; status: string | null };
      contact: { done: boolean };
      done: boolean;
    };
  };
  currentStage: number; // 1..3 = the stage to work on; 4 = complete
  completedStages: number;
  totalStages: 3;
  complete: boolean;
}

function docStepDone(doc: PartnerDocument | undefined): boolean {
  return !!doc && (doc.status === "uploaded" || doc.status === "verified");
}

export async function getOnboardingState(partner: ReferralPartner): Promise<OnboardingJourney> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const docs = await db
    .select()
    .from(partnerDocuments)
    .where(eq(partnerDocuments.partnerId, partner.id))
    .orderBy(desc(partnerDocuments.createdAt));

  // Latest document per type drives step state.
  const latestByType = new Map<string, PartnerDocument>();
  for (const doc of docs) {
    if (!latestByType.has(doc.docType)) latestByType.set(doc.docType, doc);
  }
  const materialsCount = docs.filter(d =>
    (INFORMATIONAL_DOC_TYPES as readonly string[]).includes(d.docType)
  ).length;

  const termSheet = latestByType.get("term_sheet_signed");
  const contract = latestByType.get("contract");
  const ach = latestByType.get("ach_authorization");

  const materialsDone = partner.materialsReviewedAt != null;
  const signedDone = docStepDone(termSheet) && docStepDone(contract);
  const paymentDone = docStepDone(ach) && partner.contactConfirmedAt != null;

  const stages = {
    materials: { done: materialsDone, materialsCount, reviewedAt: partner.materialsReviewedAt },
    signed: {
      termSheet: { done: docStepDone(termSheet), status: termSheet?.status ?? null },
      contract: { done: docStepDone(contract), status: contract?.status ?? null },
      done: signedDone,
    },
    payment: {
      ach: { done: docStepDone(ach), status: ach?.status ?? null },
      contact: { done: partner.contactConfirmedAt != null },
      done: paymentDone,
    },
  };

  const stageDone = [materialsDone, signedDone, paymentDone];
  const completedStages = stageDone.filter(Boolean).length;
  const complete = completedStages === 3;
  // First incomplete stage (1-based); 4 means done.
  const currentStage = stageDone.findIndex(d => !d) === -1 ? 4 : stageDone.findIndex(d => !d) + 1;

  if (complete !== partner.onboardingComplete) {
    await db
      .update(referralPartners)
      .set({ onboardingComplete: complete, updatedAt: new Date() })
      .where(eq(referralPartners.id, partner.id));
  }

  if (complete) await sendWelcomeEmailOnce(partner);

  return { stages, currentStage, completedStages, totalStages: 3, complete };
}

/**
 * Welcome email for finishing the journey — sent ONCE, ever.
 *
 * The send is CLAIMED with a guarded UPDATE (welcome_email_sent_at IS NULL) and
 * only the winner sends, so two dashboard loads racing each other can't both
 * fire it, and a partner who briefly drops out of "complete" (a document gets
 * rejected, then re-uploaded) doesn't get a second one.
 *
 * If the send fails the claim is RELEASED so a later load retries — a welcome
 * lost to a transient Resend error would never come back otherwise. When email
 * isn't configured at all nothing is claimed, so the partner still gets it once
 * RESEND_API_KEY exists.
 */
async function sendWelcomeEmailOnce(partner: ReferralPartner): Promise<void> {
  if (!isPartnerEmailConfigured() || !partner.contactEmail) return;
  if (partner.welcomeEmailSentAt) return; // fast path — avoids a write per load

  const db = await getDb();
  if (!db) return;

  const claimed = await db
    .update(referralPartners)
    .set({ welcomeEmailSentAt: new Date() })
    .where(and(eq(referralPartners.id, partner.id), isNull(referralPartners.welcomeEmailSentAt)))
    .returning({ id: referralPartners.id });
  if (claimed.length === 0) return; // already sent, or another request won

  const settings = await getPortalSettings();
  const result = await sendPartnerOnboardingCompleteEmail({
    to: partner.contactEmail,
    partnerName: partner.name,
    contactName: partner.contactName,
    referralLink: buildReferralLink(partner.referralCode),
    shortLink: buildShortReferralLink(partner.referralCode, settings.shortLinkBase),
    tierYear1Pct: partner.tierYear1Pct,
    tierYear2Pct: partner.tierYear2Pct,
  });

  if (!result.success) {
    await db
      .update(referralPartners)
      .set({ welcomeEmailSentAt: null })
      .where(eq(referralPartners.id, partner.id));
    console.error(
      `[Partner Portal] Welcome email to partner ${partner.id} failed, claim released for retry: ${result.error}`
    );
  } else {
    console.log(`[Partner Portal] Welcome email sent to partner ${partner.id} (onboarding complete)`);
  }
}

/** Stage 1 acknowledgement: partner marks the informational materials reviewed. */
export async function markMaterialsReviewed(partnerId: number): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db
    .update(referralPartners)
    .set({ materialsReviewedAt: new Date(), updatedAt: new Date() })
    .where(eq(referralPartners.id, partnerId));
}

// ── Documents zone (upload via the Kai storage proxy) ─────────────────────

const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024; // 10 MB
const ALLOWED_DOC_MIME = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
]);

export type PartnerUploadDocType = "term_sheet_signed" | "contract" | "ach_authorization" | "w9" | "other";
// Admin-uploaded types: informational materials + free-form reports.
export type AdminUploadDocType = "revenue_projection" | "features" | "term_sheet_info" | "report";

async function storeDocument(input: {
  partnerId: number;
  docType: PartnerUploadDocType | AdminUploadDocType;
  fileName: string;
  contentType: string;
  base64Data: string;
  uploadedBy: "partner" | "admin";
  title?: string | null;
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

  const rows = await db
    .insert(partnerDocuments)
    .values({
      partnerId: input.partnerId,
      docType: input.docType,
      title: input.title?.trim() || null,
      fileUrl: url,
      fileName: safeName,
      status: "uploaded",
      uploadedBy: input.uploadedBy,
      uploadedAt: new Date(),
    })
    .returning();
  return rows[0]!;
}

/** Partner uploads a signed document (uploaded_by='partner'). */
export async function uploadPartnerDocument(input: {
  partnerId: number;
  docType: PartnerUploadDocType;
  fileName: string;
  contentType: string;
  base64Data: string;
}): Promise<PartnerDocument> {
  return storeDocument({ ...input, uploadedBy: "partner" });
}

/**
 * Admin (LeadPrime) uploads a document FOR a specific partner (uploaded_by=
 * 'admin'): informational materials (Stage 1 "Materiales de LeadPrime") or a
 * free-form 'report' (with an admin title, e.g. "Reporte Q3 2026"). Both are
 * auto-marked 'verified' — the admin is the source of truth, no verification
 * workflow needed. Multi-tenant: assigned to input.partnerId only.
 */
export async function adminUploadPartnerDocument(input: {
  partnerId: number;
  docType: AdminUploadDocType;
  fileName: string;
  contentType: string;
  base64Data: string;
  title?: string | null;
}): Promise<PartnerDocument> {
  if (input.docType === "report" && !input.title?.trim()) {
    throw new Error("El reporte necesita un título");
  }
  const doc = await storeDocument({ ...input, uploadedBy: "admin" });
  const db = await getDb();
  if (db) {
    await db
      .update(partnerDocuments)
      .set({ status: "verified", verifiedAt: new Date() })
      .where(eq(partnerDocuments.id, doc.id));
  }
  return { ...doc, status: "verified", verifiedAt: new Date() };
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

  // Legacy rows may hold an absolute URL; everything stored on R2 is a KEY,
  // which we turn into a fresh short-lived presigned URL on every request.
  if (/^https?:\/\//i.test(doc.fileUrl)) return doc.fileUrl;

  const marker = "partner-documents/";
  const idx = doc.fileUrl.indexOf(marker);
  const key = (idx >= 0 ? doc.fileUrl.slice(idx) : doc.fileUrl).split("?")[0]!;
  const { url } = await storageGet(key);
  return url;
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
  // shortReferralLink is the PRIMARY link to share (pretty, for social bios);
  // referralLink is the canonical ?ref= long form kept as fallback. Both
  // attribute identically.
  shortReferralLink: string;
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

  const settings = await getPortalSettings();
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
    shortReferralLink: buildShortReferralLink(partner.referralCode, settings.shortLinkBase),
    referralLink: buildReferralLink(partner.referralCode),
    referralCode: partner.referralCode,
  };
}

// ── Referrals table (sanitized — brief §7.2: no contractor PII) ───────────

// The ACH settlement cycle means the first collected payment (and therefore
// the first commission) lands ~30–40 days after signup. We surface a single
// estimated date at +35 days for pending referrals so the partner sees when
// their recurring income is expected to start.
const ESTIMATED_FIRST_COMMISSION_DAYS = 35;

export interface PartnerReferralRow {
  attributionId: number;
  business: string;
  signupDate: Date;
  status: "pending_first_payment" | "active" | "inactive";
  stage: "year1" | "year2" | null;
  stagePct: string | null;
  plan: string | null;
  planCost: string | null;
  firstPaymentDate: Date | null;
  estimatedCommissionStart: Date | null;
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
    // Estimated first-commission date: the real first_payment_date once known,
    // otherwise signup + ~35 days (ACH cycle) for pending referrals.
    let estimatedCommissionStart: Date | null = null;
    if (a.firstPaymentDate) {
      estimatedCommissionStart = a.firstPaymentDate;
    } else if (a.status === "pending_first_payment") {
      estimatedCommissionStart = new Date(
        a.signupDate.getTime() + ESTIMATED_FIRST_COMMISSION_DAYS * 24 * 60 * 60 * 1000
      );
    }
    const planPriceCents = user?.planPriceCents ?? null;
    return {
      attributionId: a.id,
      // Business identifier only — never email/phone/payment data.
      business: user?.businessName || `Referido #${attributions.length - idx}`,
      signupDate: a.signupDate,
      status: a.status,
      stage,
      stagePct,
      plan: user?.plan ?? null,
      planCost: planPriceCents != null ? (planPriceCents / 100).toFixed(2) : null,
      firstPaymentDate: a.firstPaymentDate,
      estimatedCommissionStart,
      commissionThisMonth: monthMap.get(a.id) ?? "0.00",
    };
  });
}

/**
 * Monthly commission history (last 12 months) so the partner sees their
 * recurring income accumulate month over month. Reversals net out per month.
 */
export interface MonthlyIncomePoint {
  month: string; // YYYY-MM
  label: string; // e.g. "ene 2026"
  amount: string;
}

export async function getMonthlyIncomeHistory(partnerId: number): Promise<MonthlyIncomePoint[]> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const rows = await db
    .select({
      month: sql<string>`to_char(date_trunc('month', ${referralCommissions.chargeDate}), 'YYYY-MM')`,
      amount: sql<string>`COALESCE(SUM(${referralCommissions.commissionAmount}), 0)::numeric(12,2)::text`,
    })
    .from(referralCommissions)
    .where(
      and(
        eq(referralCommissions.partnerId, partnerId),
        gte(referralCommissions.chargeDate, sql`date_trunc('month', NOW()) - INTERVAL '11 months'`)
      )
    )
    .groupBy(sql`date_trunc('month', ${referralCommissions.chargeDate})`)
    .orderBy(sql`date_trunc('month', ${referralCommissions.chargeDate})`);

  const byMonth = new Map(rows.map(r => [r.month, r.amount]));
  const monthLabels = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

  // Emit a continuous 12-month series (zero-filled) ending in the current month.
  const out: MonthlyIncomePoint[] = [];
  const now = new Date();
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    out.push({
      month: key,
      label: `${monthLabels[d.getMonth()]} ${d.getFullYear()}`,
      amount: byMonth.get(key) ?? "0.00",
    });
  }
  return out;
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
