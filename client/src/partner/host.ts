/**
 * Partner Portal — client-side host detection.
 *
 * partners.chyrris.com renders the partner portal; any other host renders
 * the Kai admin. For local/dev preview you can force the portal with
 * ?portal=partners (persisted per tab) and go back with ?portal=admin.
 * The server enforces the same separation independently (hostname gating in
 * createContext), so this switch is presentation-only.
 */
// Real admin domains where the ?portal override must NEVER take effect, so a
// stray/typo'd query string can never render the partner portal on the admin
// host. The server enforces separation independently; this only affects which
// SPA renders.
const ADMIN_HOSTS = new Set(["kai.chyrris.com"]);

function isNeutralPreviewHost(host: string): boolean {
  // localhost, IPs and preview sandboxes — where forcing the portal for dev is
  // safe because neither cookie is domain-isolated there anyway.
  if (host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "0.0.0.0") return true;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return true;
  if (host.includes("manus") || host.includes("railway") || host.includes("localhost")) return true;
  return false;
}

export function isPartnerPortalHost(): boolean {
  if (typeof window === "undefined") return false;
  const host = window.location.hostname.toLowerCase();
  // The real partner domain always renders the portal.
  if (host === "partners.chyrris.com" || host.startsWith("partners.")) return true;
  // On the real admin domain, never honor the override.
  if (ADMIN_HOSTS.has(host)) return false;
  // The ?portal override is a dev/preview affordance only.
  if (!isNeutralPreviewHost(host)) return false;

  const params = new URLSearchParams(window.location.search);
  const override = params.get("portal");
  if (override === "partners") {
    sessionStorage.setItem("portal-override", "partners");
    return true;
  }
  if (override === "admin") {
    sessionStorage.removeItem("portal-override");
    return false;
  }
  return sessionStorage.getItem("portal-override") === "partners";
}
