/**
 * E2E validation of the Partner Portal (brief §9) against TEST databases.
 *
 *   pnpm exec tsx scripts/validate-partner-portal-e2e.ts
 *
 * ⚠️ WRITES DATA (creates partners/attributions/commissions) — point it ONLY
 * at disposable test databases, NEVER at production. Set E2E_KAI_DB_URL and
 * E2E_LEADPRIME_DB_URL, and seed the LeadPrime mock first with
 * scripts/seed-leadprime-mock.sql (production table names/columns).
 */
process.env.AUTH_DATABASE_URL =
  process.env.E2E_KAI_DB_URL || "postgresql://postgres@127.0.0.1:55432/kai_test?sslmode=disable";
process.env.DATABASE_URL = process.env.AUTH_DATABASE_URL;
process.env.LEADPRIME_DATABASE_URL =
  process.env.E2E_LEADPRIME_DB_URL || "postgresql://postgres@127.0.0.1:55432/leadprime_test?sslmode=disable";
delete process.env.RESEND_API_KEY; // emails no-op in this run
delete process.env.STRIPE_SECRET_KEY;

import { eq, sql } from "drizzle-orm";

async function main() {
  const { ensurePartnerTables } = await import("../server/partner/ensure-tables");
  const { getDb } = await import("../server/db");
  const schema = await import("../drizzle/schema");
  const engine = await import("../server/partner/commission-engine");
  const auth = await import("../server/partner/partner-auth");
  const pdb = await import("../server/partner/partner-db");

  const results: Array<[string, boolean, string]> = [];
  const check = (name: string, ok: boolean, detail = "") => {
    results.push([name, ok, detail]);
    console.log(`${ok ? "✅" : "❌"} ${name}${detail ? ` — ${detail}` : ""}`);
  };

  // ── 1. Bootstrap tables ──
  await ensurePartnerTables();
  const db = (await getDb())!;
  // Re-runnable: wipe ONLY the portal's own tables (test DBs, see header).
  await db.execute(sql`
    TRUNCATE partner_sessions, partner_auth_codes, partner_documents,
             referral_commissions, referral_payouts, referral_attributions,
             referral_partners RESTART IDENTITY CASCADE`);
  const tables = await db.execute(sql`SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY 1`);
  const names = (tables.rows as any[]).map(r => r.table_name);
  check("Tablas referral_* creadas (idempotente)",
    ["referral_partners","partner_documents","referral_attributions","referral_commissions","referral_payouts","partner_auth_codes","partner_sessions"].every(t => names.includes(t)),
    names.filter(n => n.startsWith("referral") || n.startsWith("partner")).join(", "));
  await ensurePartnerTables(); // second run must not throw
  check("Segundo bootstrap no falla (IF NOT EXISTS)", true);

  // ── 2. Create two partners (multi-tenant test needs A and B) ──
  const [prime] = await db.insert(schema.referralPartners).values({
    name: "Prime Contractors License Institute Inc.",
    referralCode: "PRIME",
    contactName: "Director Prime",
    contactEmail: "socios@primecontractors.edu",
    contactPhone: "+15550001111",
  }).returning();
  const [other] = await db.insert(schema.referralPartners).values({
    name: "Otra Escuela de Licencias",
    referralCode: "ESCUELA2",
    contactEmail: "admin@escuela2.com",
  }).returning();
  check("Socios creados con defaults del term sheet",
    prime!.tierYear1Pct === "20.00" && prime!.tierYear2Pct === "10.00" && prime!.freeAccountThreshold === 10 && prime!.status === "invited",
    `PRIME id=${prime!.id} 20/10/10 invited · ESCUELA2 id=${other!.id}`);

  // Duplicate code must fail (UNIQUE)
  let dupFailed = false;
  try {
    await db.insert(schema.referralPartners).values({ name: "Dup", referralCode: "PRIME", contactEmail: "dup@x.com" });
  } catch { dupFailed = true; }
  check("Código de referido duplicado rechazado (UNIQUE)", dupFailed);

  // ── 3. OTP flow ──
  const neutral1 = await auth.requestPartnerOtp("socios@primecontractors.edu");
  const neutral2 = await auth.requestPartnerOtp("noexiste@nadie.com");
  check("OTP: respuesta neutra idéntica exista o no el email",
    neutral1.message === neutral2.message, JSON.stringify(neutral1.message));

  const codes = await db.select().from(schema.partnerAuthCodes).where(eq(schema.partnerAuthCodes.partnerId, prime!.id));
  check("OTP: código guardado HASHEADO (bcrypt, no plaintext)",
    codes.length === 1 && codes[0]!.code.startsWith("$2") && codes[0]!.code.length > 50,
    codes[0]!.code.slice(0, 12) + "…");
  const expiryMin = Math.round((codes[0]!.expiresAt.getTime() - codes[0]!.createdAt.getTime()) / 60000);
  check("OTP: expiración de 10 minutos", expiryMin === 10, `${expiryMin} min`);

  // Wrong code rejected + attempts counted
  const bad = await auth.verifyPartnerOtp("socios@primecontractors.edu", "000000");
  const afterBad = await db.select().from(schema.partnerAuthCodes).where(eq(schema.partnerAuthCodes.id, codes[0]!.id));
  check("OTP: código incorrecto rechazado y cuenta intento", !bad.success && afterBad[0]!.attempts === 1);

  // Correct code: plant a known bcrypt hash to simulate reading the email
  const adminSessionsBefore = await db.execute(
    sql`SELECT COALESCE((SELECT COUNT(*) FROM admin_sessions), 0) AS count
        WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'admin_sessions')`
  );
  const bcrypt = (await import("bcryptjs")).default;
  const knownHash = await bcrypt.hash("123456", 10);
  await db.update(schema.partnerAuthCodes).set({ code: knownHash }).where(eq(schema.partnerAuthCodes.id, codes[0]!.id));
  const good = await auth.verifyPartnerOtp("socios@primecontractors.edu", "123456", "127.0.0.1", "validation-script");
  check("OTP: código correcto crea sesión de socio", good.success && !!good.sessionId, `session=${good.sessionId?.slice(0, 8)}…`);

  const activated = await db.select().from(schema.referralPartners).where(eq(schema.referralPartners.id, prime!.id));
  check("Primer login activa al socio (invited → active)", activated[0]!.status === "active");

  const reused = await auth.verifyPartnerOtp("socios@primecontractors.edu", "123456");
  check("OTP: código usado no se puede reutilizar", !reused.success);

  const partnerFromSession = await auth.validatePartnerSession(good.sessionId!);
  check("Sesión de socio valida y devuelve al socio", partnerFromSession?.id === prime!.id);
  const adminSessionsAfter = await db.execute(
    sql`SELECT COALESCE((SELECT COUNT(*) FROM admin_sessions), 0) AS count
        WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'admin_sessions')`
  );
  check(
    "La sesión de socio NO toca admin_sessions (separación)",
    Number((adminSessionsAfter.rows[0] as any)?.count ?? 0) ===
      Number((adminSessionsBefore.rows[0] as any)?.count ?? 0)
  );

  // Rate limit: 5/hour
  for (let i = 0; i < 6; i++) await auth.requestPartnerOtp("socios@primecontractors.edu");
  const allCodes = await db.select().from(schema.partnerAuthCodes).where(eq(schema.partnerAuthCodes.partnerId, prime!.id));
  check("Rate limit: máx 5 códigos por email por hora", allCodes.length === 5, `${allCodes.length} códigos en la última hora`);

  // ── 4. Attribution ──
  // 4a. Via public endpoint logic (?ref= capture path)
  const attr1 = await engine.createAttribution({ referralCode: "prime", referredUserId: "ctr_ref_pays" });
  check("Atribución vía endpoint (código case-insensitive)", attr1.success && attr1.created);
  const attrDup = await engine.createAttribution({ referralCode: "PRIME", referredUserId: "ctr_ref_pays" });
  check("Atribución duplicada es no-op (UNIQUE referred_user_id)", attrDup.success && !attrDup.created);
  const attrBadCode = await engine.createAttribution({ referralCode: "NOEXISTE", referredUserId: "ctr_ref_nopay" });
  check("Código inválido no crea atribución", !attrBadCode.success);
  const attrGhost = await engine.createAttribution({ referralCode: "PRIME", referredUserId: "ctr_fantasma" });
  check("Usuario inexistente en LeadPrime no crea atribución", !attrGhost.success);

  // 4b. Sweep from contractors.referral_code (the rest of the seeded users)
  const sync1 = await engine.syncReferralSystem();
  check("Sweep de signups con referral_code crea el resto de atribuciones",
    sync1.attributionsCreated >= 3, `+${sync1.attributionsCreated} (nopay, year2, cancel)`);

  const attrs = await db.select().from(schema.referralAttributions);
  const byUser = new Map(attrs.map(a => [a.referredUserId, a]));
  check("Usuario orgánico (sin código) NO tiene atribución", !byUser.has("ctr_organic"));
  check("Registro con código empieza pending_first_payment con first_payment_date NULL",
    !!byUser.get("ctr_ref_nopay") && byUser.get("ctr_ref_nopay")!.status === "pending_first_payment" && byUser.get("ctr_ref_nopay")!.firstPaymentDate === null);

  // ── 5. Commission engine (charges swept in the same sync) ──
  const commissions = await db.select().from(schema.referralCommissions);
  const forUser = (id: string) => commissions.filter(c => c.attributionId === byUser.get(id)?.id);

  const paysAttr = byUser.get("ctr_ref_pays")!;
  check("Primer cobro llena first_payment_date y activa la atribución",
    paysAttr.status === "active" && paysAttr.firstPaymentDate?.toISOString().startsWith("2026-06-05"),
    `first_payment=${paysAttr.firstPaymentDate?.toISOString().slice(0, 10)}`);

  const paysComms = forUser("ctr_ref_pays");
  const inv1 = paysComms.find(c => c.sourcePaymentId === "lp-inv:in_test_001");
  const wtx = paysComms.find(c => c.sourcePaymentId.startsWith("lp-wtx:"));
  check("Comisión 20% sobre invoice de $150 → $30",
    inv1?.appliedPct === "20.00" && inv1?.commissionAmount === "30.00" && inv1?.chargeAmount === "150.00");
  check("Top-up real de wallet ($50) genera comisión; subscription_recharge NO",
    paysComms.length === 3 && wtx?.commissionAmount === "10.00",
    `${paysComms.length} comisiones (2 invoices + 1 top-up)`);

  check("Usuario orgánico que paga NO genera comisión",
    commissions.every(c => byUser.get("ctr_organic")?.id === undefined || c.attributionId !== byUser.get("ctr_organic")?.id));
  check("Referido sin pago NO genera comisión", forUser("ctr_ref_nopay").length === 0);

  const y2 = forUser("ctr_ref_year2");
  const y2first = y2.find(c => c.sourcePaymentId === "lp-inv:in_test_010");
  const y2late = y2.find(c => c.sourcePaymentId === "lp-inv:in_test_011");
  check("Cobro dentro de 12 meses → 20%; después de 12 meses → 10%",
    y2first?.appliedPct === "20.00" && y2late?.appliedPct === "10.00",
    `2025-05 @20% ($100.00) · 2026-07 @10% ($50.00 de $500)`);
  check("Comisión año 2 calculada: 10% de $500 = $50", y2late?.commissionAmount === "50.00");

  check("Usuario cancelado → atribución inactive (comisiones previas se conservan)",
    byUser.get("ctr_ref_cancel")!.status === "inactive" && forUser("ctr_ref_cancel").length === 1,
    `status=${byUser.get("ctr_ref_cancel")!.status}, comisiones=${forUser("ctr_ref_cancel").length}`);

  // Idempotency: run sync again → zero new rows
  const sync2 = await engine.syncReferralSystem();
  check("Sync idempotente: segunda corrida no duplica nada",
    sync2.commissionsCreated === 0 && sync2.attributionsCreated === 0);

  // ── 6. Refund reversal (manual path; Stripe path needs live key) ──
  const reversal = await pdb.adminReverseCommission(inv1!.id, "Reembolso de prueba");
  check("Reembolso → fila negativa compensatoria (is_reversal)",
    reversal.commissionAmount === "-30.00" && reversal.isReversal === true);
  let secondReversalBlocked = false;
  try { await pdb.adminReverseCommission(inv1!.id, "otra vez"); } catch { secondReversalBlocked = true; }
  check("Doble reversión bloqueada (UNIQUE source+is_reversal)", secondReversalBlocked);

  // ── 7. Partner dashboard + multi-tenant isolation ──
  const primeRow = (await db.select().from(schema.referralPartners).where(eq(schema.referralPartners.id, prime!.id)))[0]!;
  const dash = await pdb.getPartnerDashboard(primeRow);
  check("KPIs del dashboard: 4 referidos, 2 activos",
    dash.kpis.totalReferrals === 4 && dash.kpis.activePaying === 2,
    `total=${dash.kpis.totalReferrals} activos=${dash.kpis.activePaying} pendientes=${dash.kpis.pendingFirstPayment}`);
  // Sum check vs direct SQL (brief §9: dashboard total == query directa)
  const directSum = await db.execute(sql`SELECT COALESCE(SUM(commission_amount),0)::numeric(12,2)::text AS total FROM referral_commissions WHERE partner_id = ${prime!.id}`);
  check("Suma del dashboard coincide con query directa en la DB",
    dash.kpis.commissionAllTime === (directSum.rows[0] as any).total,
    `dashboard=${dash.kpis.commissionAllTime} sql=${(directSum.rows[0] as any).total}`);
  check("Link de referido correcto",
    dash.referralLink === "https://leadprime.chyrris.com/signup?ref=PRIME", dash.referralLink);
  check("Tarjeta cuenta gratis: 2 de 10", dash.freeAccount.current === 2 && dash.freeAccount.threshold === 10);

  const referralRows = await pdb.getPartnerReferrals(primeRow);
  const sample = JSON.stringify(referralRows);
  check("Tabla de referidos SIN datos sensibles (sin email/teléfono/ids de pago)",
    !sample.includes("@") && !sample.includes("phone") && referralRows.every(r => (r as any).referredUserId === undefined),
    `campos: ${Object.keys(referralRows[0] ?? {}).join(",")}`);

  const otherRow = (await db.select().from(schema.referralPartners).where(eq(schema.referralPartners.id, other!.id)))[0]!;
  const otherDash = await pdb.getPartnerDashboard(otherRow);
  const otherRefs = await pdb.getPartnerReferrals(otherRow);
  check("AISLAMIENTO: socio B ve 0 referidos y $0.00 (los datos de PRIME no se filtran)",
    otherDash.kpis.totalReferrals === 0 && otherDash.kpis.commissionAllTime === "0.00" && otherRefs.length === 0);
  const otherDocUrl = await pdb.getPartnerDocumentUrl(other!.id, 99999);
  check("AISLAMIENTO: socio B no puede leer documentos por ID ajeno", otherDocUrl === null);

  // ── 8. Onboarding gate ──
  const ob1 = await pdb.getOnboardingState(primeRow);
  check("Onboarding inicia 0/4, dashboard bloqueado", ob1.completedCount === 0 && !ob1.complete);
  // Complete the 4 steps (docs directly — upload path needs the storage proxy)
  await db.insert(schema.partnerDocuments).values([
    { partnerId: prime!.id, docType: "contract", status: "verified", fileName: "contrato.pdf", uploadedAt: new Date(), verifiedAt: new Date() },
    { partnerId: prime!.id, docType: "w9", status: "uploaded", fileName: "w9.pdf", uploadedAt: new Date() },
    { partnerId: prime!.id, docType: "ach_authorization", status: "uploaded", fileName: "ach.pdf", uploadedAt: new Date() },
  ]);
  await db.update(schema.referralPartners).set({ contactConfirmedAt: new Date() }).where(eq(schema.referralPartners.id, prime!.id));
  const primeRow2 = (await db.select().from(schema.referralPartners).where(eq(schema.referralPartners.id, prime!.id)))[0]!;
  const ob2 = await pdb.getOnboardingState(primeRow2);
  const primeRow3 = (await db.select().from(schema.referralPartners).where(eq(schema.referralPartners.id, prime!.id)))[0]!;
  check("Onboarding 4/4 → onboarding_complete persiste y desbloquea",
    ob2.complete && primeRow3.onboardingComplete === true, `${ob2.completedCount}/4`);

  // ── 9. Payout ──
  const payout = await pdb.adminGeneratePayout({
    partnerId: prime!.id,
    periodStart: new Date("2025-01-01"),
    periodEnd: new Date("2026-12-31"),
    method: "ACH",
  });
  // pending before payout: 30+30+10+30+100+50-30(reversal) = 220.00
  check("Liquidación suma pendientes netos (reversiones incluidas)",
    payout.payout.totalAmount === "220.00" && payout.commissionCount === 7,
    `total=${payout.payout.totalAmount} (${payout.commissionCount} filas)`);
  await pdb.adminMarkPayoutPaid(payout.payout.id, "ACH");
  const paidComms = await db.select().from(schema.referralCommissions).where(eq(schema.referralCommissions.payoutId, payout.payout.id));
  check("Marcar pagada propaga payout_status a las comisiones",
    paidComms.every(c => c.payoutStatus === "paid"));

  // ── Summary ──
  const failed = results.filter(r => !r[1]);
  console.log(`\n══════ RESULTADO: ${results.length - failed.length}/${results.length} checks OK ══════`);
  if (failed.length) {
    failed.forEach(f => console.log(`FALLÓ: ${f[0]}`));
    process.exit(1);
  }
  process.exit(0);
}

main().catch(err => {
  console.error("FATAL:", err);
  process.exit(1);
});
