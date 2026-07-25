/**
 * Partner Portal — tRPC routers
 *
 *  - partnerAuth   (public): OTP login for partners. Neutral responses, rate
 *                  limited, no self-registration.
 *  - partnerPortal (partnerProcedure): the partner's own dashboard. Every
 *                  query is filtered by ctx.partner.id (multi-tenant rule).
 *  - partnerAdmin  (protectedProcedure, admin panel): create/manage partners,
 *                  verify documents, generate payouts, run the sync engine.
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { PARTNER_COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "../_core/cookies";
import { partnerProcedure, protectedProcedure, publicProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { referralPartners } from "../../drizzle/schema";
import {
  invalidatePartnerSession,
  requestPartnerOtp,
  verifyPartnerOtp,
  evictPartnerFromSessionCache,
  NEUTRAL_OTP_MESSAGE,
} from "./partner-auth";
import {
  adminGeneratePayout,
  adminGetPartnerDetail,
  adminListPartners,
  adminMarkPayoutPaid,
  adminReverseCommission,
  adminUploadPartnerDocument,
  getMonthlyIncomeHistory,
  getOnboardingState,
  getPartnerDashboard,
  getPartnerDocumentUrl,
  getPartnerPayouts,
  getPartnerReferrals,
  listPartnerDocuments,
  markMaterialsReviewed,
  uploadPartnerDocument,
} from "./partner-db";
import {
  buildReferralLink,
  createAttribution,
  syncReferralSystem,
} from "./commission-engine";
import { sendPartnerInvitationEmail } from "./partner-emails";
import {
  adminApproveInvitation,
  adminListInvitations,
  createInvitation,
  listPartnerInvitations,
} from "./partner-invitations";
import { getPortalSettings, setSetting, SETTING_KEYS } from "./app-settings";

const PARTNER_SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/** Public partner shape — the partner's own record, nothing else. */
function toPartnerProfile(p: typeof referralPartners.$inferSelect) {
  return {
    id: p.id,
    name: p.name,
    referralCode: p.referralCode,
    contactName: p.contactName,
    contactEmail: p.contactEmail,
    contactPhone: p.contactPhone,
    status: p.status,
    tierYear1Pct: p.tierYear1Pct,
    tierYear2Pct: p.tierYear2Pct,
    freeAccountThreshold: p.freeAccountThreshold,
    onboardingComplete: p.onboardingComplete,
    contactConfirmedAt: p.contactConfirmedAt,
    referralLink: buildReferralLink(p.referralCode),
  };
}

