/**
 * Partner Portal — IRS Form W-9 (Rev. March 2024) generator.
 *
 * Renders the OFFICIAL Form W-9 layout with pdf-lib — the boxed "Form W-9"
 * masthead, the "Give form to the requester" block, all seven classification
 * checkboxes, Line 4 exemptions, Lines 5–7, the Part I/Part II bars, the
 * SSN/EIN boxes, the certification (reproduced VERBATIM), the "Sign Here" box,
 * and the "Cat. No. 10231X · Form W-9 (Rev. 3-2024)" footer. Layout ported
 * from the proven LeadPrime compliance generator so both products emit the
 * same faithful document.
 *
 * Legal basis: Form W-9 is a public-domain U.S. government document; a filled
 * facsimile with the certification verbatim is a valid substitute per the IRS
 * Instructions for the Requester of Form W-9.
 *
 * The partner fills a guided form in the portal (never sees this PDF) and
 * signs; the drawn signature is embedded here. PRIVACY: the TIN (SSN/EIN)
 * exists ONLY inside the generated PDF, a private R2 object behind presigned
 * URLs — it is never persisted to the database and never logged.
 */
import { PDFDocument, PDFFont, PDFImage, PDFPage, StandardFonts, rgb } from "pdf-lib";

export const TAX_CLASSIFICATIONS = [
  "individual",
  "c_corp",
  "s_corp",
  "partnership",
  "trust_estate",
  "llc",
  "other",
] as const;
export type TaxClassification = (typeof TAX_CLASSIFICATIONS)[number];

export interface W9FormData {
  /** Line 1 — name of entity/individual as shown on the tax return. */
  name: string;
  /** Line 2 — business name / disregarded entity name, if different. */
  businessName?: string | null;
  taxClassification: TaxClassification;
  /** LLC only: C / S / P tax classification letter. */
  llcClassification?: "C" | "S" | "P" | null;
  /** Free text when taxClassification = 'other'. */
  otherClassification?: string | null;
  /** Line 4 — exempt payee code (entities only, optional). */
  exemptPayeeCode?: string | null;
  /** Line 4 — exemption from FATCA reporting code (optional). */
  fatcaExemptionCode?: string | null;
  /** Line 5 — address (number, street, apt/suite). */
  address: string;
  /** Line 6 — city, state, ZIP. */
  cityStateZip: string;
  /** Line 7 — account numbers (optional). */
  accountNumbers?: string | null;
  tinType: "ssn" | "ein";
  /** 9 digits, no dashes (validated by the caller too). */
  tin: string;
  /** Typed legal signature (full name) — always present. */
  signatureName: string;
  /** Optional drawn signature as a PNG data URL (from the touch pad). */
  signatureImagePngDataUrl?: string | null;
  signedAtIso: string;
}

/** Certification text — MUST be verbatim from Form W-9 (Rev. March 2024). */
export const W9_CERTIFICATION = [
  "Under penalties of perjury, I certify that:",
  "1. The number shown on this form is my correct taxpayer identification number (or I am waiting for a number to be issued to me); and",
  "2. I am not subject to backup withholding because (a) I am exempt from backup withholding, or (b) I have not been notified by the Internal Revenue Service (IRS) that I am subject to backup withholding as a result of a failure to report all interest or dividends, or (c) the IRS has notified me that I am no longer subject to backup withholding; and",
  "3. I am a U.S. citizen or other U.S. person (defined in the instructions); and",
  "4. The FATCA code(s) entered on this form (if any) indicating that I am exempt from FATCA reporting is correct.",
].join("\n");

export function formatTin(tinType: "ssn" | "ein", tin: string): string {
  const digits = tin.replace(/\D/g, "");
  if (tinType === "ssn") return `${digits.slice(0, 3)}-${digits.slice(3, 5)}-${digits.slice(5)}`;
  return `${digits.slice(0, 2)}-${digits.slice(2)}`;
}

