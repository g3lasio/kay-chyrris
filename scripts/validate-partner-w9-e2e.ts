/**
 * E2E del W-9 guiado: el socio llena y firma EN el portal; el servidor genera
 * el Substitute Form W-9 y lo guarda en R2 como su documento W-9.
 *
 *   pnpm exec tsx scripts/validate-partner-w9-e2e.ts
 *
 * Con un stub S3 local se captura el PDF REAL subido, así se puede afirmar lo
 * que importa: el TIN viaja DENTRO del PDF (objeto privado) y NUNCA queda en
 * la base de datos.
 *
 * ⚠️ WRITES DATA — solo bases de prueba desechables.
 */
const S3_PORT = 55991;

process.env.AUTH_DATABASE_URL =
  process.env.E2E_KAI_DB_URL || "postgresql://postgres@127.0.0.1:55432/kai_test?sslmode=disable";
process.env.DATABASE_URL = process.env.AUTH_DATABASE_URL;
process.env.LEADPRIME_DATABASE_URL =
  process.env.E2E_LEADPRIME_DB_URL || "postgresql://postgres@127.0.0.1:55432/leadprime_test?sslmode=disable";
delete process.env.RESEND_API_KEY;
delete process.env.STRIPE_SECRET_KEY;
process.env.R2_ENDPOINT = `http://127.0.0.1:${S3_PORT}`;
process.env.R2_ACCESS_KEY_ID = "test-key";
process.env.R2_SECRET_ACCESS_KEY = "test-secret";
process.env.R2_BUCKET = "partner-portal-documents";

import { createServer, type Server } from "node:http";
import { eq, sql } from "drizzle-orm";

const TEST_TIN = "912345678"; // 9 dígitos — EIN de prueba

