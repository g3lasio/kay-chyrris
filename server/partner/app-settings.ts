/**
 * Partner Portal — global settings (LeadPrime links, invitation mode).
 *
 * Small key/value store, admin-editable. Exact LeadPrime URLs are supplied by
 * the business (brief §6) — until set, the portal shows sensible defaults that
 * the admin can override without a deploy.
 */
import { inArray } from "drizzle-orm";
import { getDb } from "../db";
import { appSettings } from "../../drizzle/schema";

export const SETTING_KEYS = {
  leadprimeLandingUrl: "leadprime_landing_url",
  leadprimeProductionUrl: "leadprime_production_url",
  invitationMode: "invitation_mode", // 'auto' | 'approval'
  // Base for the pretty short referral links (leadprime.chyrris.com/r/CODE).
  // The /r/CODE redirect itself lives in the LeadPrime repo/app, not Kai — this
  // is only the base Kai uses to DISPLAY the shareable link to the partner.
  shortLinkBase: "leadprime_short_link_base",
} as const;

export type PortalSettings = {
  leadprimeLandingUrl: string;
  leadprimeProductionUrl: string;
  invitationMode: "auto" | "approval";
  shortLinkBase: string;
};

const DEFAULTS: PortalSettings = {
  leadprimeLandingUrl: process.env.LEADPRIME_LANDING_URL || "https://leadprime.chyrris.com",
  leadprimeProductionUrl: process.env.LEADPRIME_PRODUCTION_URL || "https://app.leadprime.chyrris.com",
  invitationMode: (process.env.PARTNER_INVITATION_MODE as "auto" | "approval") || "auto",
  shortLinkBase: process.env.REFERRAL_SHORT_LINK_BASE || "https://leadprime.chyrris.com",
};

export async function getPortalSettings(): Promise<PortalSettings> {
  const db = await getDb();
  if (!db) return { ...DEFAULTS };
  try {
    const rows = await db
      .select()
      .from(appSettings)
      .where(inArray(appSettings.key, Object.values(SETTING_KEYS)));
    const map = new Map(rows.map(r => [r.key, r.value ?? ""]));
    // Fall back to the env-configured default when there's no DB row, so an
    // admin who set PARTNER_INVITATION_MODE=approval (but never wrote the DB
    // setting) still gets the approval gate — not a silent 'auto'.
    const mode = map.get(SETTING_KEYS.invitationMode) || DEFAULTS.invitationMode;
    return {
      leadprimeLandingUrl: map.get(SETTING_KEYS.leadprimeLandingUrl) || DEFAULTS.leadprimeLandingUrl,
      leadprimeProductionUrl: map.get(SETTING_KEYS.leadprimeProductionUrl) || DEFAULTS.leadprimeProductionUrl,
      invitationMode: mode === "approval" ? "approval" : "auto",
      shortLinkBase: map.get(SETTING_KEYS.shortLinkBase) || DEFAULTS.shortLinkBase,
    };
  } catch (error) {
    console.error("[App Settings] read failed:", error);
    return { ...DEFAULTS };
  }
}

export async function setSetting(key: string, value: string): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db
    .insert(appSettings)
    .values({ key, value, updatedAt: new Date() })
    .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt: new Date() } });
}
