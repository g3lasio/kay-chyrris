/**
 * Partner Portal — Substitute Form W-9 generator.
 *
 * The partner fills a guided form in the portal (no PDF in sight) and signs;
 * this module renders a SUBSTITUTE Form W-9 — expressly permitted by the IRS
 * for requesters, provided the content is substantially similar to the
 * official form and the certification text is reproduced VERBATIM (see
 * Instructions for the Requester of Form W-9, "Substitute Form W-9").
 *
 * PRIVACY RULE: the TIN (SSN/EIN) exists ONLY inside the generated PDF, which
 * lives as a private object in R2 behind presigned URLs. It is never persisted
 * to the database and never logged.
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

const CLASSIFICATION_LABELS: Record<TaxClassification, string> = {
  individual: "Individual/sole proprietor",
  c_corp: "C corporation",
  s_corp: "S corporation",
  partnership: "Partnership",
  trust_estate: "Trust/estate",
  llc: "Limited liability company (LLC)",
  other: "Other",
};

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
  /** Line 5 — address (number, street, apt/suite). */
  address: string;
  /** Line 6 — city, state, ZIP. */
  cityStateZip: string;
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

const PAGE_W = 612;
const PAGE_H = 792;
const MARGIN = 46;
const INK = rgb(0.08, 0.1, 0.13);
const DIM = rgb(0.38, 0.42, 0.47);
const LINE = rgb(0.72, 0.76, 0.8);

function wrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const out: string[] = [];
  for (const hard of text.split("\n")) {
    let line = "";
    for (const word of hard.split(/\s+/)) {
      const probe = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(probe, size) <= maxWidth) {
        line = probe;
      } else {
        if (line) out.push(line);
        line = word;
      }
    }
    out.push(line);
  }
  return out;
}

