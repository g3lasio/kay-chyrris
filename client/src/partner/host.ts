/**
 * Partner Portal — client-side host detection.
 *
 * partners.chyrris.com renders the partner portal; any other host renders
 * the Kai admin. For local/dev preview you can force the portal with
 * ?portal=partners (persisted per tab) and go back with ?portal=admin.
 * The server enforces the same separation independently (hostname gating in
 * createContext), so this switch is presentation-only.
 */
export function isPartnerPortalHost(): boolean {
  if (typeof window === "undefined") return false;
  const host = window.location.hostname.toLowerCase();
  if (host === "partners.chyrris.com" || host.startsWith("partners.")) return true;

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
