/**
 * Partner Portal — hostname separation
 *
 * The same Kai deployment answers on two custom domains:
 *   - kai.chyrris.com       → Kai admin panel (existing, untouched)
 *   - partners.chyrris.com  → Partner referral portal (this feature)
 *
 * The SPA bundle is shared; the client decides which app to render from
 * window.location.hostname. On the server, the hostname gates which session
 * type is resolved (see _core/context.ts): on the partner host the admin
 * session cookie is NEVER resolved, so no admin procedure can be invoked
 * through partners.chyrris.com, and vice versa for partner procedures on
 * the admin host.
 */
import type { Request } from "express";

const DEFAULT_PARTNER_HOST = "partners.chyrris.com";

export function getPartnerPortalHost(): string {
  return (process.env.PARTNER_PORTAL_HOST || DEFAULT_PARTNER_HOST).toLowerCase();
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "0.0.0.0"]);

/** True when this request arrived through the partner portal domain. */
export function isPartnerHost(req: Request): boolean {
  const host = (req.hostname || "").toLowerCase();
  if (!host) return false;
  if (host === getPartnerPortalHost()) return true;
  // Any partners.* subdomain (e.g. partners.up.railway.app previews) counts.
  return host.startsWith("partners.");
}

/**
 * True when the hostname cannot distinguish the two areas (localhost, raw
 * IPs, *.manus* previews). In that case both session types stay usable so
 * local development and preview environments keep working; on the real
 * domains the separation is strict.
 */
export function isNeutralHost(req: Request): boolean {
  const host = (req.hostname || "").toLowerCase();
  if (!host) return true;
  if (LOCAL_HOSTS.has(host)) return true;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return true;
  if (host.includes("manus")) return true;
  return false;
}

/** Admin sessions are only resolved outside the partner domain. */
export function allowAdminSession(req: Request): boolean {
  return !isPartnerHost(req);
}

/** Partner sessions are resolved on the partner domain and neutral hosts. */
export function allowPartnerSession(req: Request): boolean {
  return isPartnerHost(req) || isNeutralHost(req);
}