export const partnerAuthRouter = router({
  // Step 1: request an OTP. ALWAYS neutral — never reveals whether the
  // email exists (brief §4.2.3).
  requestOtp: publicProcedure
    .input(z.object({ email: z.string().email() }))
    .mutation(async ({ input }) => {
      await requestPartnerOtp(input.email);
      return { success: true, message: NEUTRAL_OTP_MESSAGE };
    }),

  // Step 2: verify the OTP → partner session cookie (separate from admin).
  verifyOtp: publicProcedure
    .input(z.object({ email: z.string().email(), code: z.string().min(4).max(10) }))
    .mutation(async ({ input, ctx }) => {
      const ipAddress = ctx.req.ip || ctx.req.socket.remoteAddress;
      const userAgent = ctx.req.headers["user-agent"];
      const result = await verifyPartnerOtp(input.email, input.code, ipAddress, userAgent);
      if (result.success && result.sessionId) {
        const cookieOptions = getSessionCookieOptions(ctx.req);
        // maxAge keeps mobile sessions alive across browser restarts.
        ctx.res.cookie(PARTNER_COOKIE_NAME, result.sessionId, {
          ...cookieOptions,
          maxAge: PARTNER_SESSION_MAX_AGE_MS,
        });
      }
      return { success: result.success, error: result.error };
    }),

  me: publicProcedure.query(async ({ ctx }) => {
    if (!ctx.partner) return null;
    return toPartnerProfile(ctx.partner);
  }),

  logout: publicProcedure.mutation(async ({ ctx }) => {
    const sessionId = ctx.req.cookies[PARTNER_COOKIE_NAME];
    if (sessionId) {
      await invalidatePartnerSession(sessionId);
    }
    const cookieOptions = getSessionCookieOptions(ctx.req);
    ctx.res.clearCookie(PARTNER_COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
    return { success: true };
  }),
});

export const partnerPortalRouter = router({
  onboarding: partnerProcedure.query(async ({ ctx }) => {
    return getOnboardingState(ctx.partner);
  }),

  // Stage 1 acknowledgement — records that the partner reviewed the
  // informational materials (internal record, NOT a legal signature).
  markMaterialsReviewed: partnerProcedure.mutation(async ({ ctx }) => {
    await markMaterialsReviewed(ctx.partner.id);
    evictPartnerFromSessionCache(ctx.partner.id);
    return { success: true };
  }),

  uploadDocument: partnerProcedure
    .input(
      z.object({
        // Only signed/partner-owned docs — informational types are admin-only.
        docType: z.enum(["term_sheet_signed", "contract", "ach_authorization", "w9", "other"]),
        fileName: z.string().min(1).max(255),
        contentType: z.string().min(3).max(100),
        base64Data: z.string().min(1),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const doc = await uploadPartnerDocument({
        partnerId: ctx.partner.id, // session-derived — never client-chosen
        docType: input.docType,
        fileName: input.fileName,
        contentType: input.contentType,
        base64Data: input.base64Data,
      });
      return { success: true, document: doc };
    }),

  documents: partnerProcedure.query(async ({ ctx }) => {
    return listPartnerDocuments(ctx.partner.id);
  }),

  monthlyIncome: partnerProcedure.query(async ({ ctx }) => {
    return getMonthlyIncomeHistory(ctx.partner.id);
  }),

  // LeadPrime useful links (admin-configurable) for the partner to share.
  links: partnerProcedure.query(async () => {
    const s = await getPortalSettings();
    return {
      landingUrl: s.leadprimeLandingUrl,
      productionUrl: s.leadprimeProductionUrl,
    };
  }),

  // ── Consent-based referral invitations (brief §5) ──
  invitations: partnerProcedure.query(async ({ ctx }) => {
    return listPartnerInvitations(ctx.partner.id);
  }),

  createInvitation: partnerProcedure
    .input(z.object({ email: z.string().email().max(255) }))
    .mutation(async ({ input, ctx }) => {
      const result = await createInvitation(ctx.partner, input.email);
      if (!result.success) {
        throw new TRPCError({ code: "BAD_REQUEST", message: result.error ?? "No se pudo invitar" });
      }
      return { success: true, status: result.status };
    }),

  documentUrl: partnerProcedure
    .input(z.object({ documentId: z.number().int().positive() }))
    .query(async ({ input, ctx }) => {
      // getPartnerDocumentUrl filters by partnerId — a partner can never
      // fetch another partner's file by guessing ids.
      const url = await getPartnerDocumentUrl(ctx.partner.id, input.documentId);
      if (!url) throw new TRPCError({ code: "NOT_FOUND", message: "Documento no encontrado" });
      return { url };
    }),

  confirmContact: partnerProcedure
    .input(
      z.object({
        contactName: z.string().min(2).max(255),
        contactPhone: z.string().min(7).max(50),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
      await db
        .update(referralPartners)
        .set({
          contactName: input.contactName,
          contactPhone: input.contactPhone,
          contactConfirmedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(referralPartners.id, ctx.partner.id));
      evictPartnerFromSessionCache(ctx.partner.id);
      return { success: true };
    }),

  dashboard: partnerProcedure.query(async ({ ctx }) => {
    return getPartnerDashboard(ctx.partner);
  }),

  referrals: partnerProcedure.query(async ({ ctx }) => {
    return getPartnerReferrals(ctx.partner);
  }),

  payouts: partnerProcedure.query(async ({ ctx }) => {
    return getPartnerPayouts(ctx.partner.id);
  }),
});

const referralCodeSchema = z
  .string()
  .min(2)
  .max(30)
  .regex(/^[A-Za-z0-9_-]+$/, "Solo letras, números, guion y guion bajo")
  .transform(v => v.toUpperCase());

export const partnerAdminRouter = router({
  // Create a partner — the ONLY way a partner comes into existence
  // (no self-registration, brief §4.4). Fires the Resend invitation.
  create: protectedProcedure
    .input(
      z.object({
        name: z.string().min(2).max(255),
        contactName: z.string().max(255).optional(),
        contactEmail: z.string().email(),
        contactPhone: z.string().max(50).optional(),
        referralCode: referralCodeSchema,
        tierYear1Pct: z.number().min(0).max(100).default(20),
        tierYear2Pct: z.number().min(0).max(100).default(10),
        freeAccountThreshold: z.number().int().min(1).max(1000).default(10),
      })
    )
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });

      try {
        const rows = await db
          .insert(referralPartners)
          .values({
            name: input.name,
            referralCode: input.referralCode,
            contactName: input.contactName,
            contactEmail: input.contactEmail.trim().toLowerCase(),
            contactPhone: input.contactPhone,
            tierYear1Pct: input.tierYear1Pct.toFixed(2),
            tierYear2Pct: input.tierYear2Pct.toFixed(2),
            freeAccountThreshold: input.freeAccountThreshold,
          })
          .returning();
        const partner = rows[0]!;

        const invitation = await sendPartnerInvitationEmail(
          partner.contactEmail,
          partner.name,
          partner.contactName
        );
        return {
          success: true,
          partner,
          invitationSent: invitation.success,
          invitationError: invitation.error,
        };
      } catch (error: any) {
        if (error?.code === "23505") {
          throw new TRPCError({
            code: "CONFLICT",
            message: "Ya existe un socio con ese código de referido o email",
          });
        }
        throw error;
      }
    }),

  resendInvitation: protectedProcedure
    .input(z.object({ partnerId: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
      const rows = await db
        .select()
        .from(referralPartners)
        .where(eq(referralPartners.id, input.partnerId))
        .limit(1);
      const partner = rows[0];
      if (!partner) throw new TRPCError({ code: "NOT_FOUND", message: "Socio no encontrado" });
      const result = await sendPartnerInvitationEmail(
        partner.contactEmail,
        partner.name,
        partner.contactName
      );
      return { success: result.success, error: result.error };
    }),

  list: protectedProcedure.query(async () => {
    return adminListPartners();
  }),

  detail: protectedProcedure
    .input(z.object({ partnerId: z.number().int().positive() }))
    .query(async ({ input }) => {
      const detail = await adminGetPartnerDetail(input.partnerId);
      if (!detail) throw new TRPCError({ code: "NOT_FOUND", message: "Socio no encontrado" });
      return detail;
    }),

  update: protectedProcedure
    .input(
      z.object({
        partnerId: z.number().int().positive(),
        name: z.string().min(2).max(255).optional(),
        contactName: z.string().max(255).nullable().optional(),
        contactEmail: z.string().email().optional(),
        contactPhone: z.string().max(50).nullable().optional(),
        status: z.enum(["invited", "active", "paused", "inactive"]).optional(),
        tierYear1Pct: z.number().min(0).max(100).optional(),
        tierYear2Pct: z.number().min(0).max(100).optional(),
        freeAccountThreshold: z.number().int().min(1).max(1000).optional(),
      })
    )
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });

      const { partnerId, ...updates } = input;
      const set: Record<string, unknown> = { updatedAt: new Date() };
      if (updates.name !== undefined) set.name = updates.name;
      if (updates.contactName !== undefined) set.contactName = updates.contactName;
      if (updates.contactEmail !== undefined) set.contactEmail = updates.contactEmail.trim().toLowerCase();
      if (updates.contactPhone !== undefined) set.contactPhone = updates.contactPhone;
      if (updates.status !== undefined) set.status = updates.status;
      if (updates.tierYear1Pct !== undefined) set.tierYear1Pct = updates.tierYear1Pct.toFixed(2);
      if (updates.tierYear2Pct !== undefined) set.tierYear2Pct = updates.tierYear2Pct.toFixed(2);
      if (updates.freeAccountThreshold !== undefined) set.freeAccountThreshold = updates.freeAccountThreshold;

      const rows = await db
        .update(referralPartners)
        .set(set)
        .where(eq(referralPartners.id, partnerId))
        .returning();
      if (rows.length === 0) throw new TRPCError({ code: "NOT_FOUND", message: "Socio no encontrado" });

      // Status/tier changes take effect immediately, even mid-session.
      evictPartnerFromSessionCache(partnerId);
      return { success: true, partner: rows[0] };
    }),

  verifyDocument: protectedProcedure
    .input(z.object({ documentId: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
      const { partnerDocuments } = await import("../../drizzle/schema");
      const rows = await db
        .update(partnerDocuments)
        .set({ status: "verified", verifiedAt: new Date() })
        .where(eq(partnerDocuments.id, input.documentId))
        .returning();
      if (rows.length === 0) throw new TRPCError({ code: "NOT_FOUND", message: "Documento no encontrado" });
      return { success: true, document: rows[0] };
    }),

  // Admin marks the alliance contract step complete by creating/verifying a
  // 'contract' document row even without an upload (e.g. signed via LeadSign).
  markContractComplete: protectedProcedure
    .input(z.object({ partnerId: z.number().int().positive(), note: z.string().max(255).optional() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
      const { partnerDocuments } = await import("../../drizzle/schema");
      const rows = await db
        .insert(partnerDocuments)
        .values({
          partnerId: input.partnerId,
          docType: "contract",
          fileName: input.note ?? "Contrato de alianza (verificado por admin)",
          status: "verified",
          uploadedBy: "partner",
          uploadedAt: new Date(),
          verifiedAt: new Date(),
        })
        .returning();
      return { success: true, document: rows[0] };
    }),

  // LeadPrime (admin) uploads an INFORMATIONAL document for a specific partner
  // — revenue projection, features, informational term sheet. Appears in that
  // partner's Stage 1 materials only (multi-tenant isolation).
  uploadDocument: protectedProcedure
    .input(
      z.object({
        partnerId: z.number().int().positive(),
        docType: z.enum(["revenue_projection", "features", "term_sheet_info"]),
        fileName: z.string().min(1).max(255),
        contentType: z.string().min(3).max(100),
        base64Data: z.string().min(1),
      })
    )
    .mutation(async ({ input }) => {
      const doc = await adminUploadPartnerDocument({
        partnerId: input.partnerId,
        docType: input.docType,
        fileName: input.fileName,
        contentType: input.contentType,
        base64Data: input.base64Data,
      });
      return { success: true, document: doc };
    }),

  // Fresh download URL for any partner document (admin can view all).
  documentUrl: protectedProcedure
    .input(z.object({ partnerId: z.number().int().positive(), documentId: z.number().int().positive() }))
    .query(async ({ input }) => {
      const url = await getPartnerDocumentUrl(input.partnerId, input.documentId);
      if (!url) throw new TRPCError({ code: "NOT_FOUND", message: "Documento no encontrado" });
      return { url };
    }),

  deleteDocument: protectedProcedure
    .input(z.object({ documentId: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
      const { partnerDocuments } = await import("../../drizzle/schema");
      await db.delete(partnerDocuments).where(eq(partnerDocuments.id, input.documentId));
      return { success: true };
    }),

  // Invitations oversight (approval mode + monitoring).
  listInvitations: protectedProcedure
    .input(z.object({ partnerId: z.number().int().positive() }))
    .query(async ({ input }) => {
      return adminListInvitations(input.partnerId);
    }),

  approveInvitation: protectedProcedure
    .input(z.object({ invitationId: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      return adminApproveInvitation(input.invitationId);
    }),

  // Portal settings (LeadPrime links + invitation mode).
  getSettings: protectedProcedure.query(async () => {
    return getPortalSettings();
  }),

  updateSettings: protectedProcedure
    .input(
      z.object({
        leadprimeLandingUrl: z.string().url().max(500).optional(),
        leadprimeProductionUrl: z.string().url().max(500).optional(),
        invitationMode: z.enum(["auto", "approval"]).optional(),
      })
    )
    .mutation(async ({ input }) => {
      if (input.leadprimeLandingUrl !== undefined)
        await setSetting(SETTING_KEYS.leadprimeLandingUrl, input.leadprimeLandingUrl);
      if (input.leadprimeProductionUrl !== undefined)
        await setSetting(SETTING_KEYS.leadprimeProductionUrl, input.leadprimeProductionUrl);
      if (input.invitationMode !== undefined)
        await setSetting(SETTING_KEYS.invitationMode, input.invitationMode);
      return { success: true, settings: await getPortalSettings() };
    }),

  generatePayout: protectedProcedure
    .input(
      z.object({
        partnerId: z.number().int().positive(),
        periodStart: z.string().datetime(),
        periodEnd: z.string().datetime(),
        method: z.string().max(100).optional(),
        notes: z.string().max(1000).optional(),
      })
    )
    .mutation(async ({ input }) => {
      const result = await adminGeneratePayout({
        partnerId: input.partnerId,
        periodStart: new Date(input.periodStart),
        periodEnd: new Date(input.periodEnd),
        method: input.method,
        notes: input.notes,
      });
      return { success: true, ...result };
    }),

  markPayoutPaid: protectedProcedure
    .input(z.object({ payoutId: z.number().int().positive(), method: z.string().max(100).optional() }))
    .mutation(async ({ input }) => {
      const payout = await adminMarkPayoutPaid(input.payoutId, input.method);
      return { success: true, payout };
    }),

  reverseCommission: protectedProcedure
    .input(z.object({ commissionId: z.number().int().positive(), reason: z.string().min(3).max(500) }))
    .mutation(async ({ input }) => {
      const reversal = await adminReverseCommission(input.commissionId, input.reason);
      return { success: true, reversal };
    }),

  // Manual attribution: link an existing LeadPrime contractor to a partner
  // (e.g. the referral arrived by phone instead of the ?ref= link).
  attributeReferral: protectedProcedure
    .input(z.object({ referralCode: referralCodeSchema, contractorId: z.string().min(1).max(100) }))
    .mutation(async ({ input }) => {
      const result = await createAttribution({
        referralCode: input.referralCode,
        referredUserId: input.contractorId,
      });
      if (!result.success) {
        throw new TRPCError({ code: "BAD_REQUEST", message: result.error ?? "No se pudo atribuir" });
      }
      return { success: true, created: result.created };
    }),

  runSync: protectedProcedure.mutation(async () => {
    const summary = await syncReferralSystem();
    return { success: true, summary };
  }),
});
