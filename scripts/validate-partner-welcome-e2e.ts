/**
 * E2E validation of the ONBOARDING-COMPLETE welcome email.
 *
 *   pnpm exec tsx scripts/validate-partner-welcome-e2e.ts
 *
 * The Resend SDK honours RESEND_BASE_URL, so this points it at a local HTTP
 * stub and captures the real composed email — subject, recipient and body —
 * without needing a Resend account. That makes the once-ever guarantee
 * testable: the risk with a send triggered from a READ path (the dashboard
 * polls onboarding state) is sending it twice, or on every single load.
 *
 * ⚠️ WRITES DATA — point ONLY at disposable test databases.
 */
const STUB_PORT = 55987;

process.env.AUTH_DATABASE_URL =
  process.env.E2E_KAI_DB_URL || "postgresql://postgres@127.0.0.1:55432/kai_test?sslmode=disable";
process.env.DATABASE_URL = process.env.AUTH_DATABASE_URL;
process.env.LEADPRIME_DATABASE_URL =
  process.env.E2E_LEADPRIME_DB_URL || "postgresql://postgres@127.0.0.1:55432/leadprime_test?sslmode=disable";
delete process.env.STRIPE_SECRET_KEY;

// Must be set BEFORE the resend SDK is imported (it reads the base URL at
// module load). Every import below is dynamic, inside main().
process.env.RESEND_API_KEY = "re_stub_key_for_e2e";
process.env.RESEND_BASE_URL = `http://127.0.0.1:${STUB_PORT}`;
process.env.PARTNER_EMAIL_FROM = "LeadPrime <no-reply@chyrris.com>";
process.env.PARTNER_PORTAL_URL = "https://partners.chyrris.com";
process.env.REFERRAL_SIGNUP_URL = "https://leadprime.chyrris.com/signup";
process.env.REFERRAL_SHORT_LINK_BASE = "https://leadprime.chyrris.com";

import { createServer, type Server } from "node:http";
import { eq, sql } from "drizzle-orm";

type SentEmail = { to: string; subject: string; html: string };

