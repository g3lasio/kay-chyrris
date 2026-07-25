/**
 * E2E validation of the Partner Portal ENHANCEMENTS (staged onboarding, admin
 * informational docs, enriched dashboard, consent invitations, links/settings)
 * against TEST databases. WRITES DATA — point ONLY at disposable test DBs.
 *
 *   pnpm exec tsx scripts/validate-partner-enhancements-e2e.ts
 *
 * Requires the LeadPrime mock seeded (scripts/seed-leadprime-mock.sql).
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
  const engine = await import("../server/partner/commission-engine");
  const pdb = await import("../server/partner/partner-db");
  const inv = await import("../server/partner/partner-invitations");
  const settings = await import("../server/partner/app-settings");

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
  await db.execute(sql`DELETE FROM app_settings`);

  // ── 0. Schema bootstrap (new objects) ──
  const cols = await db.execute(sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_name='partner_documents' AND column_name='uploaded_by'`);
  const matCol = await db.execute(sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_name='referral_partners' AND column_name='materials_reviewed_at'`);
  const invTable = await db.execute(sql`
    SELECT table_name FROM information_schema.tables WHERE table_name='partner_invitations'`);
  const enumVals = await db.execute(sql`
    SELECT enumlabel FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid WHERE t.typname='partner_doc_type'`);
  const labels = (enumVals.rows as any[]).map(r => r.enumlabel);
  check("Bootstrap v2: columnas/tablas/enum nuevos existen",
    cols.rows.length === 1 && matCol.rows.length === 1 && invTable.rows.length === 1 &&
    ["revenue_projection", "features", "term_sheet_info", "term_sheet_signed"].every(v => labels.includes(v)),
    `doc_type: ${labels.filter((l: string) => l.includes("_")).join(",")}`);
  await ensurePartnerTables(); // second boot must not throw
  check("Segundo bootstrap v2 no falla (idempotente)", true);

  // ── 1. Two partners (A=PRIME so mock contractors attribute to A) ──
  const [pa] = await db.insert(schema.referralPartners).values({
    name: "Prime Contractors License Institute Inc.",
    referralCode: "PRIME",
    contactEmail: "socios@primecontractors.edu",
    status: "active",
  }).returning();
  const [pb] = await db.insert(schema.referralPartners).values({
    name: "Otra Escuela",
    referralCode: "ESCUELA2",
    contactEmail: "admin@escuela2.com",
    status: "active",
  }).returning();

  // ── 2. Admin uploads an INFORMATIONAL doc for A only ──
  // (storeDocument needs the storage proxy; insert the row directly to mirror it.)
  await db.insert(schema.partnerDocuments).values({
    partnerId: pa!.id,
    docType: "revenue_projection",
    fileName: "proyeccion.pdf",
    fileUrl: "partner-documents/1/revenue_projection/proyeccion.pdf",
    status: "verified",
    uploadedBy: "admin",
    uploadedAt: new Date(),
    verifiedAt: new Date(),
  });

  const aRow = () => db.select().from(schema.referralPartners).where(eq(schema.referralPartners.id, pa!.id)).limit(1).then(r => r[0]!);
  let ob = await pdb.getOnboardingState(await aRow());
  check("Etapa 1: materiales presentes pero aún NO revisados (bloquea etapa 2)",
    ob.stages.materials.materialsCount === 1 && !ob.stages.materials.done && ob.currentStage === 1,
    `materiales=${ob.stages.materials.materialsCount}, etapa=${ob.currentStage}`);

  // Multi-tenant isolation: B does not see A's informational doc.
  const bDocs = await pdb.listPartnerDocuments(pb!.id);
  check("AISLAMIENTO: socio B no ve el documento informativo de A", bDocs.length === 0);
  const bOb = await pdb.getOnboardingState(pb!);
  check("AISLAMIENTO: onboarding de B no cuenta materiales de A", bOb.stages.materials.materialsCount === 0);

  // ── 3. Staged progression ──
  await pdb.markMaterialsReviewed(pa!.id);
  ob = await pdb.getOnboardingState(await aRow());
  check("Etapa 1 completada → desbloquea etapa 2 (currentStage=2)",
    ob.stages.materials.done && ob.currentStage === 2);

  // Signed docs (term sheet + contract) → stage 2.
  for (const docType of ["term_sheet_signed", "contract"] as const) {
    await db.insert(schema.partnerDocuments).values({
      partnerId: pa!.id, docType, fileName: `${docType}.pdf`,
      fileUrl: `x/${docType}`, status: "uploaded", uploadedBy: "partner", uploadedAt: new Date(),
    });
  }
  ob = await pdb.getOnboardingState(await aRow());
  check("Etapa 2: term sheet + contrato firmados → desbloquea etapa 3",
    ob.stages.signed.done && ob.currentStage === 3);

  // Stage 3: ACH + contact.
  await db.insert(schema.partnerDocuments).values({
    partnerId: pa!.id, docType: "ach_authorization", fileName: "ach.pdf",
    fileUrl: "x/ach", status: "uploaded", uploadedBy: "partner", uploadedAt: new Date(),
  });
  await db.update(schema.referralPartners).set({ contactConfirmedAt: new Date() }).where(eq(schema.referralPartners.id, pa!.id));
  ob = await pdb.getOnboardingState(await aRow());
  const aAfter = await aRow();
  check("Etapa 3: ACH + contacto → onboarding COMPLETO y persistido",
    ob.complete && ob.currentStage === 4 && aAfter.onboardingComplete === true,
    `completadas=${ob.completedStages}/3`);

  // ── 4. Enriched dashboard: attribute + charges, then check plan cost + est. date ──
  await engine.createAttribution({ referralCode: "PRIME", referredUserId: "ctr_ref_pays" });
  await engine.createAttribution({ referralCode: "PRIME", referredUserId: "ctr_ref_nopay" });
  await engine.syncReferralSystem();

  const refs = await pdb.getPartnerReferrals(await aRow());
  const pays = refs.find(r => r.business === "Roofers Pro LLC");
  const nopay = refs.find(r => r.business === "PaintCo");
  check("Dashboard enriquecido: referido activo trae plan + costo mensual",
    !!pays && pays.status === "active" && pays.plan === "network_elite" && pays.planCost === "150.00",
    `plan=${pays?.plan} costo=${pays?.planCost}`);
  check("Dashboard enriquecido: referido pendiente muestra 1ª comisión estimada (~35 días)",
    !!nopay && nopay.status === "pending_first_payment" && nopay.estimatedCommissionStart != null &&
    Math.abs(
      (nopay.estimatedCommissionStart!.getTime() - nopay.signupDate.getTime()) / (24 * 3600 * 1000) - 35
    ) < 1,
    `est=${nopay?.estimatedCommissionStart?.toISOString().slice(0, 10)}`);

  // Monthly income history: 12 continuous points, sum equals all-time commissions.
  const history = await pdb.getMonthlyIncomeHistory(pa!.id);
  const histSum = history.reduce((a, p) => a + parseFloat(p.amount), 0).toFixed(2);
  const directSum = await db.execute(
    sql`SELECT COALESCE(SUM(commission_amount),0)::numeric(12,2)::text AS t
        FROM referral_commissions WHERE partner_id=${pa!.id}
        AND charge_date >= date_trunc('month', NOW()) - INTERVAL '11 months'`);
  check("Historial mensual: 12 puntos y suma cuadra con query directa (últimos 12m)",
    history.length === 12 && histSum === (directSum.rows[0] as any).t,
    `puntos=${history.length}, hist=${histSum}, sql=${(directSum.rows[0] as any).t}`);

  // ── 5. Consent invitations ──
  const settingsMode = await settings.getPortalSettings();
  const invRes = await inv.createInvitation(await aRow(), "juan@rooferspro.com");
  check("Invitación creada en modo auto → status 'sent'",
    invRes.success && invRes.status === "sent" && settingsMode.invitationMode === "auto");

  // Self-invite blocked.
  const selfInv = await inv.createInvitation(await aRow(), "socios@primecontractors.edu");
  check("No puede invitarse a sí mismo", !selfInv.success);

  // Duplicate blocked.
  const dupInv = await inv.createInvitation(await aRow(), "juan@rooferspro.com");
  check("Invitación duplicada bloqueada", !dupInv.success);

  const aInvites = await inv.listPartnerInvitations(pa!.id);
  const bInvites = await inv.listPartnerInvitations(pb!.id);
  check("AISLAMIENTO: socio B no ve las invitaciones de A", aInvites.length === 1 && bInvites.length === 0);

  // Redirect resolves to A's ref link.
  const invRow = await db.select().from(schema.partnerInvitations).where(eq(schema.partnerInvitations.partnerId, pa!.id)).limit(1);
  const redirect = await inv.resolveInvitationRedirect(invRow[0]!.token);
  check("Enlace de invitación redirige al signup con ?ref del socio",
    redirect === "https://leadprime.chyrris.com/signup?ref=PRIME", redirect ?? "null");

  // Status sync: juan@rooferspro.com == ctr_ref_pays (attributed to A, active).
  const syncInvite = await inv.syncInvitationStatuses();
  const afterSync = await inv.listPartnerInvitations(pa!.id);
  check("Invitación → registrada y activa al detectar el registro del graduado (por email)",
    afterSync[0]!.status === "active" && (syncInvite.registered >= 1 || syncInvite.activated >= 1),
    `status=${afterSync[0]!.status}`);

  // ── 5b. Short referral link (social bios) ──
  const dash = await pdb.getPartnerDashboard(await aRow());
  check("Link corto se genera del código (leadprime.chyrris.com/r/prime), atribuye igual que ?ref",
    dash.shortReferralLink === "https://leadprime.chyrris.com/r/prime" &&
    dash.referralLink === "https://leadprime.chyrris.com/signup?ref=PRIME",
    `corto=${dash.shortReferralLink}`);

  // ── 6. Settings (links + approval mode) ──
  await settings.setSetting(settings.SETTING_KEYS.leadprimeLandingUrl, "https://leadprime.example.com");
  await settings.setSetting(settings.SETTING_KEYS.leadprimeProductionUrl, "https://app.leadprime.example.com");
  await settings.setSetting(settings.SETTING_KEYS.invitationMode, "approval");
  const s2 = await settings.getPortalSettings();
  check("Settings: links guardados y legibles",
    s2.leadprimeLandingUrl === "https://leadprime.example.com" &&
    s2.leadprimeProductionUrl === "https://app.leadprime.example.com");

  // Approval mode → new invitation is pending_approval, then admin approves.
  const invB = await inv.createInvitation(pb!, "graduado@nuevo.com");
  check("Modo aprobación: invitación queda 'pending_approval'",
    invB.success && invB.status === "pending_approval");
  const pendingRow = await db.select().from(schema.partnerInvitations)
    .where(and(eq(schema.partnerInvitations.partnerId, pb!.id), eq(schema.partnerInvitations.status, "pending_approval"))).limit(1);
  const approved = await inv.adminApproveInvitation(pendingRow[0]!.id);
  const approvedRow = await db.select().from(schema.partnerInvitations).where(eq(schema.partnerInvitations.id, pendingRow[0]!.id)).limit(1);
  check("Admin aprueba → invitación pasa a 'sent'",
    approved.success && approvedRow[0]!.status === "sent");

  // ── Summary ──
  const failed = results.filter(r => !r[1]);
  console.log(`\n══════ MEJORAS: ${results.length - failed.length}/${results.length} checks OK ══════`);
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
