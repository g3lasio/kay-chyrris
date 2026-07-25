/**
 * Partner Portal — documents zone (brief §7.2): view, upload and refresh
 * W-9 / ACH / contract beyond the initial checklist.
 */
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";
import { Download, ExternalLink, FileText, Loader2 } from "lucide-react";
import PartnerLayout from "../PartnerLayout";
import DocumentUploadCard from "../components/DocumentUploadCard";

const DOC_LABEL: Record<string, string> = {
  contract: "Contrato de alianza",
  w9: "Formulario W-9",
  ach_authorization: "Autorización ACH",
  other: "Otro documento",
};

const IRS_W9_URL = "https://www.irs.gov/pub/irs-pdf/fw9.pdf";

function StatusChip({ status }: { status: string }) {
  if (status === "verified")
    return <span className="lp-chip-green text-xs font-medium px-2 py-0.5 rounded-full">Verificado</span>;
  if (status === "uploaded")
    return <span className="lp-chip-blue text-xs font-medium px-2 py-0.5 rounded-full">Subido</span>;
  return <span className="lp-chip-muted text-xs font-medium px-2 py-0.5 rounded-full">Pendiente</span>;
}

export default function PartnerDocuments() {
  const documentsQuery = trpc.partnerPortal.documents.useQuery();
  const utils = trpc.useUtils();

  const openDocument = async (documentId: number) => {
    try {
      const { url } = await utils.partnerPortal.documentUrl.fetch({ documentId });
      window.open(url, "_blank", "noopener");
    } catch (error: any) {
      toast.error(error.message || "No se pudo abrir el documento");
    }
  };

  const documents = documentsQuery.data ?? [];

  return (
    <PartnerLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-xl font-bold">Zona de documentos</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Sube versiones actualizadas de tu W-9, autorización ACH o contrato cuando cambien.
          </p>
        </div>

        <div className="grid sm:grid-cols-3 gap-3">
          <Card>
            <CardHeader className="pb-1">
              <CardTitle className="text-sm">Formulario W-9</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <Button variant="outline" size="sm" asChild className="w-full">
                <a href={IRS_W9_URL} target="_blank" rel="noreferrer">
                  <Download className="w-4 h-4 mr-2" /> W-9 en blanco (IRS)
                </a>
              </Button>
              <DocumentUploadCard docType="w9" label="W-9" compact />
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-1">
              <CardTitle className="text-sm">Autorización ACH</CardTitle>
            </CardHeader>
            <CardContent>
              <DocumentUploadCard docType="ach_authorization" label="ACH" compact />
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-1">
              <CardTitle className="text-sm">Contrato</CardTitle>
            </CardHeader>
            <CardContent>
              <DocumentUploadCard docType="contract" label="contrato" compact />
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <FileText className="w-5 h-5 text-primary" /> Tus documentos
            </CardTitle>
          </CardHeader>
          <CardContent>
            {documentsQuery.isLoading ? (
              <div className="flex justify-center py-8">
                <Loader2 className="w-6 h-6 animate-spin text-primary" />
              </div>
            ) : documents.length === 0 ? (
              <p className="text-sm text-muted-foreground py-6 text-center">
                Aún no has subido documentos.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Tipo</TableHead>
                      <TableHead className="hidden sm:table-cell">Archivo</TableHead>
                      <TableHead>Estado</TableHead>
                      <TableHead className="hidden sm:table-cell">Subido</TableHead>
                      <TableHead className="text-right">Ver</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {documents.map(doc => (
                      <TableRow key={doc.id}>
                        <TableCell className="font-medium text-sm">
                          {DOC_LABEL[doc.docType] ?? doc.docType}
                        </TableCell>
                        <TableCell className="hidden sm:table-cell text-muted-foreground text-sm truncate max-w-[220px]">
                          {doc.fileName ?? "—"}
                        </TableCell>
                        <TableCell><StatusChip status={doc.status} /></TableCell>
                        <TableCell className="hidden sm:table-cell text-muted-foreground text-sm">
                          {doc.uploadedAt
                            ? new Date(doc.uploadedAt).toLocaleDateString("es-MX", {
                                year: "numeric",
                                month: "short",
                                day: "numeric",
                              })
                            : "—"}
                        </TableCell>
                        <TableCell className="text-right">
                          {doc.fileUrl ? (
                            <Button variant="ghost" size="sm" onClick={() => openDocument(doc.id)}>
                              <ExternalLink className="w-4 h-4" />
                            </Button>
                          ) : (
                            <span className="text-muted-foreground text-xs">—</span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </PartnerLayout>
  );
}
