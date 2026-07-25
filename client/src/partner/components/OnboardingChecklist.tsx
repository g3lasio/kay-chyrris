/**
 * Partner Portal — onboarding checklist (brief §7.1). Blocks the dashboard
 * until the 4 steps are complete: contract, W-9, ACH, contact confirmation.
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import {
  Banknote,
  CheckCircle2,
  Circle,
  Download,
  FileSignature,
  FileText,
  Loader2,
  UserCheck,
} from "lucide-react";
import DocumentUploadCard from "./DocumentUploadCard";
import { usePartnerAuth } from "../usePartnerAuth";

const IRS_W9_URL = "https://www.irs.gov/pub/irs-pdf/fw9.pdf";

function StepIcon({ done }: { done: boolean }) {
  return done ? (
    <CheckCircle2 className="w-6 h-6 text-[var(--lp-green)] shrink-0" />
  ) : (
    <Circle className="w-6 h-6 text-muted-foreground/40 shrink-0" />
  );
}

export default function OnboardingChecklist() {
  const { partner } = usePartnerAuth();
  const utils = trpc.useUtils();
  const onboardingQuery = trpc.partnerPortal.onboarding.useQuery();
  const confirmContact = trpc.partnerPortal.confirmContact.useMutation();

  const [contactName, setContactName] = useState(partner?.contactName ?? "");
  const [contactPhone, setContactPhone] = useState(partner?.contactPhone ?? "");

  const state = onboardingQuery.data;
  if (onboardingQuery.isLoading || !state) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  const pct = Math.round((state.completedCount / state.totalSteps) * 100);

  const handleConfirmContact = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await confirmContact.mutateAsync({
        contactName: contactName.trim(),
        contactPhone: contactPhone.trim(),
      });
      toast.success("Datos de contacto confirmados");
      await Promise.all([
        utils.partnerPortal.onboarding.invalidate(),
        utils.partnerAuth.me.invalidate(),
      ]);
    } catch (error: any) {
      toast.error(error.message || "No se pudieron guardar los datos");
    }
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="text-center space-y-2">
        <h1 className="text-2xl font-bold text-foreground">Completa tu registro de socio</h1>
        <p className="text-sm text-muted-foreground">
          Tu panel de referidos y comisiones se desbloquea al completar estos 4 pasos.
        </p>
      </div>

      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center justify-between mb-2 text-sm">
            <span className="font-medium">
              {state.completedCount} de {state.totalSteps} pasos completados
            </span>
            <span className="text-muted-foreground">{pct}%</span>
          </div>
          <Progress value={pct} className="h-2.5" />
        </CardContent>
      </Card>

      {/* Paso 1 — Contrato */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-3 text-base">
            <StepIcon done={state.steps.contract.done} />
            <FileSignature className="w-5 h-5 text-primary" />
            Paso 1 · Contrato de alianza
          </CardTitle>
        </CardHeader>
        <CardContent className="pl-[3.75rem] space-y-3">
          <p className="text-sm text-muted-foreground">
            El contrato se firma electrónicamente (LeadSign). Este paso se marca completo cuando
            LeadPrime verifica el contrato firmado — también puedes subirlo aquí si ya lo tienes.
          </p>
          <DocumentUploadCard
            docType="contract"
            label="contrato firmado"
            done={state.steps.contract.done}
            compact
          />
          {state.steps.contract.status === "uploaded" && (
            <p className="text-xs text-muted-foreground">
              Subido — pendiente de verificación por LeadPrime.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Paso 2 — W-9 */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-3 text-base">
            <StepIcon done={state.steps.w9.done} />
            <FileText className="w-5 h-5 text-primary" />
            Paso 2 · Formulario W-9 firmado
          </CardTitle>
        </CardHeader>
        <CardContent className="pl-[3.75rem] space-y-3">
          <p className="text-sm text-muted-foreground">
            Descarga el W-9 oficial del IRS, complétalo, fírmalo y súbelo (PDF o foto legible).
          </p>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" asChild>
              <a href={IRS_W9_URL} target="_blank" rel="noreferrer">
                <Download className="w-4 h-4 mr-2" /> Descargar W-9 en blanco
              </a>
            </Button>
            <DocumentUploadCard docType="w9" label="W-9" done={state.steps.w9.done} compact />
          </div>
        </CardContent>
      </Card>

      {/* Paso 3 — ACH */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-3 text-base">
            <StepIcon done={state.steps.ach.done} />
            <Banknote className="w-5 h-5 text-primary" />
            Paso 3 · Autorización de depósito ACH
          </CardTitle>
        </CardHeader>
        <CardContent className="pl-[3.75rem] space-y-3">
          <p className="text-sm text-muted-foreground">
            Sube la autorización con los datos bancarios donde recibirás tus comisiones
            (banco, ruta y cuenta). Puede ser el formato de tu banco o una carta firmada.
          </p>
          <DocumentUploadCard
            docType="ach_authorization"
            label="autorización ACH"
            done={state.steps.ach.done}
            compact
          />
        </CardContent>
      </Card>

      {/* Paso 4 — Contacto */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-3 text-base">
            <StepIcon done={state.steps.contact.done} />
            <UserCheck className="w-5 h-5 text-primary" />
            Paso 4 · Confirma tus datos de contacto
          </CardTitle>
        </CardHeader>
        <CardContent className="pl-[3.75rem]">
          <form onSubmit={handleConfirmContact} className="space-y-3 max-w-md">
            <div className="space-y-1">
              <label className="text-sm font-medium">Nombre de contacto</label>
              <Input
                value={contactName}
                onChange={e => setContactName(e.target.value)}
                placeholder="Nombre y apellido"
                disabled={confirmContact.isPending}
              />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">Teléfono</label>
              <Input
                value={contactPhone}
                onChange={e => setContactPhone(e.target.value)}
                placeholder="+1 (555) 000-0000"
                inputMode="tel"
                disabled={confirmContact.isPending}
              />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">Email (login)</label>
              <Input value={partner?.contactEmail ?? ""} disabled />
            </div>
            <Button
              type="submit"
              size="sm"
              disabled={
                confirmContact.isPending || contactName.trim().length < 2 || contactPhone.trim().length < 7
              }
            >
              {confirmContact.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" /> Guardando…
                </>
              ) : state.steps.contact.done ? (
                "Actualizar datos"
              ) : (
                "Confirmar datos"
              )}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