async function main() {
  // ── Stub S3: captura cada PUT ──
  const puts: Array<{ key: string; body: Buffer }> = [];
  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", c => chunks.push(c));
    req.on("end", () => {
      if (req.method === "PUT") {
        puts.push({ key: (req.url ?? "").split("?")[0]!, body: Buffer.concat(chunks) });
      }
      res.writeHead(200, { ETag: '"stub"' });
      res.end();
    });
  });
  await new Promise<void>(resolve => server.listen(S3_PORT, "127.0.0.1", resolve));

  const { ensurePartnerTables } = await import("../server/partner/ensure-tables");
  const { getDb } = await import("../server/db");
  const schema = await import("../drizzle/schema");
  const { appRouter } = await import("../server/routers");

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

  const [pa] = await db.insert(schema.referralPartners).values({
    name: "Prime Contractors", referralCode: "PRIME", contactName: "Gelasio Rodríguez",
    contactEmail: "socios@primecontractors.edu", status: "active",
  }).returning();
  const [pb] = await db.insert(schema.referralPartners).values({
    name: "Otra Escuela", referralCode: "OTRA", contactName: "María",
    contactEmail: "otra@test.com", status: "active",
  }).returning();

  const callerFor = (partner: any) =>
    appRouter.createCaller({
      req: { cookies: {}, headers: {}, ip: "127.0.0.1", socket: { remoteAddress: "127.0.0.1" } },
      res: { cookie: () => {}, clearCookie: () => {} },
      user: null,
      partner,
      isPartnerHost: true,
    } as any);
  const asA = callerFor(pa!);

  // ── 1. Envío válido con firma dibujada (PNG 1x1 válido) ──
  const tinyPng =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
  const res = await asA.partnerPortal.submitW9({
    name: "Gelasio Rodríguez",
    businessName: "Prime Contractors License Institute Inc.",
    taxClassification: "llc",
    llcClassification: "S",
    address: "1234 Main St, Suite 210",
    cityStateZip: "Houston, TX 77001",
    tinType: "ein",
    tin: TEST_TIN,
    certify: true,
    signatureName: "Gelasio Rodríguez",
    signatureImagePngDataUrl: tinyPng,
  } as any);
  check("submitW9 genera y guarda el documento", res.success === true && res.documentId > 0);

  const docs = await db.select().from(schema.partnerDocuments)
    .where(eq(schema.partnerDocuments.partnerId, pa!.id));
  const w9 = docs.find(d => d.docType === "w9");
  check("Fila partner_documents docType=w9, subida por el socio",
    !!w9 && w9.uploadedBy === "partner" && w9.status === "uploaded",
    `status=${w9?.status}`);
  check("El título identifica la firma electrónica",
    (w9?.title ?? "").includes("firmado electrónicamente"));

  // ── 2. El PDF REAL llegó a R2 con los datos dentro ──
  const put = puts.find(p => p.key.includes(`/partner-documents/${pa!.id}/w9/`));
  check("El PDF se subió al bucket bajo el prefijo del socio", !!put, put?.key ?? "—");
  const pdfRaw = put ? put.body : Buffer.alloc(0);
  check("Es un PDF real", pdfRaw.toString("latin1").startsWith("%PDF-"), `${pdfRaw.length} bytes`);
  // Los content streams van comprimidos (FlateDecode): inflar cada stream para
  // poder afirmar sobre el TEXTO real del documento.
  const { inflateSync } = await import("node:zlib");
  let pdfText = pdfRaw.toString("latin1");
  {
    const streamRe = /stream\r?\n([\s\S]*?)endstream/g;
    let m: RegExpExecArray | null;
    const raw = pdfRaw.toString("latin1");
    while ((m = streamRe.exec(raw)) !== null) {
      try {
        pdfText += "\n" + inflateSync(Buffer.from(m[1]!, "latin1")).toString("latin1");
      } catch { /* stream no comprimido o binario (imagen) — ignorar */ }
    }
    // pdf-lib dibuja el texto como cadenas HEX (<466F...> Tj) — decodificarlas
    // para poder afirmar sobre el texto legible.
    pdfText += "\n" + (pdfText.match(/<([0-9A-Fa-f]+)>/g) ?? [])
      .map(h => Buffer.from(h.slice(1, -1), "hex").toString("latin1"))
      .join("\n");
  }
  const { formatTin } = await import("../server/partner/w9-form");
  check("El TIN va DENTRO del PDF (formateado)",
    pdfText.includes(formatTin("ein", TEST_TIN)));
  check("La certificación del IRS va textual en el PDF",
    pdfText.includes("Under penalties of perjury"));

  // ── 3. PRIVACIDAD: el TIN NO existe en ninguna tabla de la base ──
  const leak = await db.execute(sql`
    SELECT (
      SELECT COUNT(*) FROM partner_documents
       WHERE file_url LIKE ${"%" + TEST_TIN + "%"} OR file_name LIKE ${"%" + TEST_TIN + "%"}
          OR COALESCE(title,'') LIKE ${"%" + TEST_TIN + "%"}
    ) + (
      SELECT COUNT(*) FROM referral_partners
       WHERE name LIKE ${"%" + TEST_TIN + "%"} OR contact_email LIKE ${"%" + TEST_TIN + "%"}
    ) AS hits`);
  check("El TIN NO se persiste en la base de datos (solo vive en el PDF privado)",
    Number((leak.rows[0] as any).hits) === 0);

  // ── 4. Validaciones que protegen al socio ──
  const badTin = await asA.partnerPortal.submitW9({
    name: "X Y", taxClassification: "individual", address: "1 Main St",
    cityStateZip: "Austin, TX 78701", tinType: "ssn", tin: "12345678",
    certify: true, signatureName: "X Y",
  } as any).then(() => "no-throw").catch((e: any) => e.message);
  check("TIN de 8 dígitos rechazado", badTin !== "no-throw");

  const noCert = await asA.partnerPortal.submitW9({
    name: "X Y", taxClassification: "individual", address: "1 Main St",
    cityStateZip: "Austin, TX 78701", tinType: "ssn", tin: TEST_TIN,
    certify: false, signatureName: "X Y",
  } as any).then(() => "no-throw").catch((e: any) => e.message);
  check("Sin la certificación (checkbox) se rechaza", noCert !== "no-throw");

  const llcNoClass = await asA.partnerPortal.submitW9({
    name: "X Y", taxClassification: "llc", address: "1 Main St",
    cityStateZip: "Austin, TX 78701", tinType: "ein", tin: TEST_TIN,
    certify: true, signatureName: "X Y",
  } as any).then(() => "no-throw").catch((e: any) => e.message);
  check("LLC sin clasificación (C/S/P) se rechaza", /LLC/.test(String(llcNoClass)));

  // ── 5. Multi-tenant: el documento pertenece SOLO al socio de la sesión ──
  const docsB = await db.select().from(schema.partnerDocuments)
    .where(eq(schema.partnerDocuments.partnerId, pb!.id));
  check("El socio B no recibió ningún documento", docsB.length === 0);

  // ── Resumen ──
  await new Promise<void>(resolve => server.close(() => resolve()));
  const failed = results.filter(r => !r[1]);
  console.log(`\n══════ W-9: ${results.length - failed.length}/${results.length} checks OK ══════`);
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
