/**
 * Kai Admin — Socios de referidos (Partner Referral Program)
 *
 * Gestión completa del programa multi-socio: crear socios (dispara la
 * invitación por Resend), ver referidos/comisiones de cualquier socio,
 * verificar documentos, generar liquidaciones y pausar/editar tarifas.
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  BadgeCheck,
  Copy,
  Handshake,
  Loader2,
  Mail,
  Pause,
  Play,
  Plus,
  RefreshCcw,
  Settings,
  Trash2,
  Undo2,
  Upload,
} from "lucide-react";
import { useRef } from "react";

function money(value: string | number): string {
  const n = typeof value === "number" ? value : parseFloat(value || "0");
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

type AdminDocCategory = "revenue_projection" | "features" | "term_sheet_info" | "report";

const ADMIN_DOC_CATEGORIES: Array<{ value: AdminDocCategory; label: string; group: string }> = [
  { value: "revenue_projection", label: "Proyección de revenue", group: "Materiales informativos" },
  { value: "features", label: "Documento de features", group: "Materiales informativos" },
  { value: "term_sheet_info", label: "Term sheet informativo", group: "Materiales informativos" },
  { value: "report", label: "Reporte (con título)", group: "Reportes" },
];

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const r = String(reader.result ?? "");
      resolve(r.includes(",") ? r.split(",")[1]! : r);
    };
    reader.onerror = () => reject(new Error("No se pudo leer el archivo"));
    reader.readAsDataURL(file);
  });
}

/**
 * Admin document upload dialog for a partner: pick a category (informational
 * materials or a titled report), choose a file, upload. Assigned to that
 * partner only (multi-tenant isolation enforced server-side).
 */