/** Render the substitute W-9 as a single-page PDF. Returns the PDF bytes. */
export async function generateSubstituteW9(data: W9FormData): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle("Form W-9 (Substitute) — Request for Taxpayer Identification Number and Certification");
  doc.setProducer("LeadPrime Partner Portal");
  const page = doc.addPage([PAGE_W, PAGE_H]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const oblique = await doc.embedFont(StandardFonts.HelveticaOblique);

  let y = PAGE_H - MARGIN;
  const width = PAGE_W - MARGIN * 2;

  const text = (t: string, size: number, f: PDFFont = font, color = INK, x = MARGIN) => {
    page.drawText(t, { x, y, size, font: f, color });
  };
  const hr = (yy: number) =>
    page.drawLine({ start: { x: MARGIN, y: yy }, end: { x: PAGE_W - MARGIN, y: yy }, thickness: 0.7, color: LINE });

  // ── Header ──
  text("Form W-9 (Substitute)", 16, bold);
  y -= 15;
  text("Request for Taxpayer Identification Number and Certification", 10.5, bold);
  y -= 12;
  text("(Rev. March 2024 equivalent) · Substitute form per IRS Instructions for the Requester of Form W-9", 7.5, font, DIM);
  y -= 8;
  text("Requester: Chyrris LLC — LeadPrime (partner program). Give form to the requester. Do not send to the IRS.", 7.5, font, DIM);
  y -= 10;
  hr(y);
  y -= 18;

  const field = (label: string, value: string, opts: { valueFont?: PDFFont; valueSize?: number } = {}) => {
    text(label, 7.5, bold, DIM);
    y -= 13;
    text(value || "—", opts.valueSize ?? 10.5, opts.valueFont ?? font);
    y -= 8;
    hr(y + 2);
    y -= 14;
  };

  field("1  Name of entity/individual (as shown on your income tax return)", data.name);
  field("2  Business name/disregarded entity name, if different from above", data.businessName?.trim() || "");

  // ── 3a. Tax classification ──
  text("3a  Federal tax classification", 7.5, bold, DIM);
  y -= 13;
  let clsLabel = CLASSIFICATION_LABELS[data.taxClassification];
  if (data.taxClassification === "llc" && data.llcClassification) {
    clsLabel += ` — tax classification: ${data.llcClassification}`;
  }
  if (data.taxClassification === "other" && data.otherClassification) {
    clsLabel += `: ${data.otherClassification.slice(0, 80)}`;
  }
  text(`[X]  ${clsLabel}`, 10.5);
  y -= 8;
  hr(y + 2);
  y -= 14;

  field("5  Address (number, street, and apt. or suite no.)", data.address);
  field("6  City, state, and ZIP code", data.cityStateZip);

  // ── Part I — TIN ──
  y -= 2;
  text("Part I — Taxpayer Identification Number (TIN)", 10.5, bold);
  y -= 12;
  const tinLines = wrap(
    "Enter your TIN in the appropriate box. For individuals, this is generally your social security number (SSN). For other entities, it is your employer identification number (EIN).",
    font,
    8,
    width
  );
  for (const l of tinLines) {
    text(l, 8, font, DIM);
    y -= 10;
  }
  y -= 4;
  const tinLabel = data.tinType === "ssn" ? "Social security number" : "Employer identification number";
  text(`${tinLabel}:`, 8.5, bold, DIM);
  page.drawText(formatTin(data.tinType, data.tin), {
    x: MARGIN + 170,
    y,
    size: 12,
    font: bold,
    color: INK,
  });
  y -= 10;
  hr(y);
  y -= 18;

  // ── Part II — Certification (verbatim) ──
  text("Part II — Certification", 10.5, bold);
  y -= 13;
  for (const line of W9_CERTIFICATION.split("\n")) {
    for (const l of wrap(line, font, 8, width)) {
      text(l, 8);
      y -= 10;
    }
    y -= 1;
  }
  y -= 3;
  for (const l of wrap(
    "Certification instructions. You must cross out item 2 above if you have been notified by the IRS that you are currently subject to backup withholding because you have failed to report all interest and dividends on your tax return.",
    font,
    7.5,
    width
  )) {
    text(l, 7.5, font, DIM);
    y -= 9;
  }
  y -= 16;

  // ── Signature block ──
  text("Sign here", 8.5, bold, DIM);
  y -= 4;
  const sigLineY = y - 34;
  // Drawn signature (if provided) sits above the line; typed name always shows.
  if (data.signatureImagePngDataUrl?.startsWith("data:image/png;base64,")) {
    try {
      const pngBytes = Buffer.from(data.signatureImagePngDataUrl.split(",")[1]!, "base64");
      const png: PDFImage = await doc.embedPng(pngBytes);
      const maxW = 200;
      const maxH = 44;
      const scale = Math.min(maxW / png.width, maxH / png.height, 1);
      page.drawImage(png, {
        x: MARGIN + 4,
        y: sigLineY + 2,
        width: png.width * scale,
        height: png.height * scale,
      });
    } catch {
      /* un PNG corrupto no debe tirar la generación — queda la firma tipografiada */
    }
  } else {
    page.drawText(data.signatureName, {
      x: MARGIN + 8,
      y: sigLineY + 8,
      size: 15,
      font: oblique,
      color: INK,
    });
  }
  page.drawLine({
    start: { x: MARGIN, y: sigLineY },
    end: { x: MARGIN + 300, y: sigLineY },
    thickness: 0.8,
    color: INK,
  });
  page.drawText("Signature of U.S. person", { x: MARGIN, y: sigLineY - 11, size: 7.5, font, color: DIM });

  const dateX = MARGIN + 330;
  const signedDate = new Date(data.signedAtIso);
  page.drawText(
    signedDate.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }),
    { x: dateX + 4, y: sigLineY + 8, size: 11, font, color: INK }
  );
  page.drawLine({
    start: { x: dateX, y: sigLineY },
    end: { x: PAGE_W - MARGIN, y: sigLineY },
    thickness: 0.8,
    color: INK,
  });
  page.drawText("Date", { x: dateX, y: sigLineY - 11, size: 7.5, font, color: DIM });

  // ── E-sign audit line ──
  const auditY = 58;
  page.drawLine({ start: { x: MARGIN, y: auditY + 12 }, end: { x: PAGE_W - MARGIN, y: auditY + 12 }, thickness: 0.5, color: LINE });
  page.drawText(
    `Signed electronically by ${data.signatureName} on ${signedDate.toISOString()} via the LeadPrime Partner Portal, ` +
      `under an affirmative act of signature after presentation of the certification above.`,
    { x: MARGIN, y: auditY, size: 6.8, font, color: DIM, maxWidth: width, lineHeight: 8.5 }
  );

  return doc.save();
}
