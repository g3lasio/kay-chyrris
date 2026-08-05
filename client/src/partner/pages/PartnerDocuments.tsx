/**
 * Partner Portal — enriched "Documentación" (brief §3): the partner's full
 * file in one place — informational materials LeadPrime uploaded (view-only)
 * and the signed documents the partner uploaded, each with its status.
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { ExternalLink, FileBarChart, FileSignature, FileText, Info, Loader2, ShieldCheck } from "lucide-react";
import PartnerLayout from "../PartnerLayout";
import DocumentUploadCard from "../components/DocumentUploadCard";
import W9FormDialog from "../components/W9FormDialog";

const DOC_LABEL: Record<string, string> = {
  contract: "Contrato firmado",
  term_sheet_signed: "Term sheet firmado",
  w9: "Formulario W-9",
  ach_authorization: "Autorización ACH",
  revenue_projection: "Proyección de revenue",
  features: "Documento de features",
  term_sheet_info: "Term sheet (informativo)",
  report: "Reporte",
  other: "Otro documento",
};

const INFORMATIONAL = new Set(["revenue_projection", "features", "term_sheet_info"]);

function StatusChip({ status }: { status: string }) {
  if (status === "verified")
    return <span className="lp-chip-green text-xs font-medium px-2 py-0.5 rounded-full">Verificado</span>;
  if (status === "uploaded")
    return <span className="lp-chip-blue text-xs font-medium px-2 py-0.5 rounded-full">Subido</span>;
  return <span className="lp-chip-muted text-xs font-medium px-2 py-0.5 rounded-full">Pendiente</span>;
}

function shortDate(value: string | Date | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("es-MX", { year: "numeric", month: "short", day: "numeric" });
}

export default function PartnerDocuments() {
  const documentsQuery = trpc.partnerPortal.documents.useQuery();
  const utils = trpc.useUtils();
  const [w9Open, setW9Open] = useState(false);

  const openDocument = async (documentId: number) => {
    try {
      const { url } = await utils.partnerPortal.documentUrl.fetch({ documentId });
      window.open(url, "_blank", "noopener");
    } catch (error: any) {
      toast.error(error.message || "No se pudo abrir el documento");
    }
  };

  const allDocs = documentsQuery.data ?? [];
  const informational = allDocs.filter(d => INFORMATIONAL.has(d.docType));
  const reports = allDocs.filter(d => d.docType === "report");
  const signed = allDocs.filter(d => !INFORMATIONAL.has(d.docType) && d.docType !== "report");

  // A type counts as delivered once a file for it is uploaded or verified — the
  // same rule the onboarding journey uses. Without this the card invites you to
  // "Subir contrato" while the table right below already says "Verificado".
  const hasDoc = (docType: string) =>
    signed.some(d => d.docType === docType && (d.status === "uploaded" || d.status === "verified"));

  const DocTable = ({ docs, source }: { docs: typeof allDocs; source: "admin" | "partner" }) => (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-muted-foreground border-b">
            <th className="py-2 font-medium">Documento</th>
            <th className="py-2 font-medium hidden sm:table-cell">Archivo</th>
            <th className="py-2 font-medium">Estado</th>
            <th className="py-2 font-medium hidden sm:table-cell">
              {source === "admin" ? "Cargado" : "Subido"}
            </th>
            <th className="py-2 font-medium text-right">Ver</th>
          </tr>
        </thead>
        <tbody>
          {docs.map(doc => (
            <tr key={doc.id} className="border-b last:border-0">
              <td className="py-2.5 font-medium">
                {doc.docType === "report" && doc.title ? doc.title : DOC_LABEL[doc.docType] ?? doc.docType}
              </td>
              <td className="py-2.5 hidden sm:table-cell text-muted-foreground truncate max-w-[200px]">
                {doc.fileName ?? "—"}
              </td>
              <td className="py-2.5"><StatusChip status={doc.status} /></td>
              <td className="py-2.5 hidden sm:table-cell text-muted-foreground">
                {shortDate(doc.uploadedAt)}
              </td>
              <td className="py-2.5 text-right">
                {doc.fileUrl ? (
                  <Button variant="ghost" size="sm" onClick={() => openDocument(doc.id)}>
                    <ExternalLink className="w-4 h-4" />
                  </Button>
                ) : (
                  <span className="text-muted-foreground text-xs">—</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  return (
    <PartnerLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-xl font-bold">Documentación</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Tu expediente completo: los materiales que LeadPrime preparó y los documentos firmados que subiste.
          </p>
        </div>

        {/* Informational materials from LeadPrime */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Info className="w-5 h-5 text-primary" /> Materiales de LeadPrime
            </CardTitle>
          </CardHeader>
          <CardContent>
            {documentsQuery.isLoading ? (
              <div className="flex justify-center py-8">
                <Loader2 className="w-6 h-6 animate-spin text-primary" />
              </div>
            ) : informational.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">
                LeadPrime aún no ha cargado materiales informativos.
              </p>
            ) : (
              <DocTable docs={informational} source="admin" />
            )}
          </CardContent>
        </Card>

        {/* Reports from LeadPrime (quarterly referral reports, etc.) */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <FileBarChart className="w-5 h-5 text-[var(--lp-gold)]" /> Reportes
            </CardTitle>
          </CardHeader>
          <CardContent>
            {documentsQuery.isLoading ? (
              <div className="flex justify-center py-8">
                <Loader2 className="w-6 h-6 animate-spin text-primary" />
              </div>
            ) : reports.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">
                Aquí verás los reportes que LeadPrime comparta contigo (p. ej. reportes trimestrales de referidos).
              </p>
            ) : (
              <DocTable docs={reports} source="admin" />
            )}
          </CardContent>
        </Card>

        {/* Signed documents uploaded by the partner */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <ShieldCheck className="w-5 h-5 text-[var(--lp-green)]" /> Tus documentos firmados
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <div className="border rounded-xl p-3 space-y-2">
                <p className="text-sm font-medium">Term sheet</p>
                <DocumentUploadCard
                  docType="term_sheet_signed"
                  label="term sheet"
                  done={hasDoc("term_sheet_signed")}
                  compact
                />
              </div>
              <div className="border rounded-xl p-3 space-y-2">
                <p className="text-sm font-medium">Contrato</p>
                <DocumentUploadCard docType="contract" label="contrato" done={hasDoc("contract")} compact />
              </div>
              <div className="border rounded-xl p-3 space-y-2">
                <p className="text-sm font-medium">Autorización ACH</p>
                <DocumentUploadCard
                  docType="ach_authorization"
                  label="ACH"
                  done={hasDoc("ach_authorization")}
                  compact
                />
              </div>
              <div className="border rounded-xl p-3 space-y-2">
                <p className="text-sm font-medium">W-9</p>
                <div className="flex flex-col gap-1.5">
                  {/* Llenarlo y firmarlo AQUÍ es la vía principal — nada de
                      descargar/imprimir/escanear. Subir un W-9 propio queda
                      como alternativa para quien ya lo tiene. */}
                  <Button size="sm" className="w-full" onClick={() => setW9Open(true)}>
                    <FileSignature className="w-4 h-4 mr-1" />
                    {hasDoc("w9") ? "Firmar de nuevo" : "Llenar y firmar aquí"}
                  </Button>
                  <DocumentUploadCard docType="w9" label="W-9" done={hasDoc("w9")} compact />
                </div>
              </div>
            </div>

            {signed.length === 0 ? (
              <p className="text-sm text-muted-foreground py-2 text-center">
                Aún no has subido documentos firmados.
              </p>
            ) : (
              <div className="pt-2 border-t">
                <p className="text-sm font-medium mb-2 flex items-center gap-2">
                  <FileText className="w-4 h-4 text-primary" /> Archivos subidos
                </p>
                <DocTable docs={signed} source="partner" />
              </div>
            )}
          </CardContent>
        </Card>
      </div>
      <W9FormDialog open={w9Open} onOpenChange={setW9Open} />
    </PartnerLayout>
  );
}