function AdminUploadDialog({
  open,
  onOpenChange,
  onUpload,
  pending,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onUpload: (input: {
    docType: AdminDocCategory;
    title?: string;
    fileName: string;
    contentType: string;
    base64Data: string;
  }) => Promise<void>;
  pending: boolean;
}) {
  const [category, setCategory] = useState<AdminDocCategory>("revenue_projection");
  const [title, setTitle] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const isReport = category === "report";

  const reset = () => {
    setCategory("revenue_projection");
    setTitle("");
    setFile(null);
    if (inputRef.current) inputRef.current.value = "";
  };

  const submit = async () => {
    if (!file) {
      toast.error("Elige un archivo");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      toast.error("El archivo supera 10 MB");
      return;
    }
    if (isReport && !title.trim()) {
      toast.error("El reporte necesita un título");
      return;
    }
    const base64Data = await readFileAsBase64(file);
    await onUpload({
      docType: category,
      title: isReport ? title.trim() : undefined,
      fileName: file.name,
      contentType: file.type || "application/pdf",
      base64Data,
    });
    reset();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={v => {
        if (!v) reset();
        onOpenChange(v);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Subir documento para el socio</DialogTitle>
          <DialogDescription>
            Se asigna solo a este socio y aparece en su portal. PDF o imagen, máx 10 MB.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <label className="text-sm font-medium">Categoría</label>
            <select
              value={category}
              onChange={e => setCategory(e.target.value as AdminDocCategory)}
              className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
            >
              <optgroup label="Materiales informativos (Etapa 1 del socio)">
                {ADMIN_DOC_CATEGORIES.filter(c => c.group === "Materiales informativos").map(c => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </optgroup>
              <optgroup label="Reportes (documento recurrente)">
                <option value="report">Reporte (con título)</option>
              </optgroup>
            </select>
          </div>

          {isReport && (
            <div className="space-y-1">
              <label className="text-sm font-medium">Título del reporte</label>
              <Input
                value={title}
                onChange={e => setTitle(e.target.value)}
                placeholder="Reporte Q3 2026 de referidos"
                maxLength={255}
              />
            </div>
          )}

          <div className="space-y-1">
            <label className="text-sm font-medium">Archivo</label>
            <input
              ref={inputRef}
              type="file"
              accept=".pdf,.png,.jpg,.jpeg,.webp"
              className="block w-full text-sm text-muted-foreground file:mr-3 file:py-2 file:px-3 file:rounded-md file:border-0 file:bg-primary file:text-primary-foreground file:cursor-pointer"
              onChange={e => setFile(e.target.files?.[0] ?? null)}
            />
          </div>

          <DialogFooter className="pt-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
            <Button onClick={submit} disabled={pending || !file || (isReport && !title.trim())}>
              {pending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Upload className="w-4 h-4 mr-2" />}
              Subir documento
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function shortDate(value: string | Date): string {
  return new Date(value).toLocaleDateString("es-MX", { year: "numeric", month: "short", day: "numeric" });
}

function statusBadge(status: string) {
  const map: Record<string, { label: string; className: string }> = {
    invited: { label: "Invitado", className: "bg-blue-500/15 text-blue-400 border-blue-500/30" },
    active: { label: "Activo", className: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30" },
    paused: { label: "Pausado", className: "bg-amber-500/15 text-amber-400 border-amber-500/30" },
    inactive: { label: "Inactivo", className: "bg-zinc-500/15 text-zinc-400 border-zinc-500/30" },
  };
  const cfg = map[status] ?? map.inactive!;
  return <Badge variant="outline" className={cfg.className}>{cfg.label}</Badge>;
}

const DOC_LABEL: Record<string, string> = {
  contract: "Contrato firmado",
  term_sheet_signed: "Term sheet firmado",
  w9: "W-9",
  ach_authorization: "ACH",
  revenue_projection: "Proyección de revenue",
  features: "Documento de features",
  term_sheet_info: "Term sheet informativo",
  report: "Reporte",
  other: "Otro",
};

export default function LeadPrimePartners() {
  const utils = trpc.useUtils();
  const listQuery = trpc.partnerAdmin.list.useQuery();
  const runSync = trpc.partnerAdmin.runSync.useMutation({
    onSuccess: res => {
      const s = res.summary;
      toast.success(
        `Sync completado: +${s.attributionsCreated} atribuciones, +${s.commissionsCreated} comisiones, +${s.reversalsCreated} reversiones`
      );
      void utils.partnerAdmin.invalidate();
    },
    onError: err => toast.error(err.message),
  });

  const [createOpen, setCreateOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [detailId, setDetailId] = useState<number | null>(null);

  const partners = listQuery.data ?? [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Handshake className="w-6 h-6 text-primary" /> Socios de referidos
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Programa multi-socio · portal en partners.chyrris.com · comisión 20% año 1 / 10% año 2 sobre revenue cobrado
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="icon" onClick={() => setSettingsOpen(true)} title="Ajustes del portal">
            <Settings className="w-4 h-4" />
          </Button>
          <Button variant="outline" onClick={() => runSync.mutate()} disabled={runSync.isPending}>
            {runSync.isPending ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <RefreshCcw className="w-4 h-4 mr-2" />
            )}
            Sincronizar comisiones
          </Button>
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="w-4 h-4 mr-2" /> Nuevo socio
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="pt-6">
          {listQuery.isLoading ? (
            <div className="flex justify-center py-10">
              <Loader2 className="w-7 h-7 animate-spin text-primary" />
            </div>
          ) : partners.length === 0 ? (
            <div className="text-center py-10 space-y-2">
              <p className="text-muted-foreground">Aún no hay socios.</p>
              <p className="text-sm text-muted-foreground">
                Crea el primero (Prime Contractors License Institute) con el botón "Nuevo socio".
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Socio</TableHead>
                    <TableHead>Código</TableHead>
                    <TableHead>Estado</TableHead>
                    <TableHead>Onboarding</TableHead>
                    <TableHead className="text-right">Referidos</TableHead>
                    <TableHead className="text-right">Activos</TableHead>
                    <TableHead className="text-right">Pendiente</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {partners.map(p => (
                    <TableRow
                      key={p.id}
                      className="cursor-pointer"
                      onClick={() => setDetailId(p.id)}
                    >
                      <TableCell>
                        <p className="font-medium">{p.name}</p>
                        <p className="text-xs text-muted-foreground">{p.contactEmail}</p>
                      </TableCell>
                      <TableCell>
                        <code className="text-xs bg-muted px-1.5 py-0.5 rounded">{p.referralCode}</code>
                      </TableCell>
                      <TableCell>{statusBadge(p.status)}</TableCell>
                      <TableCell>
                        {p.onboardingComplete ? (
                          <Badge variant="outline" className="bg-emerald-500/15 text-emerald-400 border-emerald-500/30">Completo</Badge>
                        ) : (
                          <Badge variant="outline" className="bg-zinc-500/15 text-zinc-400 border-zinc-500/30">Pendiente</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right">{p.totalReferrals}</TableCell>
                      <TableCell className="text-right">{p.activeReferrals}</TableCell>
                      <TableCell className="text-right">{money(p.pendingCommission)}</TableCell>
                      <TableCell className="text-right font-medium">{money(p.totalCommission)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <CreatePartnerDialog open={createOpen} onOpenChange={setCreateOpen} />
      <PortalSettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
      {detailId !== null && (
        <PartnerDetailDialog partnerId={detailId} onClose={() => setDetailId(null)} />
      )}
    </div>
  );
}

// ── Ajustes del portal (links de LeadPrime + modo de invitación) ────────────

function PortalSettingsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const settingsQuery = trpc.partnerAdmin.getSettings.useQuery(undefined, { enabled: open });
  const update = trpc.partnerAdmin.updateSettings.useMutation({
    onSuccess: () => { toast.success("Ajustes guardados"); onOpenChange(false); },
    onError: err => toast.error(err.message),
  });
  const [landing, setLanding] = useState("");
  const [production, setProduction] = useState("");
  const [shortBase, setShortBase] = useState("");
  const [mode, setMode] = useState<"auto" | "approval">("auto");

  // Seed the form once settings load.
  const loaded = settingsQuery.data;
  const seededRef = useRef(false);
  if (loaded && !seededRef.current) {
    seededRef.current = true;
    setLanding(loaded.leadprimeLandingUrl);
    setProduction(loaded.leadprimeProductionUrl);
    setShortBase(loaded.shortLinkBase);
    setMode(loaded.invitationMode);
  }

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) seededRef.current = false; onOpenChange(v); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Ajustes del Portal de Socios</DialogTitle>
          <DialogDescription>
            Links de LeadPrime que el socio comparte, y cómo se manejan las invitaciones.
          </DialogDescription>
        </DialogHeader>
        {settingsQuery.isLoading ? (
          <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
        ) : (
          <div className="space-y-3">
            <div className="space-y-1">
              <label className="text-sm font-medium">Landing page</label>
              <Input value={landing} onChange={e => setLanding(e.target.value)} placeholder="https://leadprime.chyrris.com" />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">Sitio de producción</label>
              <Input value={production} onChange={e => setProduction(e.target.value)} placeholder="https://app.leadprime.chyrris.com" />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">Base del link corto de referido</label>
              <Input value={shortBase} onChange={e => setShortBase(e.target.value)} placeholder="https://leadprime.chyrris.com" />
              <p className="text-xs text-muted-foreground">
                Se muestra como leadprime.chyrris.com/r/CODIGO. El redirect /r/CODE vive en el repo de LeadPrime.
              </p>
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">Modo de invitaciones</label>
              <select
                value={mode}
                onChange={e => setMode(e.target.value as "auto" | "approval")}
                className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="auto">Automático (se envían al instante)</option>
                <option value="approval">Con aprobación de LeadPrime</option>
              </select>
            </div>
            <DialogFooter className="pt-2">
              <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
              <Button
                onClick={() =>
                  update.mutate({
                    leadprimeLandingUrl: landing.trim(),
                    leadprimeProductionUrl: production.trim(),
                    shortLinkBase: shortBase.trim(),
                    invitationMode: mode,
                  })
                }
                disabled={update.isPending}
              >
                {update.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                Guardar
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ── Crear socio ────────────────────────────────────────────────────────────

function CreatePartnerDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const utils = trpc.useUtils();
  const [form, setForm] = useState({
    name: "",
    contactName: "",
    contactEmail: "",
    contactPhone: "",
    referralCode: "",
    tierYear1Pct: "20",
    tierYear2Pct: "10",
    freeAccountThreshold: "10",
  });

  const createMutation = trpc.partnerAdmin.create.useMutation({
    onSuccess: res => {
      if (res.invitationSent) {
        toast.success(`Socio creado. Invitación enviada a ${res.partner.contactEmail}`);
      } else {
        toast.warning(
          `Socio creado, pero la invitación NO se envió: ${res.invitationError ?? "Resend no configurado"}`
        );
      }
      void utils.partnerAdmin.list.invalidate();
      onOpenChange(false);
      setForm({
        name: "", contactName: "", contactEmail: "", contactPhone: "",
        referralCode: "", tierYear1Pct: "20", tierYear2Pct: "10", freeAccountThreshold: "10",
      });
    },
    onError: err => toast.error(err.message),
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    createMutation.mutate({
      name: form.name.trim(),
      contactName: form.contactName.trim() || undefined,
      contactEmail: form.contactEmail.trim(),
      contactPhone: form.contactPhone.trim() || undefined,
      referralCode: form.referralCode.trim(),
      tierYear1Pct: parseFloat(form.tierYear1Pct) || 20,
      tierYear2Pct: parseFloat(form.tierYear2Pct) || 10,
      freeAccountThreshold: parseInt(form.freeAccountThreshold, 10) || 10,
    });
  };

  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm(f => ({ ...f, [key]: e.target.value }));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Nuevo socio de referidos</DialogTitle>
          <DialogDescription>
            Al crear el socio se envía la invitación por email (Resend) para que active su acceso
            en partners.chyrris.com. No existe auto-registro.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <div className="space-y-1">
            <label className="text-sm font-medium">Nombre del socio *</label>
            <Input value={form.name} onChange={set("name")} placeholder="Prime Contractors License Institute Inc." required />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-sm font-medium">Email (login) *</label>
              <Input type="email" value={form.contactEmail} onChange={set("contactEmail")} placeholder="socio@escuela.com" required />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">Código de referido *</label>
              <Input value={form.referralCode} onChange={set("referralCode")} placeholder="PRIME" required className="uppercase" />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">Contacto</label>
              <Input value={form.contactName} onChange={set("contactName")} placeholder="Nombre del contacto" />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">Teléfono</label>
              <Input value={form.contactPhone} onChange={set("contactPhone")} placeholder="+1 555 000 0000" />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">% Año 1</label>
              <Input type="number" min="0" max="100" step="0.01" value={form.tierYear1Pct} onChange={set("tierYear1Pct")} />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">% Año 2</label>
              <Input type="number" min="0" max="100" step="0.01" value={form.tierYear2Pct} onChange={set("tierYear2Pct")} />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">Umbral cuenta gratis</label>
              <Input type="number" min="1" max="1000" value={form.freeAccountThreshold} onChange={set("freeAccountThreshold")} />
            </div>
          </div>
          <DialogFooter className="pt-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={createMutation.isPending}>
              {createMutation.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" /> Creando…
                </>
              ) : (
                "Crear e invitar"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── Detalle del socio ──────────────────────────────────────────────────────

function PartnerDetailDialog({ partnerId, onClose }: { partnerId: number; onClose: () => void }) {
  const utils = trpc.useUtils();
  const detailQuery = trpc.partnerAdmin.detail.useQuery({ partnerId });

  const invalidate = () => {
    void utils.partnerAdmin.detail.invalidate({ partnerId });
    void utils.partnerAdmin.list.invalidate();
  };

  const updateMutation = trpc.partnerAdmin.update.useMutation({
    onSuccess: () => { toast.success("Socio actualizado"); invalidate(); },
    onError: err => toast.error(err.message),
  });
  const verifyDoc = trpc.partnerAdmin.verifyDocument.useMutation({
    onSuccess: () => { toast.success("Documento verificado"); invalidate(); },
    onError: err => toast.error(err.message),
  });
  const markContract = trpc.partnerAdmin.markContractComplete.useMutation({
    onSuccess: () => { toast.success("Contrato marcado como completo"); invalidate(); },
    onError: err => toast.error(err.message),
  });
  const resendInvite = trpc.partnerAdmin.resendInvitation.useMutation({
    onSuccess: res =>
      res.success ? toast.success("Invitación reenviada") : toast.error(res.error ?? "No se pudo enviar"),
    onError: err => toast.error(err.message),
  });
  const generatePayout = trpc.partnerAdmin.generatePayout.useMutation({
    onSuccess: res => {
      toast.success(`Liquidación de ${money(res.payout.totalAmount)} generada (${res.commissionCount} comisiones)`);
      invalidate();
    },
    onError: err => toast.error(err.message),
  });
  const markPaid = trpc.partnerAdmin.markPayoutPaid.useMutation({
    onSuccess: () => { toast.success("Liquidación marcada como pagada"); invalidate(); },
    onError: err => toast.error(err.message),
  });
  const reverseCommission = trpc.partnerAdmin.reverseCommission.useMutation({
    onSuccess: () => { toast.success("Reversión registrada"); invalidate(); },
    onError: err => toast.error(err.message),
  });
  const attributeReferral = trpc.partnerAdmin.attributeReferral.useMutation({
    onSuccess: res => {
      res.created ? toast.success("Referido atribuido") : toast.info("Ese usuario ya estaba atribuido");
      invalidate();
    },
    onError: err => toast.error(err.message),
  });
  const uploadDoc = trpc.partnerAdmin.uploadDocument.useMutation({
    onSuccess: () => { toast.success("Documento subido y asignado al socio"); invalidate(); },
    onError: err => toast.error(err.message),
  });
  const [docUploadOpen, setDocUploadOpen] = useState(false);
  const deleteDoc = trpc.partnerAdmin.deleteDocument.useMutation({
    onSuccess: () => { toast.success("Documento eliminado"); invalidate(); },
    onError: err => toast.error(err.message),
  });
  const invitationsQuery = trpc.partnerAdmin.listInvitations.useQuery({ partnerId });
  const approveInvitation = trpc.partnerAdmin.approveInvitation.useMutation({
    onSuccess: () => { toast.success("Invitación aprobada y enviada"); invitationsQuery.refetch(); },
    onError: err => toast.error(err.message),
  });

  const [manualContractorId, setManualContractorId] = useState("");
  const now = new Date();
  const defaultStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const defaultEnd = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);
  const [periodStart, setPeriodStart] = useState(defaultStart.toISOString().slice(0, 10));
  const [periodEnd, setPeriodEnd] = useState(defaultEnd.toISOString().slice(0, 10));

  const data = detailQuery.data;
  const partner = data?.partner;

  return (
    <Dialog open onOpenChange={v => !v && onClose()}>
      <DialogContent className="sm:max-w-4xl max-h-[90vh] overflow-y-auto">
        {detailQuery.isLoading || !data || !partner ? (
          <div className="flex justify-center py-16">
            <Loader2 className="w-7 h-7 animate-spin text-primary" />
          </div>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="flex flex-wrap items-center gap-2">
                {partner.name} {statusBadge(partner.status)}
              </DialogTitle>
              <DialogDescription className="flex flex-wrap items-center gap-x-4 gap-y-1">
                <span>{partner.contactEmail}</span>
                <span>
                  Código <code className="bg-muted px-1 rounded">{partner.referralCode}</code>
                </span>
                <span>
                  {parseFloat(partner.tierYear1Pct)}% año 1 · {parseFloat(partner.tierYear2Pct)}% año 2 · gratis a {partner.freeAccountThreshold}
                </span>
              </DialogDescription>
            </DialogHeader>

            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  navigator.clipboard
                    .writeText(`https://leadprime.chyrris.com/r/${partner.referralCode.toLowerCase()}`)
                    .then(() => toast.success("Link corto de referido copiado"))
                }
              >
                <Copy className="w-4 h-4 mr-1" /> Link corto
              </Button>
              <Button size="sm" variant="outline" onClick={() => resendInvite.mutate({ partnerId })} disabled={resendInvite.isPending}>
                <Mail className="w-4 h-4 mr-1" /> Reenviar invitación
              </Button>
              {partner.status === "paused" ? (
                <Button size="sm" variant="outline" onClick={() => updateMutation.mutate({ partnerId, status: "active" })}>
                  <Play className="w-4 h-4 mr-1" /> Reactivar
                </Button>
              ) : (
                <Button size="sm" variant="outline" onClick={() => updateMutation.mutate({ partnerId, status: "paused" })}>
                  <Pause className="w-4 h-4 mr-1" /> Pausar
                </Button>
              )}
              <Button size="sm" variant="outline" onClick={() => markContract.mutate({ partnerId })} disabled={markContract.isPending}>
                <BadgeCheck className="w-4 h-4 mr-1" /> Marcar contrato firmado
              </Button>
            </div>

            <Tabs defaultValue="referrals" className="mt-2">
              <TabsList className="flex-wrap h-auto">
                <TabsTrigger value="referrals">Referidos ({data.attributions.length})</TabsTrigger>
                <TabsTrigger value="commissions">Comisiones ({data.commissions.length})</TabsTrigger>
                <TabsTrigger value="documents">Documentos ({data.documents.length})</TabsTrigger>
                <TabsTrigger value="invitations">Invitaciones ({invitationsQuery.data?.length ?? 0})</TabsTrigger>
                <TabsTrigger value="payouts">Liquidaciones ({data.payouts.length})</TabsTrigger>
              </TabsList>

              <TabsContent value="referrals" className="space-y-4">
                <div className="flex flex-wrap items-end gap-2 border rounded-lg p-3">
                  <div className="space-y-1 flex-1 min-w-[220px]">
                    <label className="text-xs font-medium text-muted-foreground">
                      Atribución manual: ID del contractor en LeadPrime
                    </label>
                    <Input
                      value={manualContractorId}
                      onChange={e => setManualContractorId(e.target.value)}
                      placeholder="contractor id"
                      className="h-9"
                    />
                  </div>
                  <Button
                    size="sm"
                    disabled={!manualContractorId.trim() || attributeReferral.isPending}
                    onClick={() =>
                      attributeReferral.mutate({
                        referralCode: partner.referralCode,
                        contractorId: manualContractorId.trim(),
                      })
                    }
                  >
                    Atribuir
                  </Button>
                </div>
                {data.attributions.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-6">Sin referidos aún.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Negocio</TableHead>
                          <TableHead>Usuario</TableHead>
                          <TableHead>Registro</TableHead>
                          <TableHead>1er pago</TableHead>
                          <TableHead>Estado</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {data.attributions.map(a => (
                          <TableRow key={a.id}>
                            <TableCell className="font-medium">
                              {data.referredInfo[a.referredUserId]?.businessName ?? "—"}
                            </TableCell>
                            <TableCell>
                              <code className="text-xs bg-muted px-1 rounded">{a.referredUserId}</code>
                            </TableCell>
                            <TableCell className="text-sm text-muted-foreground">{shortDate(a.signupDate)}</TableCell>
                            <TableCell className="text-sm text-muted-foreground">
                              {a.firstPaymentDate ? shortDate(a.firstPaymentDate) : "—"}
                            </TableCell>
                            <TableCell>
                              <Badge variant="outline">
                                {a.status === "active" ? "Activo" : a.status === "pending_first_payment" ? "Pendiente 1er pago" : "Inactivo"}
                              </Badge>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </TabsContent>

              <TabsContent value="commissions">
                {data.commissions.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-6">
                    Sin comisiones. Usa "Sincronizar comisiones" tras registrar cobros.
                  </p>
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Fecha</TableHead>
                          <TableHead>Fuente</TableHead>
                          <TableHead className="text-right">Cobro</TableHead>
                          <TableHead className="text-right">%</TableHead>
                          <TableHead className="text-right">Comisión</TableHead>
                          <TableHead>Estado</TableHead>
                          <TableHead />
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {data.commissions.map(c => (
                          <TableRow key={c.id} className={c.isReversal ? "opacity-70" : ""}>
                            <TableCell className="text-sm whitespace-nowrap">{shortDate(c.chargeDate)}</TableCell>
                            <TableCell>
                              <code className="text-xs bg-muted px-1 rounded">{c.sourcePaymentId.slice(0, 28)}</code>
                              {c.isReversal && (
                                <Badge variant="outline" className="ml-1 bg-red-500/15 text-red-400 border-red-500/30">
                                  Reversión
                                </Badge>
                              )}
                            </TableCell>
                            <TableCell className="text-right text-sm">{money(c.chargeAmount)}</TableCell>
                            <TableCell className="text-right text-sm">{parseFloat(c.appliedPct)}%</TableCell>
                            <TableCell className="text-right font-medium">{money(c.commissionAmount)}</TableCell>
                            <TableCell>
                              <Badge variant="outline">{c.payoutStatus === "paid" ? "Pagada" : "Pendiente"}</Badge>
                            </TableCell>
                            <TableCell>
                              {!c.isReversal && c.payoutStatus === "pending" && (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  title="Registrar reversión (reembolso/contracargo)"
                                  onClick={() => {
                                    const reason = window.prompt("Motivo de la reversión (reembolso, contracargo...):");
                                    if (reason && reason.trim().length >= 3) {
                                      reverseCommission.mutate({ commissionId: c.id, reason: reason.trim() });
                                    }
                                  }}
                                >
                                  <Undo2 className="w-4 h-4" />
                                </Button>
                              )}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </TabsContent>

              <TabsContent value="documents" className="space-y-4">
                {/* Admin uploads documents FOR this partner (materiales + reportes) */}
                <div className="flex flex-wrap items-center justify-between gap-2 border rounded-lg p-3">
                  <div>
                    <p className="text-sm font-medium">Documentos del socio</p>
                    <p className="text-xs text-muted-foreground">
                      Sube materiales informativos o reportes para este socio. Solo él los ve
                      (aislamiento multi-tenant). Aquí también ves lo que el socio subió firmado.
                    </p>
                  </div>
                  <Button size="sm" onClick={() => setDocUploadOpen(true)}>
                    <Upload className="w-4 h-4 mr-1" /> Subir documento
                  </Button>
                </div>

                <AdminUploadDialog
                  open={docUploadOpen}
                  onOpenChange={setDocUploadOpen}
                  pending={uploadDoc.isPending}
                  onUpload={async ({ docType, title, fileName, contentType, base64Data }) => {
                    await uploadDoc.mutateAsync({ partnerId, docType, title, fileName, contentType, base64Data });
                    setDocUploadOpen(false);
                  }}
                />

                {data.documents.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-6">
                    Sin documentos aún. Usa "Subir documento" para agregar materiales o reportes.
                  </p>
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Tipo</TableHead>
                          <TableHead>Archivo</TableHead>
                          <TableHead>Estado</TableHead>
                          <TableHead>Subido</TableHead>
                          <TableHead />
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {data.documents.map(doc => (
                          <TableRow key={doc.id}>
                            <TableCell className="font-medium">
                              {doc.docType === "report" && doc.title ? doc.title : DOC_LABEL[doc.docType] ?? doc.docType}
                              {doc.docType === "report" && (
                                <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded-full bg-amber-500/15 text-amber-400">
                                  Reporte
                                </span>
                              )}
                              <span className={`ml-2 text-[10px] px-1.5 py-0.5 rounded-full ${doc.uploadedBy === "admin" ? "bg-blue-500/15 text-blue-400" : "bg-zinc-500/15 text-zinc-400"}`}>
                                {doc.uploadedBy === "admin" ? "LeadPrime" : "Socio"}
                              </span>
                            </TableCell>
                            <TableCell className="text-sm text-muted-foreground max-w-[240px] truncate">
                              {doc.fileUrl ? (
                                <a href={doc.fileUrl} target="_blank" rel="noreferrer" className="text-primary hover:underline">
                                  {doc.fileName ?? "ver archivo"}
                                </a>
                              ) : (
                                doc.fileName ?? "—"
                              )}
                            </TableCell>
                            <TableCell>
                              <Badge variant="outline">
                                {doc.status === "verified" ? "Verificado" : doc.status === "uploaded" ? "Subido" : "Pendiente"}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-sm text-muted-foreground">
                              {doc.uploadedAt ? shortDate(doc.uploadedAt) : "—"}
                            </TableCell>
                            <TableCell>
                              <div className="flex gap-1">
                                {doc.uploadedBy === "partner" && doc.status !== "verified" && (
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => verifyDoc.mutate({ documentId: doc.id })}
                                    disabled={verifyDoc.isPending}
                                  >
                                    <BadgeCheck className="w-4 h-4 mr-1" /> Verificar
                                  </Button>
                                )}
                                {doc.uploadedBy === "admin" && (
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    className="text-destructive"
                                    onClick={() => {
                                      if (window.confirm("¿Eliminar este documento informativo?")) {
                                        deleteDoc.mutate({ documentId: doc.id });
                                      }
                                    }}
                                    disabled={deleteDoc.isPending}
                                  >
                                    <Trash2 className="w-4 h-4" />
                                  </Button>
                                )}
                              </div>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </TabsContent>

              <TabsContent value="invitations">
                {invitationsQuery.isLoading ? (
                  <div className="flex justify-center py-6">
                    <Loader2 className="w-6 h-6 animate-spin text-primary" />
                  </div>
                ) : (invitationsQuery.data?.length ?? 0) === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-6">
                    Este socio no ha enviado invitaciones.
                  </p>
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Correo</TableHead>
                          <TableHead>Estado</TableHead>
                          <TableHead>Enviada</TableHead>
                          <TableHead>Registrada</TableHead>
                          <TableHead />
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {invitationsQuery.data!.map(inv => (
                          <TableRow key={inv.id}>
                            <TableCell className="font-medium max-w-[220px] truncate">{inv.email}</TableCell>
                            <TableCell><Badge variant="outline">{inv.status}</Badge></TableCell>
                            <TableCell className="text-sm text-muted-foreground">{inv.sentAt ? shortDate(inv.sentAt) : "—"}</TableCell>
                            <TableCell className="text-sm text-muted-foreground">{inv.registeredAt ? shortDate(inv.registeredAt) : "—"}</TableCell>
                            <TableCell>
                              {inv.status === "pending_approval" && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => approveInvitation.mutate({ invitationId: inv.id })}
                                  disabled={approveInvitation.isPending}
                                >
                                  Aprobar y enviar
                                </Button>
                              )}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </TabsContent>

              <TabsContent value="payouts" className="space-y-4">
                <div className="flex flex-wrap items-end gap-2 border rounded-lg p-3">
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-muted-foreground">Desde</label>
                    <Input type="date" value={periodStart} onChange={e => setPeriodStart(e.target.value)} className="h-9" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-muted-foreground">Hasta</label>
                    <Input type="date" value={periodEnd} onChange={e => setPeriodEnd(e.target.value)} className="h-9" />
                  </div>
                  <Button
                    size="sm"
                    disabled={generatePayout.isPending}
                    onClick={() =>
                      generatePayout.mutate({
                        partnerId,
                        periodStart: new Date(`${periodStart}T00:00:00Z`).toISOString(),
                        periodEnd: new Date(`${periodEnd}T23:59:59Z`).toISOString(),
                      })
                    }
                  >
                    {generatePayout.isPending ? (
                      <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                    ) : null}
                    Generar liquidación del periodo
                  </Button>
                </div>
                {data.payouts.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-6">Sin liquidaciones.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Periodo</TableHead>
                          <TableHead className="text-right">Monto</TableHead>
                          <TableHead>Estado</TableHead>
                          <TableHead>Pagado</TableHead>
                          <TableHead />
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {data.payouts.map(p => (
                          <TableRow key={p.id}>
                            <TableCell className="text-sm whitespace-nowrap">
                              {shortDate(p.periodStart)} – {shortDate(p.periodEnd)}
                            </TableCell>
                            <TableCell className="text-right font-medium">{money(p.totalAmount)}</TableCell>
                            <TableCell>
                              <Badge variant="outline">{p.status === "paid" ? "Pagada" : "Pendiente"}</Badge>
                            </TableCell>
                            <TableCell className="text-sm text-muted-foreground">
                              {p.paidAt ? shortDate(p.paidAt) : "—"}
                            </TableCell>
                            <TableCell>
                              {p.status === "pending" && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  disabled={markPaid.isPending}
                                  onClick={() => {
                                    const method = window.prompt("Método de pago (ACH, cheque, Zelle...):", "ACH");
                                    if (method !== null) {
                                      markPaid.mutate({ payoutId: p.id, method: method || undefined });
                                    }
                                  }}
                                >
                                  Marcar pagada
                                </Button>
                              )}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </TabsContent>
            </Tabs>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
