import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import type { ReferralPartner, User } from "../../drizzle/schema";
import { COOKIE_NAME, PARTNER_COOKIE_NAME } from "@shared/const";
import { validateSession } from "../services/auth";
import { validatePartnerSession } from "../partner/partner-auth";
import { allowAdminSession, allowPartnerSession, isPartnerHost } from "../partner/hostname";

export type TrpcContext = {
  req: CreateExpressContextOptions["req"];
  res: CreateExpressContextOptions["res"];
  user: User | null;
  partner: ReferralPartner | null;
  isPartnerHost: boolean;
};

export async function createContext(
  opts: CreateExpressContextOptions
): Promise<TrpcContext> {
  let user: User | null = null;
  let partner: ReferralPartner | null = null;

  // Hostname gating (partner portal isolation): on partners.chyrris.com the
  // admin cookie is never even looked at, so no admin procedure can execute
  // through the partner domain; on kai.chyrris.com the partner cookie is
  // ignored the same way. Neutral hosts (localhost/previews) resolve both.
  if (allowAdminSession(opts.req)) {
    const sessionId = opts.req.cookies[COOKIE_NAME];
    if (sessionId) {
      user = await validateSession(sessionId);
    }
  }

  if (allowPartnerSession(opts.req)) {
    const partnerSessionId = opts.req.cookies[PARTNER_COOKIE_NAME];
    if (partnerSessionId) {
      partner = await validatePartnerSession(partnerSessionId);
    }
  }

  return {
    req: opts.req,
    res: opts.res,
    user,
    partner,
    isPartnerHost: isPartnerHost(opts.req),
  };
}
