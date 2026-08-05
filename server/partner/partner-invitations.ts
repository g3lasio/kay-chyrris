/**
 * Partner Portal — consent-based referral invitations (brief §5)
 *
 * The partner NEVER uploads third-party personal data. They enter ONE email;
 * we send that graduate a personalized signup link carrying the partner's
 * referral code. Attribution only happens when the graduate registers
 * themselves (their own consent). The partner sees each invitation's status.
 *
 * Approval mode (app_settings 'invitation_mode'):
 *  - 'auto' (default): the email is sent immediately (status 'sent').
 *  - 'approval': the invitation waits as 'pending_approval' until an admin
 *    approves it, then it is sent.
 */
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { getDb } from "../db";
import {
  partnerInvitations,
  referralAttributions,
  referralPartners,
  type PartnerInvitation,
  type ReferralPartner,
} from "../../drizzle/schema";
import { getPortalSettings } from "./app-settings";
import { findContractorsByEmails } from "./commission-engine";
import { sendReferralInvitationEmail } from "./partner-emails";

const MAX_INVITES_PER_DAY = 100;

function invitationLink(token: string): string {
  const base = process.env.PARTNER_PORTAL_URL || "https://partners.chyrris.com";
  return `${base.replace(/\/+$/, "")}/i/${token}`;
}

/** The partner-facing view of an invitation (no internal token exposed). */
export function toInvitationView(inv: PartnerInvitation) {
  return {
    id: inv.id,
    email: inv.email,
    status: inv.status,
    sentAt: inv.sentAt,
    registeredAt: inv.registeredAt,
    activatedAt: inv.activatedAt,
    createdAt: inv.createdAt,
  };
}

export async function createInvitation(
  partner: ReferralPartner,
  rawEmail: string
): Promise<{ success: boolean; status: string; error?: string }> {
  const db = await getDb();
  if (!db) return { success: false, status: "", error: "Database not available" };

  const email = rawEmail.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { success: false, status: "", error: "Correo inválido" };
  }
  if (email === partner.contactEmail.toLowerCase()) {
    return { success: false, status: "", error: "No puedes invitarte a ti mismo" };
  }

  // Anti-abuse: cap invites per partner per day.
  const todayCount = await db
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(partnerInvitations)
    .where(
      and(
        eq(partnerInvitations.partnerId, partner.id),
        sql`${partnerInvitations.createdAt} > NOW() - INTERVAL '1 day'`
      )
    );
  if ((todayCount[0]?.count ?? 0) >= MAX_INVITES_PER_DAY) {
    return { success: false, status: "", error: "Límite diario de invitaciones alcanzado" };
  }

  // De-dupe: one live invitation per (partner, email).
  const existing = await db
    .select()
    .from(partnerInvitations)
    .where(
      and(
        eq(partnerInvitations.partnerId, partner.id),
        eq(partnerInvitations.email, email),
        inArray(partnerInvitations.status, ["pending_approval", "sent", "registered", "active"])
      )
    )
    .limit(1);
  if (existing.length > 0) {
    return { success: false, status: existing[0]!.status, error: "Ya existe una invitación para ese correo" };
  }

  const settings = await getPortalSettings();
  const token = nanoid(32);
  const approvalMode = settings.invitationMode === "approval";
  const status = approvalMode ? "pending_approval" : "sent";

  const rows = await db
    .insert(partnerInvitations)
    .values({
      partnerId: partner.id,
      email,
      token,
      status,
      sentAt: approvalMode ? null : new Date(),
    })
    .returning();
  const inv = rows[0]!;

  if (!approvalMode) {
    const sent = await sendReferralInvitationEmail(email, partner.name, invitationLink(token));
    if (!sent.success) {
      console.error(`[Partner Invitations] send failed for inv ${inv.id}: ${sent.error}`);
    }
  }

  return { success: true, status };
}

export async function listPartnerInvitations(partnerId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const rows = await db
    .select()
    .from(partnerInvitations)
    .where(eq(partnerInvitations.partnerId, partnerId))
    .orderBy(desc(partnerInvitations.createdAt));
  return rows.map(toInvitationView);
}

