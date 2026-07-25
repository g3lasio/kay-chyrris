/**
 * Partner Portal — onboarding JOURNEY (brief §1). Three unlockable stages that
 * feel like advancing along a path, not filling a form:
 *   1. Revisa los materiales (visor embebido + "he revisado")
 *   2. Documentos firmados (term sheet + contrato, firmados vía LeadSign)
 *   3. Datos de pago (ACH + contacto)
 * Completing all three unlocks the referrals/commissions dashboard.
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import {
  Banknote,
  CheckCircle2,
  Circle,
  Download,
  FileSignature,
  FileText,
  Lock,
  Loader2,
  UserCheck,
} from "lucide-react";
import DocumentUploadCard from "./DocumentUploadCard";
import PdfViewer from "./PdfViewer";
import { usePartnerAuth } from "../usePartnerAuth";

const IRS_W9_URL = "https://www.irs.gov/pub/irs-pdf/fw9.pdf";

const INFO_DOC_LABEL: Record<string, string> = {
  revenue_projection: "Proyección de revenue",
  features: "Documento de features",
  term_sheet_info: "Term sheet (informativo)",
};

type StageStatus = "done" | "current" | "locked";

function StageHeader({
  index,
  title,
  icon: Icon,
  status,
}: {
  index: number;
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  status: StageStatus;
}) {
  return (
    <CardTitle className="flex items-center gap-3 text-base">
      {status === "done" ? (
        <CheckCircle2 className="w-6 h-6 text-[var(--lp-green)] shrink-0" />
      ) : status === "locked" ? (
        <Lock className="w-5 h-5 text-muted-foreground/50 shrink-0" />
      ) : (
        <Circle className="w-6 h-6 text-primary shrink-0" />
      )}
      <Icon className={`w-5 h-5 ${status === "locked" ? "text-muted-foreground/50" : "text-primary"}`} />
      <span className={status === "locked" ? "text-muted-foreground/60" : ""}>
        Etapa {index} · {title}
      </span>
    </CardTitle>
  );
}

export default function OnboardingChecklist() {
  const { partner } = usePartnerAuth();
  const utils = trpc.useUtils();
  const onboardingQuery = trpc.partnerPortal.onboarding.useQuery();
  const documentsQuery = trpc.partnerPortal.documents.useQuery();
  const markReviewed = trpc.partnerPortal.markMaterialsReviewed.useMutation();
  const confirmContact = trpc.partnerPortal.confirmContact.useMutation();

  const [ackChecked, setAckChecked] = useState(false);
  const [contactName, setContactName] = useState(partner?.contactName ?? "");
  const [contactPhone, setContactPhone] = useState(partner?.contactPhone ?? "");

  const journey = onboardingQuery.data;
  if (onboardingQuery.isLoading || !journey) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  const pct = Math.round((journey.completedStages / journey.totalStages) * 100);
  // Stage 1 shows only informational materials — reports are post-onboarding
  // deliverables and live in the Documentación → Reportes section.
  const materials = (documentsQuery.data ?? []).filter(d =>
    Object.keys(INFO_DOC_LABEL).includes(d.docType)
  );

  const stageStatus = (n: number): StageStatus => {
    if (journey.currentStage > n) return "done";
    if (journey.currentStage === n) return "current";
    return "locked";
  };

  const refreshAll = () =>
    Promise.all([
      utils.partnerPortal.onboarding.invalidate(),
      utils.partnerPortal.documents.invalidate(),
      utils.partnerAuth.me.invalidate(),
    ]);

  const handleMarkReviewed = async () => {
    try {
      await markReviewed.mutateAsync();
      toast.success("¡Materiales marcados como revisados!");
      await refreshAll();
    } catch (error: any) {
      toast.error(error.message || "No se pudo guardar");
    }
  };

  const handleConfirmContact = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await confirmContact.mutateAsync({
        contactName: contactName.trim(),
        contactPhone: contactPhone.trim(),
      });
      toast.success("Datos de contacto confirmados");
      await refreshAll();
    } catch (error: any) {
      toast.error(error.message || "No se pudieron guardar los datos");
    }
  };

  const s1 = stageStatus(1);
  const s2 = stageStatus(2);
  const s3 = stageStatus(3);

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="text-center space-y-2">
        <h1 className="text-2xl font-bold text-foreground">Tu camino como socio de LeadPrime</h1>
        <p className="text-sm text-muted-foreground">
          Avanza por las 3 etapas. Al completarlas se desbloquea tu panel de referidos y comisiones.
        </p>
        <p className="text-xs text-muted-foreground/70 italic pt-1">
          El que no vive para servir, no sirve para vivir.
        </p>
      </div>

      {/* Progress path */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center justify-between mb-3">
            {["Materiales", "Firmados", "Pago"].map((label, i) => {
              const st = stageStatus(i + 1);
              return (
                <div key={label} className="flex flex-col items-center gap-1 flex-1">
                  <div
                    className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold ${
                      st === "done"
                        ? "bg-[var(--lp-green)] text-white"
                        : st === "current"
                          ? "bg-primary text-white"
                          : "bg-muted text-muted-foreground"
                    }`}
                  >
                    {st === "done" ? "✓" : i + 1}
                  </div>
                  <span className={`text-xs ${st === "locked" ? "text-muted-foreground/60" : "text-foreground"}`}>
                    {label}
                  </span>
                </div>
              );
            })}
          </div>
          <Progress value={pct} className="h-2" />
          <p className="text-xs text-muted-foreground text-right mt-1">
            {journey.completedStages} de {journey.totalStages} etapas · {pct}%
          </p>
        </CardContent>
      </Card>

      {/* Etapa 1 — Materiales */}
      <Card className={s1 === "locked" ? "opacity-60" : ""}>
        <CardHeader className="pb-2">
          <StageHeader index={1} title="Revisa los materiales" icon={FileText} status={s1} />
        </CardHeader>
        <CardContent className="pl-[3.75rem] space-y-4">
          <p className="text-sm text-muted-foreground">
            LeadPrime preparó estos documentos para ti. Revísalos aquí mismo (no necesitas descargarlos)
            y confirma que los revisaste. Esto es un registro interno, no una firma.
          </p>
          {materials.length === 0 ? (
            <p className="text-sm text-muted-foreground border rounded-lg p-3 bg-muted/40">
              Aún no hay materiales cargados. LeadPrime los subirá pronto; podrás continuar en cuanto estén
              disponibles.
            </p>
          ) : (
            <div className="space-y-4">
              {materials.map(doc => (
                <div key={doc.id} className="space-y-1.5">
                  <p className="text-sm font-medium">{INFO_DOC_LABEL[doc.docType] ?? doc.fileName}</p>
                  <PdfViewer documentId={doc.id} fileName={doc.fileName} height={380} />
                </div>
              ))}
            </div>
          )}

          {s1 === "done" ? (
            <p className="text-sm text-[var(--lp-green)] font-medium flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4" /> Revisado el{" "}
              {journey.stages.materials.reviewedAt
                ? new Date(journey.stages.materials.reviewedAt).toLocaleDateString("es-MX")
                : ""}
            </p>
          ) : (
            <div className="space-y-3 pt-1">
              <label className="flex items-start gap-2 text-sm cursor-pointer">
                <Checkbox
                  checked={ackChecked}
                  onCheckedChange={v => setAckChecked(v === true)}
                  disabled={materials.length === 0}
                  className="mt-0.5"
                />
                <span>He revisado estos materiales.</span>
              </label>
              <Button
                size="sm"
                disabled={!ackChecked || materials.length === 0 || markReviewed.isPending}
                onClick={handleMarkReviewed}
              >
                {markReviewed.isPending ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" /> Guardando…
                  </>
                ) : (
                  "Continuar a la siguiente etapa"
                )}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Etapa 2 — Documentos firmados */}
      <Card className={s2 === "locked" ? "opacity-60" : ""}>
        <CardHeader className="pb-2">
          <StageHeader index={2} title="Documentos firmados" icon={FileSignature} status={s2} />
        </CardHeader>
        <CardContent className="pl-[3.75rem] space-y-4">
          <p className="text-sm text-muted-foreground">
            El term sheet y el contrato se firman por <strong>LeadSign</strong> (fuera del portal). Aquí solo
            subes el PDF ya firmado; LeadPrime lo verifica.
          </p>
          {s2 === "locked" ? (
            <p className="text-sm text-muted-foreground/70">Completa la Etapa 1 para desbloquear.</p>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-3 border rounded-lg p-3">
                <div>
                  <p className="text-sm font-medium">Term sheet firmado</p>
                  <p className="text-xs text-muted-foreground">
                    Estado: {journey.stages.signed.termSheet.status ?? "pendiente"}
                  </p>
                </div>
                <DocumentUploadCard
                  docType="term_sheet_signed"
                  label="term sheet"
                  done={journey.stages.signed.termSheet.done}
                  compact
                />
              </div>
              <div className="flex items-center justify-between gap-3 border rounded-lg p-3">
                <div>
                  <p className="text-sm font-medium">Contrato firmado</p>
                  <p className="text-xs text-muted-foreground">
                    Estado: {journey.stages.signed.contract.status ?? "pendiente"}
                  </p>
                </div>
                <DocumentUploadCard
                  docType="contract"
                  label="contrato"
                  done={journey.stages.signed.contract.done}
                  compact
                />
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Etapa 3 — Datos de pago */}
      <Card className={s3 === "locked" ? "opacity-60" : ""}>
        <CardHeader className="pb-2">
          <StageHeader index={3} title="Datos de pago" icon={Banknote} status={s3} />
        </CardHeader>
        <CardContent className="pl-[3.75rem] space-y-4">
          {s3 === "locked" ? (
            <p className="text-sm text-muted-foreground/70">Completa la Etapa 2 para desbloquear.</p>
          ) : (
            <>
              <div className="flex items-center justify-between gap-3 border rounded-lg p-3">
                <div>
                  <p className="text-sm font-medium">Autorización de depósito ACH</p>
                  <p className="text-xs text-muted-foreground">
                    Datos bancarios donde recibirás tus comisiones.
                  </p>
                </div>
                <DocumentUploadCard
                  docType="ach_authorization"
                  label="ACH"
                  done={journey.stages.payment.ach.done}
                  compact
                />
              </div>

              <div className="border rounded-lg p-3">
                <p className="text-sm font-medium mb-1 flex items-center gap-2">
                  <UserCheck className="w-4 h-4 text-primary" /> Confirma tus datos de contacto
                </p>
                <form onSubmit={handleConfirmContact} className="space-y-3 max-w-md pt-1">
                  <Input
                    value={contactName}
                    onChange={e => setContactName(e.target.value)}
                    placeholder="Nombre y apellido"
                    disabled={confirmContact.isPending}
                  />
                  <Input
                    value={contactPhone}
                    onChange={e => setContactPhone(e.target.value)}
                    placeholder="+1 (555) 000-0000"
                    inputMode="tel"
                    disabled={confirmContact.isPending}
                  />
                  <Button
                    type="submit"
                    size="sm"
                    disabled={
                      confirmContact.isPending ||
                      contactName.trim().length < 2 ||
                      contactPhone.trim().length < 7
                    }
                  >
                    {confirmContact.isPending ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" /> Guardando…
                      </>
                    ) : journey.stages.payment.contact.done ? (
                      "Actualizar datos"
                    ) : (
                      "Confirmar datos"
                    )}
                  </Button>
                </form>
              </div>

              {/* Optional W-9, not required for the gate but offered here. */}
              <div className="flex flex-wrap items-center gap-2 border rounded-lg p-3">
                <span className="text-sm text-muted-foreground flex-1">
                  ¿Tienes W-9? Puedes adjuntarlo (opcional).
                </span>
                <Button variant="outline" size="sm" asChild>
                  <a href={IRS_W9_URL} target="_blank" rel="noreferrer">
                    <Download className="w-4 h-4 mr-2" /> W-9 en blanco
                  </a>
                </Button>
                <DocumentUploadCard docType="w9" label="W-9" compact />
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
