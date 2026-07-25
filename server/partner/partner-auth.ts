/**
 * Partner Portal — OTP authentication (Resend email codes)
 *
 * Mirrors the session pattern of services/auth.ts but on fully separate
 * tables (partner_auth_codes, partner_sessions) and a separate cookie, so a
 * partner session can never authorize admin procedures and vice versa.
 *
 * Security rules (brief §4):
 *  - Codes are 6 digits, stored bcrypt-hashed, expire in 10 minutes.
 *  - Neutral response whether or not the email exists (no user enumeration).
 *  - Max 5 OTP requests per email per hour; max 5 verify attempts per code.
 *  - No self-registration: login only works for partners created by admin.
 */
import { and, desc, eq, gt, sql } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { nanoid } from "nanoid";
import { getDb } from "../db";
import {
  partnerAuthCodes,
  partnerSessions,
  referralPartners,
  type ReferralPartner,
} from "../../drizzle/schema";
import { sendPartnerOtpEmail } from "./partner-emails";

const OTP_EXPIRY_MINUTES = 10;
const OTP_MAX_REQUESTS_PER_HOUR = 5;
const OTP_MAX_ATTEMPTS = 5;
const SESSION_EXPIRY_DAYS = 7;

// Same short-lived cache trick as admin validateSession — partner dashboard
// fires several queries per page and each one resolves the session.
const SESSION_CACHE_TTL_MS = 60_000;
const partnerSessionCache = new Map<string, { partner: ReferralPartner; expires: number }>();

export const NEUTRAL_OTP_MESSAGE =
  "Si tu correo está registrado, recibirás un código de acceso en unos segundos.";

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function generateOtpCode(): string {
  // 6 digits, cryptographically random, no leading-zero loss (string).
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return String(buf[0]! % 1_000_000).padStart(6, "0");
}

async function findLoginPartner(email: string) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db
    .select()
    .from(referralPartners)
    .where(eq(referralPartners.contactEmail, normalizeEmail(email)))
    .limit(1);
  const partner = rows[0];
  if (!partner) return null;
  // Only invited/active partners can log in; paused/inactive are locked out.
  if (partner.status !== "active" && partner.status !== "invited") return null;
  return partner;
}

/**
 * Request an OTP. ALWAYS returns the same neutral shape regardless of
 * whether the email exists, is rate-limited, or the send failed — the
 * caller (public endpoint) must not leak account existence.
 */
export async function requestPartnerOtp(email: string): Promise<{ success: true; message: string }> {
  const neutral = { success: true as const, message: NEUTRAL_OTP_MESSAGE };
  try {
    const db = await getDb();
    if (!db) return neutral;

    const partner = await findLoginPartner(email);
    if (!partner) {
      console.log("[Partner Auth] OTP requested for unknown/inactive email (neutral response)");
      return neutral;
    }

    // Rate limit: max 5 codes per partner per rolling hour.
    const recentCount = await db
      .select({ count: sql<number>`COUNT(*)::int` })
      .from(partnerAuthCodes)
      .where(
        and(
          eq(partnerAuthCodes.partnerId, partner.id),
          gt(partnerAuthCodes.createdAt, sql`NOW() - INTERVAL '1 hour'`)
        )
      );
    if ((recentCount[0]?.count ?? 0) >= OTP_MAX_REQUESTS_PER_HOUR) {
      console.warn(`[Partner Auth] OTP rate limit hit for partner ${partner.id}`);
      return neutral;
    }

    const code = generateOtpCode();
    const codeHash = await bcrypt.hash(code, 10);
    const expiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000);

    await db.insert(partnerAuthCodes).values({
      partnerId: partner.id,
      code: codeHash,
      expiresAt,
    });

    const sent = await sendPartnerOtpEmail(partner.contactEmail, code);
    if (!sent.success) {
      console.error(`[Partner Auth] OTP email failed for partner ${partner.id}: ${sent.error}`);
    } else {
      console.log(`[Partner Auth] OTP sent to partner ${partner.id}`);
    }
    return neutral;
  } catch (error) {
    console.error("[Partner Auth] Error in requestPartnerOtp:", error);
    return neutral;
  }
}

/**
 * Verify an OTP and create a partner session. First successful login of an
 * 'invited' partner activates the account (invited → active).
 */