async function main() {
  // ── Resend stub ──
  const sent: SentEmail[] = [];
  let failNextSends = false;
  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", c => chunks.push(c));
    req.on("end", () => {
      if (failNextSends) {
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ name: "internal_server_error", message: "stub failure" }));
        return;
      }
      try {
        const body = JSON.parse(Buffer.concat(chunks).toString() || "{}");
        sent.push({
          to: Array.isArray(body.to) ? body.to.join(",") : String(body.to ?? ""),
          subject: String(body.subject ?? ""),
          html: String(body.html ?? ""),
        });
      } catch {
        /* malformed body — recorded as a miss by the assertions below */
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ id: `stub-${sent.length}` }));
    });
  });
  await new Promise<void>(resolve => server.listen(STUB_PORT, "127.0.0.1", resolve));

  const { ensurePartnerTables } = await import("../server/partner/ensure-tables");
  const { getDb } = await import("../server/db");
  const schema = await import("../drizzle/schema");
  const pdb = await import("../server/partner/partner-db");

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

  const rowOf = (id: number) =>
    db.select().from(schema.referralPartners).where(eq(schema.referralPartners.id, id)).limit(1).then(r => r[0]!);

  const newPartner = async (name: string, email: string, code: string) => {
    const [p] = await db
      .insert(schema.referralPartners)
      .values({ name, referralCode: code, contactName: name, contactEmail: email, status: "active" })
      .returning();
    return p!.id;
  };

  /** Drive a partner through the three stages. */
  const addDoc = (partnerId: number, docType: any) =>
    db.insert(schema.partnerDocuments).values({
      partnerId, docType, fileName: `${docType}.pdf`,
      fileUrl: `partner-documents/${partnerId}/${docType}/x.pdf`,
      status: "uploaded", uploadedBy: "partner", uploadedAt: new Date(),
    });
  const completeJourney = async (partnerId: number) => {
    await pdb.markMaterialsReviewed(partnerId);
    await addDoc(partnerId, "term_sheet_signed");
    await addDoc(partnerId, "contract");
    await addDoc(partnerId, "ach_authorization");
    await db
      .update(schema.referralPartners)
      .set({ contactConfirmedAt: new Date() })
      .where(eq(schema.referralPartners.id, partnerId));
  };

  // ── 1. No email while the journey is incomplete ──
  const aId = await newPartner("Prime Contractors Institute", "socios@primecontractors.edu", "PRIME");
  await pdb.getOnboardingState(await rowOf(aId));
  check("Socio recién creado: no se envía bienvenida", sent.length === 0, `enviados=${sent.length}`);

  await pdb.markMaterialsReviewed(aId);
  await pdb.getOnboardingState(await rowOf(aId));
  await addDoc(aId, "term_sheet_signed");
  await addDoc(aId, "contract");
  await pdb.getOnboardingState(await rowOf(aId));
  check("Etapas 1 y 2 completas: sigue sin enviarse (falta pago)", sent.length === 0, `enviados=${sent.length}`);

  // ── 2. Completing stage 3 sends exactly one welcome ──
  await addDoc(aId, "ach_authorization");
  await db
    .update(schema.referralPartners)
    .set({ contactConfirmedAt: new Date() })
    .where(eq(schema.referralPartners.id, aId));
  const journey = await pdb.getOnboardingState(await rowOf(aId));
  check("Onboarding marcado completo", journey.complete && journey.currentStage === 4);
  check("Al completar las 3 etapas llega la bienvenida", sent.length === 1, `enviados=${sent.length}`);

  const mail = sent[0];
  check("Va al correo del socio", mail?.to === "socios@primecontractors.edu", mail?.to ?? "—");
  check("Asunto de bienvenida", /socio activo de LeadPrime/i.test(mail?.subject ?? ""), mail?.subject ?? "—");
  check("Incluye el eslogan",
    (mail?.html ?? "").includes("El que no vive para servir, no sirve para vivir."));
  check("Incluye el mensaje motivador",
    /Sirve bien y lo demás llega solo/i.test(mail?.html ?? ""));
  check("Incluye el link corto de referido",
    (mail?.html ?? "").includes("leadprime.chyrris.com/r/prime"));
  check("Incluye las tarifas del socio (20% / 10%)",
    /<strong>20%<\/strong>/.test(mail?.html ?? "") && /<strong>10%<\/strong>/.test(mail?.html ?? ""));
  check("Registra la marca de envío en la BD", (await rowOf(aId)).welcomeEmailSentAt != null);

  // ── 3. The dashboard polls this on every load — it must NOT resend ──
  for (let i = 0; i < 5; i++) await pdb.getOnboardingState(await rowOf(aId));
  check("Recargar el dashboard 5 veces NO reenvía", sent.length === 1, `enviados=${sent.length}`);

  // ── 4. Dropping out of "complete" and completing again must not resend ──
  await db.delete(schema.partnerDocuments).where(
    sql`partner_id = ${aId} AND doc_type = 'ach_authorization'`
  );
  const regressed = await pdb.getOnboardingState(await rowOf(aId));
  check("Quitar un documento revierte el onboarding a incompleto", !regressed.complete);
  await addDoc(aId, "ach_authorization");
  const recompleted = await pdb.getOnboardingState(await rowOf(aId));
  check("Volver a completar NO envía una segunda bienvenida",
    recompleted.complete && sent.length === 1, `enviados=${sent.length}`);

  // ── 5. Two concurrent dashboard loads → still exactly one email ──
  const cId = await newPartner("Escuela Concurrente", "concurrente@test.com", "CONC");
  await completeJourney(cId);
  const cRow = await rowOf(cId);
  await Promise.all([
    pdb.getOnboardingState(cRow),
    pdb.getOnboardingState(cRow),
    pdb.getOnboardingState(cRow),
    pdb.getOnboardingState(cRow),
  ]);
  const cMails = sent.filter(m => m.to === "concurrente@test.com");
  check("4 cargas simultáneas envían UNA sola bienvenida (claim atómico)",
    cMails.length === 1, `enviados=${cMails.length}`);

  // ── 6. A failed send releases the claim so it retries later ──
  failNextSends = true;
  const bId = await newPartner("Otra Escuela", "otra@test.com", "OTRA");
  await completeJourney(bId);
  await pdb.getOnboardingState(await rowOf(bId));
  check("Si el envío falla, la marca se libera (no se pierde la bienvenida)",
    (await rowOf(bId)).welcomeEmailSentAt == null);

  failNextSends = false;
  await pdb.getOnboardingState(await rowOf(bId));
  const bMails = sent.filter(m => m.to === "otra@test.com");
  check("La siguiente carga reintenta y sí envía", bMails.length === 1, `enviados=${bMails.length}`);

  // ── 7. Multi-tenant: each partner gets THEIR link, never another's ──
  check("El correo de cada socio lleva SU propio código de referido",
    bMails[0]!.html.includes("/r/otra") && !bMails[0]!.html.includes("/r/prime"));
  check("Total de bienvenidas = 3 socios completos, una cada uno", sent.length === 3, `enviados=${sent.length}`);

  // ── Summary ──
  await new Promise<void>(resolve => server.close(() => resolve()));
  const failed = results.filter(r => !r[1]);
  console.log(`\n══════ BIENVENIDA: ${results.length - failed.length}/${results.length} checks OK ══════`);
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
