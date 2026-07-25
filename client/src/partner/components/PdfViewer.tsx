/**
 * Partner Portal — embedded document viewer for informational materials.
 * Fetches a fresh signed URL for one of the partner's OWN documents and shows
 * it inline (no forced download). PDFs render natively; images render as <img>.
 */
import { useEffect, useState } from "react";
import { trpc } from "@/lib/trpc";
import { ExternalLink, FileText, Loader2 } from "lucide-react";

export default function PdfViewer({
  documentId,
  fileName,
  height = 460,
}: {
  documentId: number;
  fileName?: string | null;
  height?: number;
}) {
  const utils = trpc.useUtils();
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const isImage = /\.(png|jpe?g|webp)$/i.test(fileName ?? "");

  useEffect(() => {
    let cancelled = false;
    setUrl(null);
    setError(false);
    utils.partnerPortal.documentUrl
      .fetch({ documentId })
      .then(res => {
        if (!cancelled) setUrl(res.url);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [documentId, utils]);

  if (error) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground p-4 border rounded-lg">
        <FileText className="w-4 h-4" /> No se pudo cargar la vista previa.
      </div>
    );
  }
  if (!url) {
    return (
      <div className="flex items-center justify-center border rounded-lg" style={{ height }}>
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="border rounded-lg overflow-hidden bg-muted" style={{ height }}>
        {isImage ? (
          <img src={url} alt={fileName ?? "documento"} className="w-full h-full object-contain" />
        ) : (
          <iframe
            src={`${url}#toolbar=0&view=FitH`}
            title={fileName ?? "documento"}
            className="w-full h-full"
          />
        )}
      </div>
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
      >
        <ExternalLink className="w-3.5 h-3.5" /> Abrir en pestaña nueva
      </a>
    </div>
  );
}