export async function verifyPartnerOtp(
  email: string,
  code: string,
  ipAddress?: string,
  userAgent?: string
): Promise<{ success: boolean; sessionId?: string; error?: string }> {
  try {
    const db = await getDb();
    if (!db) return { success: false, error: "Service unavailable" };

    const partner = await findLoginPartner(email);
    if (!partner) {
      return { success: false, error: "Código inválido o expirado" };
    }

    // Latest unused, unexpired code for this partner.
    const rows = await db
      .select()
      .from(partnerAuthCodes)
      .where(
        and(
          eq(partnerAuthCodes.partnerId, partner.id),
          eq(partnerAuthCodes.used, false),
          gt(partnerAuthCodes.expiresAt, sql`NOW()`)
        )
      )
      .orderBy(desc(partnerAuthCodes.createdAt))
      .limit(1);

    const authCode = rows[0];
    if (!authCode) {
      return { success: false, error: "Código inválido o expirado" };
    }
    if (authCode.attempts >= OTP_MAX_ATTEMPTS) {
      return { success: false, error: "Demasiados intentos. Solicita un código nuevo." };
    }

    // Count the attempt before comparing so a failed compare still burns one.
    await db
      .update(partnerAuthCodes)
      .set({ attempts: authCode.attempts + 1 })
      .where(eq(partnerAuthCodes.id, authCode.id));

    const matches = await bcrypt.compare(code.trim(), authCode.code);
    if (!matches) {
      return { success: false, error: "Código inválido o expirado" };
    }

    await db
      .update(partnerAuthCodes)
      .set({ used: true })
      .where(eq(partnerAuthCodes.id, authCode.id));

    // First login activates an invited partner.
    if (partner.status === "invited") {
      await db
        .update(referralPartners)
        .set({ status: "active", updatedAt: new Date() })
        .where(eq(referralPartners.id, partner.id));
    }

    const sessionId = nanoid(32);
    const expiresAt = new Date(Date.now() + SESSION_EXPIRY_DAYS * 24 * 60 * 60 * 1000);
    await db.insert(partnerSessions).values({
      id: sessionId,
      partnerId: partner.id,
      ipAddress,
      userAgent,
      expiresAt,
    });

    console.log(`[Partner Auth] Login OK for partner ${partner.id}`);
    return { success: true, sessionId };
  } catch (error: any) {
    console.error("[Partner Auth] Error in verifyPartnerOtp:", error);
    return { success: false, error: "Service unavailable" };
  }
}

/** Validate a partner session id → partner row (or null). */
export async function validatePartnerSession(sessionId: string): Promise<ReferralPartner | null> {
  try {
    const cached = partnerSessionCache.get(sessionId);
    if (cached && cached.expires > Date.now()) {
      return cached.partner;
    }

    const db = await getDb();
    if (!db) return null;

    const rows = await db
      .select({ partner: referralPartners })
      .from(partnerSessions)
      .innerJoin(referralPartners, eq(referralPartners.id, partnerSessions.partnerId))
      .where(and(eq(partnerSessions.id, sessionId), gt(partnerSessions.expiresAt, sql`NOW()`)))
      .limit(1);

    const partner = rows[0]?.partner;
    // Paused/inactive partners lose access immediately, even mid-session.
    if (!partner || (partner.status !== "active" && partner.status !== "invited")) {
      partnerSessionCache.delete(sessionId);
      return null;
    }

    partnerSessionCache.set(sessionId, { partner, expires: Date.now() + SESSION_CACHE_TTL_MS });
    return partner;
  } catch (error) {
    console.error("[Partner Auth] Error in validatePartnerSession:", error);
    return null;
  }
}

/** Logout: destroy the session row and cache entry. */
export async function invalidatePartnerSession(sessionId: string): Promise<boolean> {
  try {
    partnerSessionCache.delete(sessionId);
    const db = await getDb();
    if (!db) return false;
    await db.delete(partnerSessions).where(eq(partnerSessions.id, sessionId));
    return true;
  } catch (error) {
    console.error("[Partner Auth] Error in invalidatePartnerSession:", error);
    return false;
  }
}

/** Drop the cache entry so status/tier changes made by admin apply at once. */
export function evictPartnerFromSessionCache(partnerId: number): void {
  partnerSessionCache.forEach((entry, sid) => {
    if (entry.partner.id === partnerId) partnerSessionCache.delete(sid);
  });
}

/** Periodic cleanup of expired sessions and stale OTP codes. */
export async function cleanupExpiredPartnerAuth(): Promise<void> {
  try {
    const db = await getDb();
    if (!db) return;
    await db.delete(partnerSessions).where(sql`${partnerSessions.expiresAt} < NOW()`);
    await db.delete(partnerAuthCodes).where(sql`${partnerAuthCodes.createdAt} < NOW() - INTERVAL '24 hours'`);
  } catch (error) {
    console.error("[Partner Auth] Error in cleanup:", error);
  }
}
