/**
 * E2E validation of the partner ADMIN management: edit partner, safe delete,
 * and the R2 storage wiring — against TEST databases via the real tRPC router.
 *
 *   pnpm exec tsx scripts/validate-partner-admin-e2e.ts
 *
 * ⚠️ WRITES DATA — point ONLY at disposable test databases.
 */
process.env.AUTH_DATABASE_URL =
  process.env.E2E_KAI_DB_URL || "postgresql://postgres@127.0.0.1:55432/kai_test?sslmode=disable";
process.env.DATABASE_URL = process.env.AUTH_DATABASE_URL;
process.env.LEADPRIME_DATABASE_URL =
  process.env.E2E_LEADPRIME_DB_URL || "postgresql://postgres@127.0.0.1:55432/leadprime_test?sslmode=disable";
delete process.env.RESEND_API_KEY;
delete process.env.STRIPE_SECRET_KEY;

import { and, eq, sql } from "drizzle-orm";

async function main() {
  const { ensurePartnerTables } = await import("../server/partner/ensure-tables");
  const { getDb } = await import("../server/db");
  const schema = await import("../drizzle/schema");
  const { appRouter } = await import("../server/routers");
  const auth = await import("../server/partner/partner-auth");

  const results: Array<[string, boolean, string]> = [];
  const check = (name: string, ok: boolean, detail = "") => {
    results.push([name, ok, detail]);
    console.log(`${ok ? "✅" : "❌"} ${name}${detail ? ` — ${detail}` : ""}`);
  };

  await ensurePartnerTables();
  const db = (await getDb())!;
  await db.execute(sql`
    TRUNCATE partner_invitations, partner_sessions, partner_auth_codes, partner_documents,
             referral_commissions, referral_payouts, referral_attributions,
             referral_partners RESTART IDENTITY CASCADE`);

  // Admin caller — mirrors a logged-in Kai admin (protectedProcedure).
  const adminCtx: any = {
    req: { cookies: {}, headers: {}, ip: "127.0.0.1", socket: { remoteAddress: "127.0.0.1" } },
    res: { cookie: () => {}, clearCookie: () => {} },
    user: { id: 1, email: "admin@chyrris.com", role: "admin", isActive: true },
    partner: null,
    isPartnerHost: false,
  };
  const admin = appRouter.createCaller(adminCtx);

  // ── 1. Create two partners ──
  const created = await admin.partnerAdmin.create({
    name: "John connor",
    contactEmail: "mervin@owlfenc.com",
    referralCode: "JOHN",
    tierYear1Pct: 20,
    tierYear2Pct: 10,
    freeAccountThreshold: 10,
  });
  const johnId = created.partner.id;
  const simba = await admin.partnerAdmin.create({
    name: "sanchez godoy",
    contactEmail: "simba@test.com",
    referralCode: "SIMBA",
    tierYear1Pct: 20,
    tierYear2Pct: 10,
    freeAccountThreshold: 10,
  });
  check("Socios de prueba creados (John connor + SIMBA)", !!johnId && !!simba.partner.id);

  // ── 2. EDIT: the real use case — fix name/email/phone/tiers ──
  const edited = await admin.partnerAdmin.update({
    partnerId: johnId,
    name: "John Connor",
    contactName: "John Connor",
    contactEmail: "john@primecontractors.edu",
    contactPhone: "+15550001111",
    tierYear1Pct: 25,
    tierYear2Pct: 12.5,
    freeAccountThreshold: 8,
  });
  const johnRow = () =>
    db.select().from(schema.referralPartners).where(eq(schema.referralPartners.id, johnId)).limit(1).then(r => r[0]!);
  const john = await johnRow();
  check("Editar socio guarda nombre, email, teléfono y tarifas",
    john.name === "John Connor" && john.contactEmail === "john@primecontractors.edu" &&
    john.contactPhone === "+15550001111" && parseFloat(john.tierYear1Pct) === 25 &&
    parseFloat(john.tierYear2Pct) === 12.5 && john.freeAccountThreshold === 8,
    `${john.name} <${john.contactEmail}> ${parseFloat(john.tierYear1Pct)}/${parseFloat(john.tierYear2Pct)}`);
  check("Editar reporta que el email de login cambió", edited.emailChanged === true);

  // ── 3. EDIT + AUTH: the login moves to the new email ──
  // Old email must no longer resolve a login; new one must.
  await auth.requestPartnerOtp("mervin@owlfenc.com");
  const codesAfterOldEmail = await db
    .select().from(schema.partnerAuthCodes).where(eq(schema.partnerAuthCodes.partnerId, johnId));
  check("El email VIEJO ya no puede pedir código (login movido)", codesAfterOldEmail.length === 0);
  await auth.requestPartnerOtp("john@primecontractors.edu");
  const codesAfterNewEmail = await db
    .select().from(schema.partnerAuthCodes).where(eq(schema.partnerAuthCodes.partnerId, johnId));
  check("El email NUEVO sí genera código de acceso", codesAfterNewEmail.length === 1);

  // Changing the email again must burn pending codes + sessions (security).
  await db.insert(schema.partnerSessions).values({
    id: "sess_before_email_change_000000", partnerId: johnId,
    expiresAt: new Date(Date.now() + 86400000),
  });
  await admin.partnerAdmin.update({ partnerId: johnId, contactEmail: "john.connor@primecontractors.edu" });
  const codesAfter = await db.select().from(schema.partnerAuthCodes).where(eq(schema.partnerAuthCodes.partnerId, johnId));
  const sessionsAfter = await db.select().from(schema.partnerSessions).where(eq(schema.partnerSessions.partnerId, johnId));
  check("Cambiar email invalida códigos OTP pendientes y sesiones activas",
    codesAfter.length === 0 && sessionsAfter.length === 0,
    `codes=${codesAfter.length} sessions=${sessionsAfter.length}`);

  // ── 4. EDIT: email/code duplicates rejected ──
  const dupEmail = await admin.partnerAdmin
    .update({ partnerId: johnId, contactEmail: "simba@test.com" })
    .then(() => "no-throw").catch((e: any) => e.message);
  check("Email duplicado rechazado al editar", dupEmail !== "no-throw", String(dupEmail).slice(0, 45));

  // ── 5. EDIT: referral code — free while no referrals, frozen once attributed ──
  const codeChanged = await admin.partnerAdmin.update({ partnerId: johnId, referralCode: "CONNOR" });
  check("Código editable mientras el socio NO tiene referidos",
    codeChanged.partner!.referralCode === "CONNOR");

  // Attribute a referral, then the code must freeze.
  const { createAttribution } = await import("../server/partner/commission-engine");
  const attr = await createAttribution({ referralCode: "CONNOR", referredUserId: "ctr_ref_pays" });
  check("Atribución creada con el código nuevo", attr.success && attr.created);

  const frozen = await admin.partnerAdmin
    .update({ partnerId: johnId, referralCode: "OTRO" })
    .then(() => "no-throw").catch((e: any) => e.message);
  check("Código BLOQUEADO una vez que el socio tiene referidos",
    frozen !== "no-throw" && /referidos/i.test(String(frozen)), String(frozen).slice(0, 60));

  // Editing other fields must still work with referrals present.
  await admin.partnerAdmin.update({ partnerId: johnId, name: "John Connor Institute" });
  check("Con referidos, el resto de campos sigue editable", (await johnRow()).name === "John Connor Institute");

  // ── 6. Attribution integrity: attributions survive an edit ──
  const attrRows = await db.select().from(schema.referralAttributions)
    .where(eq(schema.referralAttributions.partnerId, johnId));
  check("Las atribuciones existentes siguen ligadas al socio tras editar",
    attrRows.length === 1 && attrRows[0]!.referredUserId === "ctr_ref_pays");

  // ── 7. DELETE: partner WITHOUT financial history → hard delete ──
  const simbaId = simba.partner.id;
  await db.insert(schema.partnerDocuments).values({
    partnerId: simbaId, docType: "report", title: "Reporte de prueba",
    fileName: "x.pdf", fileUrl: "partner-documents/x", status: "verified",
    uploadedBy: "admin", uploadedAt: new Date(),
  });
  const delSimba = await admin.partnerAdmin.remove({ partnerId: simbaId });
  const simbaGone = await db.select().from(schema.referralPartners).where(eq(schema.referralPartners.id, simbaId));
  const simbaDocs = await db.select().from(schema.partnerDocuments).where(eq(schema.partnerDocuments.partnerId, simbaId));
  check("SIMBA (sin historial financiero) se elimina por completo + cascada de documentos",
    delSimba.mode === "deleted" && simbaGone.length === 0 && simbaDocs.length === 0,
    `mode=${delSimba.mode}`);

  // ── 8. DELETE: partner WITH financial history → archived, history preserved ──
  await db.insert(schema.referralCommissions).values({
    partnerId: johnId, attributionId: attrRows[0]!.id, sourcePaymentId: "lp-inv:hist1",
    chargeAmount: "150.00", appliedPct: "25.00", commissionAmount: "37.50",
    chargeDate: new Date(), isReversal: false,
  });
  await db.insert(schema.partnerSessions).values({
    id: "sess_before_archive_0000000000", partnerId: johnId,
    expiresAt: new Date(Date.now() + 86400000),
  });
  const delJohn = await admin.partnerAdmin.remove({ partnerId: johnId });
  const johnAfter = await db.select().from(schema.referralPartners).where(eq(schema.referralPartners.id, johnId));
  const commissionsAfter = await db.select().from(schema.referralCommissions)
    .where(eq(schema.referralCommissions.partnerId, johnId));
  const sessionsAfterArchive = await db.select().from(schema.partnerSessions)
    .where(eq(schema.partnerSessions.partnerId, johnId));
  check("Socio CON comisiones NO se borra: se archiva como inactivo",
    delJohn.mode === "archived" && johnAfter.length === 1 && johnAfter[0]!.status === "inactive",
    `mode=${delJohn.mode} status=${johnAfter[0]?.status}`);
  check("El historial financiero se conserva al archivar", commissionsAfter.length === 1);
  check("Archivar revoca el acceso al portal (sesiones borradas)", sessionsAfterArchive.length === 0);
  const archivedLogin = await auth.requestPartnerOtp("john.connor@primecontractors.edu");
  const codesArchived = await db.select().from(schema.partnerAuthCodes)
    .where(eq(schema.partnerAuthCodes.partnerId, johnId));
  check("Un socio archivado ya no puede pedir código de acceso",
    codesArchived.length === 0 && archivedLogin.success === true);

  // ── 9. Storage: partner documents point at R2 keys and get presigned ──
  const storage = await import("../server/storage");
  check("El storage ya NO exige credenciales Forge (mensaje R2 claro)",
    !storage.isStorageConfigured(),
    "sin credenciales R2 en este entorno de prueba (esperado)");
  const storageErr = await storage.storagePut("partner-documents/1/x.pdf", Buffer.from("x"))
    .then(() => "no-throw").catch((e: any) => e.message);
  check("Error de storage nombra las variables R2 que faltan (no BUILT_IN_FORGE_*)",
    /R2_/.test(String(storageErr)) && !/FORGE/i.test(String(storageErr)),
    String(storageErr).slice(0, 70));
  check("El bucket por defecto es leadprime-documents", storage.getBucketName() === "leadprime-documents");

  // ── Summary ──
  const failed = results.filter(r => !r[1]);
  console.log(`\n══════ ADMIN: ${results.length - failed.length}/${results.length} checks OK ══════`);
  if (failed.length) {
    failed.forEach(f => console.log(`FALLÓ: ${f[0]} — ${f[2]}`));
    process.exit(1);
  }
  process.exit(0);
}

main().catch(err => {
  console.error("FATAL:", err);
  process.exit(1);
});