/**
 * Resolve an invitation token to its redirect target (LeadPrime signup with
 * the partner's ref code). Returns null for unknown tokens.
 */
export async function resolveInvitationRedirect(token: string): Promise<string | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db
    .select({
      referralCode: referralPartners.referralCode,
      status: referralPartners.status,
    })
    .from(partnerInvitations)
    .innerJoin(referralPartners, eq(referralPartners.id, partnerInvitations.partnerId))
    .where(eq(partnerInvitations.token, token))
    .limit(1);
  const row = rows[0];
  // Paused and inactive partners don't attribute — consistent with
  // /api/referrals/validate. Fall back to the plain signup (caller handles null).
  if (!row || row.status === "inactive" || row.status === "paused") return null;
  const { buildReferralLink } = await import("./commission-engine");
  return buildReferralLink(row.referralCode);
}

// ── Admin approval mode ────────────────────────────────────────────────────

export async function adminListInvitations(partnerId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db
    .select()
    .from(partnerInvitations)
    .where(eq(partnerInvitations.partnerId, partnerId))
    .orderBy(desc(partnerInvitations.createdAt));
}

export async function adminApproveInvitation(invitationId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const rows = await db
    .select({ inv: partnerInvitations, partner: referralPartners })
    .from(partnerInvitations)
    .innerJoin(referralPartners, eq(referralPartners.id, partnerInvitations.partnerId))
    .where(eq(partnerInvitations.id, invitationId))
    .limit(1);
  const row = rows[0];
  if (!row) throw new Error("Invitación no encontrada");
  if (row.inv.status !== "pending_approval") throw new Error("La invitación no está pendiente de aprobación");

  await db
    .update(partnerInvitations)
    .set({ status: "sent", sentAt: new Date(), updatedAt: new Date() })
    .where(eq(partnerInvitations.id, invitationId));

  const sent = await sendReferralInvitationEmail(row.inv.email, row.partner.name, invitationLink(row.inv.token));
  return { success: true, emailSent: sent.success, error: sent.error };
}

/**
 * Sync invitation statuses (called from the engine sweep): match still-open
 * invitations to LeadPrime contractors by email, then mark 'registered' (the
 * graduate signed up) and 'active' (their attribution reached first payment).
 */
export async function syncInvitationStatuses(): Promise<{ registered: number; activated: number }> {
  const db = await getDb();
  if (!db) return { registered: 0, activated: 0 };

  const open = await db
    .select()
    .from(partnerInvitations)
    .where(inArray(partnerInvitations.status, ["sent", "registered"]));
  if (open.length === 0) return { registered: 0, activated: 0 };

  const emails = Array.from(new Set(open.map(i => i.email.toLowerCase())));
  const contractors = await findContractorsByEmails(emails);
  if (contractors.size === 0) return { registered: 0, activated: 0 };

  // Attributions for those contractors, scoped by partner.
  const contractorIds = Array.from(contractors.values()).map(c => c.id);
  const attributions = await db
    .select()
    .from(referralAttributions)
    .where(inArray(referralAttributions.referredUserId, contractorIds));
  const attrByUser = new Map(attributions.map(a => [`${a.partnerId}:${a.referredUserId}`, a]));

  let registered = 0;
  let activated = 0;
  for (const inv of open) {
    const contractor = contractors.get(inv.email.toLowerCase());
    if (!contractor) continue;
    const attribution = attrByUser.get(`${inv.partnerId}:${contractor.id}`);
    if (!attribution) continue; // registered under a different code — not ours

    if (inv.status === "sent") {
      await db
        .update(partnerInvitations)
        .set({
          status: "registered",
          registeredUserId: contractor.id,
          registeredAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(partnerInvitations.id, inv.id));
      registered += 1;
    }
    if (attribution.status === "active" && inv.status !== "active") {
      await db
        .update(partnerInvitations)
        .set({ status: "active", activatedAt: new Date(), updatedAt: new Date() })
        .where(eq(partnerInvitations.id, inv.id));
      activated += 1;
    }
  }
  return { registered, activated };
}