const BLACK = rgb(0, 0, 0);
const DARK_GRAY = rgb(0.2, 0.2, 0.2);
const LIGHT_GRAY = rgb(0.85, 0.85, 0.85);
const MEDIUM_GRAY = rgb(0.5, 0.5, 0.5);
const WHITE = rgb(1, 1, 1);
const LP_CYAN = rgb(0, 0.78, 1);
const LP_NAVY = rgb(0.05, 0.08, 0.18);

function hLine(page: PDFPage, x: number, y: number, width: number, thickness = 0.5, color = BLACK) {
  page.drawLine({ start: { x, y }, end: { x: x + width, y }, thickness, color });
}

function checkbox(page: PDFPage, x: number, y: number, checked: boolean, font: PDFFont) {
  page.drawRectangle({ x, y: y - 8, width: 8, height: 8, borderWidth: 0.75, borderColor: BLACK, color: WHITE });
  if (checked) page.drawText("X", { x: x + 0.5, y: y - 7, size: 7, font, color: BLACK });
}

/** Render the IRS Form W-9 as a single-page PDF. Returns the PDF bytes. */
export async function generateSubstituteW9(data: W9FormData): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  pdfDoc.setTitle("Form W-9 — Request for Taxpayer Identification Number and Certification");
  pdfDoc.setProducer("LeadPrime Partner Portal");
  const page = pdfDoc.addPage([612, 792]); // US Letter
  const { width, height } = page.getSize();

  const helvetica = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const helveticaBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const helveticaOblique = await pdfDoc.embedFont(StandardFonts.HelveticaOblique);

  const margin = 36;
  const contentWidth = width - margin * 2;

  const signedDate = new Date(data.signedAtIso);
  const dateStr = signedDate.toLocaleDateString("en-US", { year: "numeric", month: "2-digit", day: "2-digit" });

  // ── Branding bar ──
  page.drawRectangle({ x: 0, y: height - 22, width, height: 22, color: LP_NAVY });
  page.drawText("Generated by LeadPrime  -  leadprime.chyrris.com  -  Partner Compliance", {
    x: margin, y: height - 15, size: 7, font: helvetica, color: LP_CYAN,
  });
  page.drawText(`Generated: ${dateStr}`, { x: width - 120, y: height - 15, size: 7, font: helvetica, color: MEDIUM_GRAY });

  let y = height - 32;

  // ── Masthead ──
  page.drawRectangle({ x: margin, y: y - 48, width: 80, height: 48, borderWidth: 2, borderColor: BLACK, color: WHITE });
  page.drawText("Form", { x: margin + 4, y: y - 12, size: 8, font: helvetica, color: BLACK });
  page.drawText("W-9", { x: margin + 4, y: y - 32, size: 22, font: helveticaBold, color: BLACK });
  page.drawText("(Rev. March 2024)", { x: margin + 4, y: y - 42, size: 6, font: helvetica, color: BLACK });

  page.drawText("Request for Taxpayer", { x: margin + 90, y: y - 10, size: 14, font: helveticaBold, color: BLACK });
  page.drawText("Identification Number and Certification", { x: margin + 90, y: y - 26, size: 14, font: helveticaBold, color: BLACK });
  page.drawText("Go to www.irs.gov/FormW9 for instructions and the latest information.", {
    x: margin + 90, y: y - 40, size: 7, font: helveticaOblique, color: BLACK,
  });

  page.drawRectangle({ x: width - margin - 90, y: y - 48, width: 90, height: 48, borderWidth: 1, borderColor: BLACK, color: WHITE });
  page.drawText("Give form to the", { x: width - margin - 86, y: y - 12, size: 7, font: helveticaBold, color: BLACK });
  page.drawText("requester. Do not", { x: width - margin - 86, y: y - 22, size: 7, font: helveticaBold, color: BLACK });
  page.drawText("send to the IRS.", { x: width - margin - 86, y: y - 32, size: 7, font: helveticaBold, color: BLACK });

  y -= 56;

  page.drawText("Before you begin.", { x: margin, y, size: 7.5, font: helveticaBold, color: BLACK });
  page.drawText(" For guidance related to the purpose of Form W-9, see ", { x: margin + 67, y, size: 7.5, font: helvetica, color: BLACK });
  page.drawText("Purpose of Form,", { x: margin + 67 + 185, y, size: 7.5, font: helveticaOblique, color: BLACK });
  page.drawText(" in the instructions.", { x: margin + 67 + 185 + 60, y, size: 7.5, font: helvetica, color: BLACK });

  y -= 14;
  hLine(page, margin, y, contentWidth);

  // ── Line 1 ──
  y -= 2;
  page.drawText("1", { x: margin + 2, y: y - 2, size: 8, font: helveticaBold, color: BLACK });
  page.drawText(
    "Name of entity/individual. An entry is required. (For a sole proprietor or disregarded entity, enter the owner's name on line 1.)",
    { x: margin + 12, y: y - 2, size: 7, font: helvetica, color: BLACK }
  );
  y -= 14;
  page.drawText(data.name, { x: margin + 12, y, size: 10, font: helveticaBold, color: BLACK });
  hLine(page, margin, y - 4, contentWidth);
  y -= 8;

  // ── Line 2 ──
  hLine(page, margin, y, contentWidth);
  y -= 2;
  page.drawText("2", { x: margin + 2, y: y - 2, size: 8, font: helveticaBold, color: BLACK });
  page.drawText("Business name/disregarded entity name, if different from above.", {
    x: margin + 12, y: y - 2, size: 7, font: helvetica, color: BLACK,
  });
  y -= 14;
  if (data.businessName?.trim()) {
    page.drawText(data.businessName.trim(), { x: margin + 12, y, size: 10, font: helvetica, color: BLACK });
  }
  hLine(page, margin, y - 4, contentWidth);
  y -= 8;

  // ── Line 3a — classification ──
  hLine(page, margin, y, contentWidth);
  y -= 2;
  page.drawText("3a", { x: margin + 2, y: y - 2, size: 8, font: helveticaBold, color: BLACK });
  page.drawText(
    "Check the appropriate box for federal tax classification of the entity/individual whose name is entered on line 1. Check",
    { x: margin + 16, y: y - 2, size: 7, font: helvetica, color: BLACK }
  );
  page.drawText("only one of the following seven boxes.", { x: margin + 16, y: y - 10, size: 7, font: helvetica, color: BLACK });

  y -= 22;
  const row1 = [
    { key: "individual", label: "Individual/sole proprietor" },
    { key: "c_corp", label: "C corporation" },
    { key: "s_corp", label: "S corporation" },
    { key: "partnership", label: "Partnership" },
    { key: "trust_estate", label: "Trust/estate" },
  ] as const;
  let cbX = margin + 16;
  for (const cls of row1) {
    checkbox(page, cbX, y, data.taxClassification === cls.key, helveticaBold);
    page.drawText(cls.label, { x: cbX + 11, y: y - 7, size: 7, font: helvetica, color: BLACK });
    cbX += cls.label.length * 4 + 22;
  }

  y -= 14;
  checkbox(page, margin + 16, y, data.taxClassification === "llc", helveticaBold);
  page.drawText("LLC. Enter the tax classification (C = C corporation, S = S corporation, P = Partnership)", {
    x: margin + 27, y: y - 7, size: 7, font: helvetica, color: BLACK,
  });
  if (data.taxClassification === "llc" && data.llcClassification) {
    page.drawRectangle({ x: margin + 340, y: y - 10, width: 16, height: 10, borderWidth: 0.5, borderColor: BLACK, color: WHITE });
    page.drawText(data.llcClassification, { x: margin + 343, y: y - 8, size: 9, font: helveticaBold, color: BLACK });
  }

  y -= 14;
  checkbox(page, margin + 16, y, data.taxClassification === "other", helveticaBold);
  page.drawText("Other (see instructions)", { x: margin + 27, y: y - 7, size: 7, font: helvetica, color: BLACK });
  if (data.taxClassification === "other" && data.otherClassification) {
    page.drawText(data.otherClassification.slice(0, 60), { x: margin + 130, y: y - 7, size: 8, font: helvetica, color: BLACK });
  }

  y -= 14;
  hLine(page, margin, y, contentWidth);

  // ── Line 4 — exemptions ──
  y -= 2;
  page.drawText("4", { x: margin + 2, y: y - 2, size: 8, font: helveticaBold, color: BLACK });
  page.drawText("Exemptions (codes apply only to certain entities, not individuals; see instructions):", {
    x: margin + 12, y: y - 2, size: 7, font: helvetica, color: BLACK,
  });
  y -= 12;
  page.drawText("Exempt payee code (if any):", { x: margin + 12, y, size: 7, font: helvetica, color: BLACK });
  page.drawRectangle({ x: margin + 120, y: y - 3, width: 60, height: 10, borderWidth: 0.5, borderColor: BLACK, color: WHITE });
  if (data.exemptPayeeCode?.trim()) {
    page.drawText(data.exemptPayeeCode.trim().slice(0, 8), { x: margin + 123, y: y - 1, size: 8, font: helvetica, color: BLACK });
  }
  page.drawText("Exemption from FATCA reporting code (if any):", { x: margin + 200, y, size: 7, font: helvetica, color: BLACK });
  page.drawRectangle({ x: margin + 360, y: y - 3, width: 40, height: 10, borderWidth: 0.5, borderColor: BLACK, color: WHITE });
  if (data.fatcaExemptionCode?.trim()) {
    page.drawText(data.fatcaExemptionCode.trim().slice(0, 5), { x: margin + 363, y: y - 1, size: 8, font: helvetica, color: BLACK });
  }

  y -= 14;
  hLine(page, margin, y, contentWidth);

  // ── Line 5 — address ──
  y -= 2;
  page.drawText("5", { x: margin + 2, y: y - 2, size: 8, font: helveticaBold, color: BLACK });
  page.drawText("Address (number, street, and apt. or suite no.). See instructions.", {
    x: margin + 12, y: y - 2, size: 7, font: helvetica, color: BLACK,
  });
  y -= 14;
  page.drawText(data.address, { x: margin + 12, y, size: 10, font: helvetica, color: BLACK });
  hLine(page, margin, y - 4, contentWidth);
  y -= 8;

  // ── Line 6 — city/state/zip ──
  hLine(page, margin, y, contentWidth);
  y -= 2;
  page.drawText("6", { x: margin + 2, y: y - 2, size: 8, font: helveticaBold, color: BLACK });
  page.drawText("City, state, and ZIP code", { x: margin + 12, y: y - 2, size: 7, font: helvetica, color: BLACK });
  y -= 14;
  page.drawText(data.cityStateZip, { x: margin + 12, y, size: 10, font: helvetica, color: BLACK });
  hLine(page, margin, y - 4, contentWidth);
  y -= 8;

  // ── Line 7 — account numbers ──
  hLine(page, margin, y, contentWidth);
  y -= 2;
  page.drawText("7", { x: margin + 2, y: y - 2, size: 8, font: helveticaBold, color: BLACK });
  page.drawText("List account number(s) here (optional)", { x: margin + 12, y: y - 2, size: 7, font: helvetica, color: BLACK });
  y -= 14;
  if (data.accountNumbers?.trim()) {
    page.drawText(data.accountNumbers.trim().slice(0, 80), { x: margin + 12, y, size: 9, font: helvetica, color: BLACK });
  }
  hLine(page, margin, y - 4, contentWidth);
  y -= 12;

  // ── Part I — TIN ──
  page.drawRectangle({ x: margin, y: y - 2, width: contentWidth, height: 14, color: BLACK });
  page.drawText("Part I", { x: margin + 4, y: y + 2, size: 9, font: helveticaBold, color: WHITE });
  page.drawText("Taxpayer Identification Number (TIN)", { x: margin + 40, y: y + 2, size: 9, font: helveticaBold, color: WHITE });
  y -= 16;

  for (const line of [
    "Enter your TIN in the appropriate box. The TIN provided must match the name given on line 1 to avoid",
    "backup withholding. For individuals, this is generally your social security number (SSN). However, for a",
    "resident alien, sole proprietor, or disregarded entity, see the instructions for Part I. For other entities,",
    "it is your employer identification number (EIN). If you do not have a number, see the instructions.",
  ]) {
    page.drawText(line, { x: margin, y, size: 7, font: helvetica, color: BLACK });
    y -= 9;
  }

  y -= 8;
  const tinBoxX = width - margin - 180;
  const ssnChecked = data.tinType === "ssn";
  const einChecked = data.tinType === "ein";

  page.drawText("Social security number", { x: tinBoxX, y: y + 4, size: 7.5, font: helveticaBold, color: BLACK });
  y -= 14;
  const ssnBoxY = y;
  page.drawRectangle({ x: tinBoxX, y: ssnBoxY - 2, width: 160, height: 16, borderWidth: 1, borderColor: BLACK, color: ssnChecked ? WHITE : LIGHT_GRAY });
  if (ssnChecked) page.drawText(formatTin("ssn", data.tin), { x: tinBoxX + 4, y: ssnBoxY + 2, size: 12, font: helveticaBold, color: BLACK });

  y -= 18;
  page.drawText("or", { x: tinBoxX + 74, y, size: 8, font: helveticaBold, color: BLACK });

  y -= 14;
  page.drawText("Employer identification number", { x: tinBoxX, y: y + 4, size: 7.5, font: helveticaBold, color: BLACK });
  y -= 14;
  const einBoxY = y;
  page.drawRectangle({ x: tinBoxX, y: einBoxY - 2, width: 160, height: 16, borderWidth: 1, borderColor: BLACK, color: einChecked ? WHITE : LIGHT_GRAY });
  if (einChecked) page.drawText(formatTin("ein", data.tin), { x: tinBoxX + 4, y: einBoxY + 2, size: 12, font: helveticaBold, color: BLACK });

  y -= 20;
  hLine(page, margin, y, contentWidth);

  // ── Part II — certification (verbatim) ──
  y -= 2;
  page.drawRectangle({ x: margin, y: y - 2, width: contentWidth, height: 14, color: BLACK });
  page.drawText("Part II", { x: margin + 4, y: y + 2, size: 9, font: helveticaBold, color: WHITE });
  page.drawText("Certification", { x: margin + 44, y: y + 2, size: 9, font: helveticaBold, color: WHITE });
  y -= 16;

  const certItems = [
    "Under penalties of perjury, I certify that:",
    "1. The number shown on this form is my correct taxpayer identification number (or I am waiting for a number to be issued to me); and",
    "2. I am not subject to backup withholding because: (a) I am exempt from backup withholding, or (b) I have not been notified by the Internal\n    Revenue Service (IRS) that I am subject to backup withholding as a result of a failure to report all interest or dividends, or (c) the IRS has\n    notified me that I am no longer subject to backup withholding; and",
    "3. I am a U.S. citizen or other U.S. person (defined in the instructions); and",
    "4. The FATCA code(s) entered on this form (if any) indicating that I am exempt from FATCA reporting is correct.",
  ];
  for (const item of certItems) {
    const isHeader = item.startsWith("Under penalties");
    for (const line of item.split("\n")) {
      page.drawText(line, { x: margin, y, size: isHeader ? 8 : 7, font: isHeader ? helveticaBold : helvetica, color: BLACK });
      y -= isHeader ? 11 : 9;
    }
    y -= 1;
  }

  y -= 4;
  page.drawText("Certification instructions.", { x: margin, y, size: 7, font: helveticaBold, color: BLACK });
  page.drawText(
    " You must cross out item 2 above if you have been notified by the IRS that you are currently subject to backup",
    { x: margin + 88, y, size: 7, font: helvetica, color: BLACK }
  );
  y -= 9;
  page.drawText(
    "withholding because you have failed to report all interest and dividends on your tax return. For real estate transactions, item 2 does not apply.",
    { x: margin, y, size: 7, font: helvetica, color: BLACK }
  );

  y -= 18;
  hLine(page, margin, y, contentWidth, 1);

  // ── Sign Here ──
  y -= 2;
  page.drawRectangle({ x: margin, y: y - 28, width: 52, height: 28, borderWidth: 1, borderColor: BLACK, color: BLACK });
  page.drawText("Sign", { x: margin + 8, y: y - 10, size: 9, font: helveticaBold, color: WHITE });
  page.drawText("Here", { x: margin + 8, y: y - 20, size: 9, font: helveticaBold, color: WHITE });

  page.drawText("Signature of U.S. person >", { x: margin + 58, y: y - 4, size: 8, font: helveticaBold, color: BLACK });
  // Drawn signature above the line, if provided; typed name otherwise.
  let signaturePlaced = false;
  if (data.signatureImagePngDataUrl?.startsWith("data:image/png;base64,")) {
    try {
      const pngBytes = Buffer.from(data.signatureImagePngDataUrl.split(",")[1]!, "base64");
      const png: PDFImage = await pdfDoc.embedPng(pngBytes);
      const maxW = 180;
      const maxH = 26;
      const scale = Math.min(maxW / png.width, maxH / png.height, 1);
      page.drawImage(png, { x: margin + 62, y: y - 14, width: png.width * scale, height: png.height * scale });
      signaturePlaced = true;
    } catch {
      /* PNG corrupto → cae a la firma tipografiada */
    }
  }
  if (!signaturePlaced) {
    page.drawText(data.signatureName, { x: margin + 62, y: y - 12, size: 11, font: helveticaOblique, color: DARK_GRAY });
  }
  hLine(page, margin + 58, y - 16, 280, 0.5);
  page.drawText("(Electronic signature / Firma electrónica)", { x: margin + 60, y: y - 24, size: 6, font: helveticaOblique, color: MEDIUM_GRAY });

  page.drawText("Date >", { x: margin + 360, y: y - 4, size: 8, font: helveticaBold, color: BLACK });
  hLine(page, margin + 390, y - 16, 150, 0.5);
  page.drawText(dateStr, { x: margin + 392, y: y - 14, size: 9, font: helvetica, color: BLACK });

  y -= 36;
  hLine(page, margin, y, contentWidth, 1);

  // ── Footer (official cat. no.) ──
  y -= 10;
  page.drawText("Cat. No. 10231X", { x: margin, y, size: 7, font: helvetica, color: DARK_GRAY });
  page.drawText("Form W-9 (Rev. 3-2024)", { x: width - margin - 100, y, size: 7, font: helveticaBold, color: DARK_GRAY });

  // ── E-sign audit + branding ──
  y -= 14;
  page.drawRectangle({ x: margin, y: y - 26, width: contentWidth, height: 26, color: LP_NAVY });
  page.drawText(
    `Signed electronically by ${data.signatureName} on ${signedDate.toISOString()} via the LeadPrime Partner Portal,`,
    { x: margin + 8, y: y - 9, size: 6.5, font: helvetica, color: LP_CYAN }
  );
  page.drawText(
    "under an affirmative act of signature after presentation of the certification above.  Verify accuracy before submitting.",
    { x: margin + 8, y: y - 18, size: 6.5, font: helvetica, color: MEDIUM_GRAY }
  );

  return pdfDoc.save();
}
