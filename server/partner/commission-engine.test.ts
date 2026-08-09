/**
 * Partner Portal — unit tests for the pure commission logic (term sheet
 * rules, brief §6) and the hostname isolation helpers.
 */
import { describe, expect, it } from "vitest";
import {
  buildReferralLink,
  buildShortReferralLink,
  centsToDecimal,
  computeCommissionCents,
  resolveAppliedPct,
  reversalKey,
} from "./commission-engine";
import { allowAdminSession, allowPartnerSession, isNeutralHost, isPartnerHost } from "./hostname";

function fakeReq(hostname: string) {
  return { hostname } as any;
}

describe("commission stage (12-month clock anchored on first payment)", () => {
  const first = new Date("2026-01-15T00:00:00Z");

  it("charge on the first payment date is year 1 (20%)", () => {
    expect(resolveAppliedPct(first, first, "20.00", "10.00")).toEqual({ pct: "20.00", stage: "year1" });
  });

  it("charge 11 months later is still year 1", () => {
    const charge = new Date("2026-12-15T00:00:00Z");
    expect(resolveAppliedPct(charge, first, "20.00", "10.00").stage).toBe("year1");
  });

  it("charge exactly 12 months later is year 1 (inclusive boundary)", () => {
    const charge = new Date("2027-01-15T00:00:00Z");
    expect(resolveAppliedPct(charge, first, "20.00", "10.00").stage).toBe("year1");
  });

  it("charge one day past 12 months is year 2 (10%)", () => {
    const charge = new Date("2027-01-16T00:00:00Z");
    expect(resolveAppliedPct(charge, first, "20.00", "10.00")).toEqual({ pct: "10.00", stage: "year2" });
  });

  it("respects custom partner tiers", () => {
    const charge = new Date("2028-06-01T00:00:00Z");
    expect(resolveAppliedPct(charge, first, "25.00", "12.50").pct).toBe("12.50");
  });
});

describe("commission amounts", () => {
  it("20% of $150.00 = $30.00", () => {
    expect(computeCommissionCents(15000, "20.00")).toBe(3000);
    expect(centsToDecimal(3000)).toBe("30.00");
  });

  it("10% of $99.99 rounds to the nearest cent", () => {
    expect(computeCommissionCents(9999, "10.00")).toBe(1000); // 999.9 → 1000
  });

  it("handles zero and negative (reversal) amounts", () => {
    expect(computeCommissionCents(0, "20.00")).toBe(0);
    expect(computeCommissionCents(-15000, "20.00")).toBe(-3000);
    expect(centsToDecimal(-3000)).toBe("-30.00");
  });
});

describe("reversal idempotency key", () => {
  it("both the Stripe sweep and the manual admin reversal key by the original commission id", () => {
    // Same original commission → same key → UNIQUE(source,is_reversal) dedupes
    // across both paths, so a charge is reversed at most once.
    expect(reversalKey(42)).toBe("rev:42");
    expect(reversalKey(42)).toBe(reversalKey(42));
    expect(reversalKey(42)).not.toBe(reversalKey(43));
  });
});

describe("referral link", () => {
  it("builds the signup link with the code", () => {
    expect(buildReferralLink("PRIME")).toBe("https://leadprime.chyrris.com/signup?ref=PRIME");
  });

  it("URL-encodes unusual codes", () => {
    expect(buildReferralLink("A B")).toContain("ref=A%20B");
  });
});

/**
 * Estos tests ANTES fijaban el comportamiento roto: afirmaban que el link se
 * construía como /r/<code> y pasaban en verde mientras TODOS los links de
 * TODOS los socios devolvían 404 en producción. El motivo es instructivo:
 * comprobaban el generador contra sí mismo, nunca contra la ruta que debía
 * servirlo. En LeadPrime `/r` lo atiende ReviewPilot.
 *
 * Ahora el prefijo esperado es /ref/, que es el que LeadPrime registra de
 * verdad (backend/src/routes/partnerReferralLink.ts, montado en server.ts).
 * El enrutado en sí se verifica del otro lado, montando Express y pidiendo la
 * URL — aquí solo se fija el contrato del prefijo.
 */
describe("short referral link (social bios)", () => {
  it("builds leadprime.chyrris.com/ref/<code> lowercased", () => {
    expect(buildShortReferralLink("PRIME")).toBe("https://leadprime.chyrris.com/ref/prime");
  });

  it("NO usa /r/ — ese prefijo lo ocupa ReviewPilot y devuelve 404", () => {
    // El bug exacto: un código de socio entraba por /r/, el buscador de reseñas
    // no lo encontraba y la página moría en "Enlace no válido".
    expect(buildShortReferralLink("PRIME")).not.toMatch(/\/r\/[^/]+$/);
  });

  it("uses the admin-configured base and trims trailing slashes", () => {
    expect(buildShortReferralLink("PRIME", "https://lp.example.com/")).toBe("https://lp.example.com/ref/prime");
  });

  it("attributes case-insensitively — short /ref/prime resolves the same as ?ref=PRIME", () => {
    // Both links carry the code; the engine's findPartnerByCode compares
    // case-insensitively, so the lowercased short link resolves PRIME.
    expect(buildShortReferralLink("prime")).toBe(buildShortReferralLink("PRIME"));
  });
});

describe("hostname isolation (partners.chyrris.com vs kai.chyrris.com)", () => {
  it("partner host never resolves admin sessions", () => {
    const req = fakeReq("partners.chyrris.com");
    expect(isPartnerHost(req)).toBe(true);
    expect(allowAdminSession(req)).toBe(false);
    expect(allowPartnerSession(req)).toBe(true);
  });

  it("admin host never resolves partner sessions", () => {
    const req = fakeReq("kai.chyrris.com");
    expect(isPartnerHost(req)).toBe(false);
    expect(isNeutralHost(req)).toBe(false);
    expect(allowAdminSession(req)).toBe(true);
    expect(allowPartnerSession(req)).toBe(false);
  });

  it("localhost is neutral so local dev keeps both areas working", () => {
    const req = fakeReq("localhost");
    expect(isNeutralHost(req)).toBe(true);
    expect(allowAdminSession(req)).toBe(true);
    expect(allowPartnerSession(req)).toBe(true);
  });

  it("partners.* preview subdomains count as partner host", () => {
    expect(isPartnerHost(fakeReq("partners.up.railway.app"))).toBe(true);
  });
});
