/**
 * Partner Portal — upload widget for W-9 / ACH / contract documents.
 * Reads the file as base64 and sends it through partnerPortal.uploadDocument
 * (the server stores it via the Kai storage proxy under
 * partner-documents/<partnerId>/…).
 */
import { useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { CheckCircle2, Loader2, Upload } from "lucide-react";

const ACCEPT = ".pdf,.png,.jpg,.jpeg,.webp";
const MAX_BYTES = 10 * 1024 * 1024;

type DocType = "contract" | "w9" | "ach_authorization" | "other";

export default function DocumentUploadCard({
  docType,
  label,
  done,
  compact,
}: {
  docType: DocType;
  label: string;
  done?: boolean;
  compact?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const utils = trpc.useUtils();
  const uploadMutation = trpc.partnerPortal.uploadDocument.useMutation();

  const handleFile = async (file: File) => {
    if (file.size > MAX_BYTES) {
      toast.error("El archivo supera el máximo de 10 MB");
      return;
    }
    setUploading(true);
    try {
      const base64Data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const result = String(reader.result ?? "");
          resolve(result.includes(",") ? result.split(",")[1]! : result);
        };
        reader.onerror = () => reject(new Error("No se pudo leer el archivo"));
        reader.readAsDataURL(file);
      });

      await uploadMutation.mutateAsync({
        docType,
        fileName: file.name,
        contentType: file.type || "application/pdf",
        base64Data,
      });
      toast.success(`${label} subido correctamente`);
      await Promise.all([
        utils.partnerPortal.onboarding.invalidate(),
        utils.partnerPortal.documents.invalidate(),
        utils.partnerAuth.me.invalidate(),
      ]);
    } catch (error: any) {
      toast.error(error.message || "No se pudo subir el archivo");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        className="hidden"
        onChange={e => {
          const file = e.target.files?.[0];
          if (file) void handleFile(file);
        }}
      />
      <Button
        variant={done ? "outline" : "default"}
        size={compact ? "sm" : "default"}
        onClick={() => inputRef.current?.click()}
        disabled={uploading}
      >
        {uploading ? (
          <>
            <Loader2 className="w-4 h-4 mr-2 animate-spin" /> Subiendo…
          </>
        ) : done ? (
          <>
            <CheckCircle2 className="w-4 h-4 mr-2 text-[var(--lp-green)]" /> Reemplazar
          </>
        ) : (
          <>
            <Upload className="w-4 h-4 mr-2" /> Subir {label}
          </>
        )}
      </Button>
    </>
  );
}
