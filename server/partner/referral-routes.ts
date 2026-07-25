/**
 * Partner Portal — public referral-capture HTTP endpoints
 *
 * These exist so the LeadPrime signup (separate app, leadprime.chyrris.com)
 * can validate a ?ref= code and report a completed signup to Kai. They are
 * intentionally tiny, rate-limited and neutral: they never expose partner
 * data beyond the partner's public display name.
 *
 *  GET  /api/referrals/validate?code=PRIME
 *       → { valid: boolean, partnerName?: string }
 *
 *  POST /api/referrals/attribute  { referralCode, contractorId }
 *       → { success, created }
 *       If REFERRAL_WEBHOOK_SECRET is set, the X-Referral-Secret header
 *       must match (recommended in production).
 */
import type { Express, Request, Response } from "express";
import { createAttribution, findPartnerByCode } from "./commission-engine";
import { resolveInvitationRedirect } from "./partner-invitations";

// Simple in-memory throttle: max N requests per IP per minute.
const RATE_LIMIT_PER_MINUTE = 60;
const buckets = new Map<string, { count: number; resetAt: number }>();

function rateLimited(req: Request): boolean {
  const ip = req.ip || req.socket.remoteAddress || "unknown";
  const now = Date.now();
  const bucket = buckets.get(ip);
  if (!bucket || bucket.resetAt < now) {
    buckets.set(ip, { count: 1, resetAt: now + 60_000 });
    return false;
  }
  bucket.count += 1;
  if (buckets.size > 10_000) buckets.clear(); // unbounded-growth guard
  return bucket.count > RATE_LIMIT_PER_MINUTE;
}

export function registerReferralRoutes(app: Express): void {
  // Personalized referral invitation link: /i/<token> → 302 to the LeadPrime
  // signup carrying the partner's ?ref= code. The graduate then registers
  // themselves (consent). Unknown/inactive tokens fall back to the plain
  // signup so the link never dead-ends.
  app.get("/i/:token", async (req: Request, res: Response) => {
    try {
      const token = String(req.params.token ?? "").trim();
      const target =
        (token.length > 0 && token.length <= 64 ? await resolveInvitationRedirect(token) : null) ||
        process.env.REFERRAL_SIGNUP_URL ||
        "https://leadprime.chyrris.com/signup";
      return res.redirect(302, target);
    } catch (error) {
      console.error("[Referral Routes] invitation redirect failed:", error);
      return res.redirect(302, process.env.REFERRAL_SIGNUP_URL || "https://leadprime.chyrris.com/signup");
    }
  });

  app.get("/api/referrals/validate", async (req: Request, res: Response) => {
    if (rateLimited(req)) return res.status(429).json({ valid: false });
    try {
      const code = String(req.query.code ?? "").trim();
      if (!code || code.length > 30) return res.json({ valid: false });
      const partner = await findPartnerByCode(code);
      if (!partner || partner.status === "inactive" || partner.status === "paused") {
        return res.json({ valid: false });
      }
      return res.json({ valid: true, partnerName: partner.name });
    } catch (error) {
      console.error("[Referral Routes] validate failed:", error);
      return res.json({ valid: false });
    }
  });

  app.post("/api/referrals/attribute", async (req: Request, res: Response) => {
    if (rateLimited(req)) return res.status(429).json({ success: false });
    try {
      // FAIL CLOSED: attribution binds a contractor to a partner (and thus to
      // future commission). Without a shared secret configured, the endpoint
      // is DISABLED — an unauthenticated attacker must never be able to hijack
      // attributions. When REFERRAL_WEBHOOK_SECRET is unset, LeadPrime should
      // instead attribute via contractors.referral_code (swept by the engine)
      // or the admin does it manually.
      const secret = process.env.REFERRAL_WEBHOOK_SECRET;
      if (!secret) {
        console.warn(
          "[Referral Routes] /api/referrals/attribute called but REFERRAL_WEBHOOK_SECRET is not set — endpoint disabled (fail-closed)"
        );
        return res.status(503).json({ success: false, error: "Attribution endpoint not configured" });
      }
      if (req.headers["x-referral-secret"] !== secret) {
        return res.status(401).json({ success: false, error: "Unauthorized" });
      }

      const referralCode = String(req.body?.referralCode ?? "").trim();
      const contractorId = String(req.body?.contractorId ?? "").trim();
      if (!referralCode || !contractorId || referralCode.length > 30 || contractorId.length > 100) {
        return res.status(400).json({ success: false, error: "Invalid payload" });
      }

      const result = await createAttribution({ referralCode, referredUserId: contractorId });
      if (!result.success) {
        // Generic error — do NOT distinguish "invalid code" from "user not
        // found" (that difference is an enumeration oracle).
        return res.status(400).json({ success: false, error: "Attribution rejected" });
      }
      return res.json({ success: true, created: result.created });
    } catch (error: any) {
      console.error("[Referral Routes] attribute failed:", error);
      return res.status(500).json({ success: false, error: "Internal error" });
    }
  });
}
