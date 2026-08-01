import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import {
  UserCheck, Plus, RefreshCw, Copy, ExternalLink, Clock, CheckCircle2,
  XCircle, FileText, DollarSign, Calendar, ChevronRight,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ApprovedClient {
  id: number;
  contactName: string;
  companyName: string;
  email: string;
  phone?: string;
  plan: string;
  monthlyPriceCents: number;
  commitmentMonths: number;
  status: string;
  internalStatus?: string;
  tokenExpiresAt?: string;
  portalLink?: string;
  contractorId?: string;
  createdAt: string;
  specialConditions?: string;
  agreedGoals?: string;
  notes?: string;
  termSheetSignedAt?: string;
  contractSignedAt?: string;
  paidAt?: string;
}

// ─── Status helpers ───────────────────────────────────────────────────────────

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  pending_review:      { label: "Revisión pendiente",   color: "bg-yellow-100 text-yellow-800" },
  approved:            { label: "Aprobado",              color: "bg-blue-100 text-blue-800" },
  term_sheet_sent:     { label: "Term sheet enviado",    color: "bg-purple-100 text-purple-800" },
  term_sheet_signed:   { label: "Term sheet firmado",    color: "bg-indigo-100 text-indigo-800" },
  contract_sent:       { label: "Contrato enviado",      color: "bg-orange-100 text-orange-800" },
  contract_signed:     { label: "Contrato firmado",      color: "bg-teal-100 text-teal-800" },
  payment_pending:     { label: "Pago pendiente",        color: "bg-amber-100 text-amber-800" },
  active:              { label: "Activo",                color: "bg-green-100 text-green-800" },
  onboarding:          { label: "Onboarding",            color: "bg-cyan-100 text-cyan-800" },
  churned:             { label: "Churned",               color: "bg-red-100 text-red-800" },
  paused:              { label: "Pausado",               color: "bg-gray-100 text-gray-800" },
  expired:             { label: "Expirado",              color: "bg-red-100 text-red-700" },
};

function StatusBadge({ status }: { status: string }) {
  const s = STATUS_LABELS[status] ?? { label: status, color: "bg-gray-100 text-gray-700" };
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${s.color}`}>{s.label}</span>;
}

function planLabel(plan: string) {
  if (plan === "chyrris_growth") return "Growth — $650/mes";
  if (plan === "chyrris_legacy") return "Legacy";
  return plan;
}

function formatDate(d?: string) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("es-US", { year: "numeric", month: "short", day: "numeric" });
}

// ─── Create Dialog ────────────────────────────────────────────────────────────

function CreateClientDialog({ open, onClose, onCreated }: {
  open: boolean;
  onClose: () => void;
  onCreated: (client: ApprovedClient) => void;
}) {
  const [form, setForm] = useState({
    contactName: "", companyName: "", email: "", phone: "",
    plan: "chyrris_growth" as "chyrris_growth" | "chyrris_legacy",
    monthlyPriceCents: 65000, commitmentMonths: 12,
    specialConditions: "", agreedGoals: "", notes: "",
  });

  const mutation = trpc.leadprime.createApprovedClient.useMutation({
    onSuccess: (data) => {
      if (data.success && data.client) {
        toast.success('Cliente aprobado creado', { description: `Link generado para ${data.client.contactName}` });
        onCreated(data.client as ApprovedClient);
        onClose();
      } else {
        toast.error(data.error ?? 'No se pudo crear el cliente');
      }
    },
    onError: (err) => toast.error(err.message),
  });

  const set = (k: string, v: any) => setForm(f => ({ ...f, [k]: v }));

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Nuevo cliente aprobado</DialogTitle>
          <DialogDescription>
            Genera un link privado de portal para que el cliente firme el term sheet, el contrato y pague.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Nombre de contacto *</Label>
              <Input value={form.contactName} onChange={e => set("contactName", e.target.value)} placeholder="John Connor" />
            </div>
            <div>
              <Label>Empresa *</Label>
              <Input value={form.companyName} onChange={e => set("companyName", e.target.value)} placeholder="Acme Fencing LLC" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Email *</Label>
              <Input type="email" value={form.email} onChange={e => set("email", e.target.value)} placeholder="john@acme.com" />
            </div>
            <div>
              <Label>Teléfono</Label>
              <Input value={form.phone} onChange={e => set("phone", e.target.value)} placeholder="+1 555 000 0000" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Plan *</Label>
              <Select value={form.plan} onValueChange={v => {
                set("plan", v);
                set("monthlyPriceCents", v === "chyrris_growth" ? 65000 : 0);
              }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="chyrris_growth">Growth — $650/mes</SelectItem>
                  <SelectItem value="chyrris_legacy">Legacy (precio personalizado)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Precio mensual (cents)</Label>
              <Input
                type="number"
                value={form.monthlyPriceCents}
                onChange={e => set("monthlyPriceCents", parseInt(e.target.value) || 0)}
                placeholder="65000"
              />
              <p className="text-xs text-muted-foreground mt-1">${(form.monthlyPriceCents / 100).toFixed(2)}/mes</p>
            </div>
          </div>

          <div>
            <Label>Meses de compromiso</Label>
            <Input
              type="number"
              value={form.commitmentMonths}
              onChange={e => set("commitmentMonths", parseInt(e.target.value) || 12)}
              min={1} max={36}
            />
          </div>

          <div>
            <Label>Condiciones especiales (aparecen en el term sheet)</Label>
            <Textarea
              value={form.specialConditions}
              onChange={e => set("specialConditions", e.target.value)}
              placeholder="Descuento de onboarding, período de gracia, etc."
              rows={2}
            />
          </div>

          <div>
            <Label>Objetivos acordados (aparecen en el contrato)</Label>
            <Textarea
              value={form.agreedGoals}
              onChange={e => set("agreedGoals", e.target.value)}
              placeholder="Incrementar leads un 30% en 6 meses, etc."
              rows={2}
            />
          </div>

          <div>
            <Label>Notas internas (no visibles para el cliente)</Label>
            <Textarea
              value={form.notes}
              onChange={e => set("notes", e.target.value)}
              placeholder="Referido por Prime, llamada inicial el 2026-07-30..."
              rows={2}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button
            onClick={() => mutation.mutate(form)}
            disabled={mutation.isPending || !form.contactName || !form.companyName || !form.email}
          >
            {mutation.isPending ? "Creando..." : "Crear y generar link"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Client Detail Dialog ─────────────────────────────────────────────────────

function ClientDetailDialog({ client, open, onClose }: {
  client: ApprovedClient;
  open: boolean;
  onClose: () => void;
}) {
  const [portalLink, setPortalLink] = useState(client.portalLink ?? "");
  const [tokenExpiresAt, setTokenExpiresAt] = useState(client.tokenExpiresAt ?? "");

  const regenMutation = trpc.leadprime.regenerateApprovedClientToken.useMutation({
    onSuccess: (data) => {
      if (data.success && 'portalLink' in data) {
        setPortalLink((data as any).portalLink ?? "");
        setTokenExpiresAt((data as any).tokenExpiresAt ?? "");
        toast.success('Token regenerado', { description: 'Nuevo link válido por 30 días' });
      } else {
        toast.error(data.error ?? 'Error desconocido');
      }
    },
    onError: (err) => toast.error(err.message),
  });

  const copyLink = () => {
    if (portalLink) {
      navigator.clipboard.writeText(portalLink);
      toast.success('Link copiado');
    }
  };

  const isExpired = tokenExpiresAt && new Date(tokenExpiresAt) < new Date();

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{client.contactName}</DialogTitle>
          <DialogDescription>{client.companyName}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Status */}
          <div className="flex items-center gap-2">
            <StatusBadge status={client.status} />
            <span className="text-sm text-muted-foreground">{planLabel(client.plan)}</span>
          </div>

          {/* Key info */}
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div><span className="text-muted-foreground">Email:</span> {client.email}</div>
            <div><span className="text-muted-foreground">Teléfono:</span> {client.phone ?? "—"}</div>
            <div><span className="text-muted-foreground">Precio:</span> ${(client.monthlyPriceCents / 100).toFixed(2)}/mes</div>
            <div><span className="text-muted-foreground">Compromiso:</span> {client.commitmentMonths} meses</div>
            <div><span className="text-muted-foreground">Creado:</span> {formatDate(client.createdAt)}</div>
            <div><span className="text-muted-foreground">Contractor ID:</span> {client.contractorId ?? "—"}</div>
          </div>

          {/* Timeline */}
          <div className="space-y-1 text-sm">
            <p className="font-medium text-xs text-muted-foreground uppercase tracking-wide">Progreso</p>
            {[
              { label: "Term sheet firmado", date: client.termSheetSignedAt, icon: FileText },
              { label: "Contrato firmado", date: client.contractSignedAt, icon: CheckCircle2 },
              { label: "Primer pago", date: client.paidAt, icon: DollarSign },
            ].map(({ label, date, icon: Icon }) => (
              <div key={label} className="flex items-center gap-2">
                <Icon className={`h-4 w-4 ${date ? "text-green-500" : "text-muted-foreground"}`} />
                <span className={date ? "text-foreground" : "text-muted-foreground"}>{label}</span>
                {date && <span className="ml-auto text-xs text-muted-foreground">{formatDate(date)}</span>}
              </div>
            ))}
          </div>

          {/* Portal link */}
          {portalLink && (
            <div className="space-y-2">
              <p className="font-medium text-xs text-muted-foreground uppercase tracking-wide">Link del portal</p>
              <div className="flex items-center gap-2">
                <Input value={portalLink} readOnly className="text-xs font-mono" />
                <Button size="icon" variant="outline" onClick={copyLink}><Copy className="h-4 w-4" /></Button>
                <Button size="icon" variant="outline" onClick={() => window.open(portalLink, "_blank")}>
                  <ExternalLink className="h-4 w-4" />
                </Button>
              </div>
              {tokenExpiresAt && (
                <p className={`text-xs ${isExpired ? "text-red-500" : "text-muted-foreground"}`}>
                  {isExpired ? "⚠ Token expirado" : `Expira: ${formatDate(tokenExpiresAt)}`}
                </p>
              )}
            </div>
          )}

          {/* Special conditions / goals */}
          {client.specialConditions && (
            <div>
              <p className="font-medium text-xs text-muted-foreground uppercase tracking-wide mb-1">Condiciones especiales</p>
              <p className="text-sm">{client.specialConditions}</p>
            </div>
          )}
          {client.agreedGoals && (
            <div>
              <p className="font-medium text-xs text-muted-foreground uppercase tracking-wide mb-1">Objetivos acordados</p>
              <p className="text-sm">{client.agreedGoals}</p>
            </div>
          )}
          {client.notes && (
            <div>
              <p className="font-medium text-xs text-muted-foreground uppercase tracking-wide mb-1">Notas internas</p>
              <p className="text-sm text-muted-foreground">{client.notes}</p>
            </div>
          )}
        </div>

        <DialogFooter className="flex-col gap-2 sm:flex-row">
          <Button
            variant="outline"
            onClick={() => regenMutation.mutate({ id: client.id })}
            disabled={regenMutation.isPending}
            className="gap-2"
          >
            <RefreshCw className={`h-4 w-4 ${regenMutation.isPending ? "animate-spin" : ""}`} />
            Regenerar token
          </Button>
          <Button variant="outline" onClick={onClose}>Cerrar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function LeadPrimeApprovedClients() {
  const [showCreate, setShowCreate] = useState(false);
  const [selectedClient, setSelectedClient] = useState<ApprovedClient | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [planFilter, setPlanFilter] = useState<string>("all");
  const [newlyCreated, setNewlyCreated] = useState<ApprovedClient | null>(null);

  const query = trpc.leadprime.listApprovedClients.useQuery(
    {
      status: statusFilter !== "all" ? statusFilter : undefined,
      plan: planFilter !== "all" ? planFilter : undefined,
      limit: 100,
    },
    { refetchInterval: 30000 }
  );

  const clients: ApprovedClient[] = (query.data?.clients ?? []) as ApprovedClient[];

  // Stats
  const stats = {
    total: clients.length,
    active: clients.filter(c => c.status === "active").length,
    pending: clients.filter(c => ["pending_review", "approved", "term_sheet_sent", "term_sheet_signed", "contract_sent", "contract_signed", "payment_pending"].includes(c.status)).length,
    mrr: clients.filter(c => c.status === "active").reduce((sum, c) => sum + c.monthlyPriceCents, 0),
  };

  const handleCreated = (client: ApprovedClient) => {
    setNewlyCreated(client);
    query.refetch();
  };

  const copyLink = (link: string) => {
    navigator.clipboard.writeText(link);
    toast.success('Link copiado al portapapeles');
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <UserCheck className="h-6 w-6 text-primary" />
            Clientes Aprobados
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Portal privado de firma y pago para clientes Growth y Legacy
          </p>
        </div>
        <Button onClick={() => setShowCreate(true)} className="gap-2">
          <Plus className="h-4 w-4" />
          Nuevo cliente aprobado
        </Button>
      </div>

      {/* Newly created banner */}
      {newlyCreated && (
        <Card className="border-green-200 bg-green-50">
          <CardContent className="py-3 px-4 flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <CheckCircle2 className="h-5 w-5 text-green-600 shrink-0" />
              <div>
                <p className="font-medium text-sm text-green-900">
                  Link generado para {newlyCreated.contactName}
                </p>
                <p className="text-xs text-green-700 font-mono truncate max-w-sm">
                  {newlyCreated.portalLink}
                </p>
              </div>
            </div>
            <div className="flex gap-2 shrink-0">
              <Button size="sm" variant="outline" onClick={() => copyLink(newlyCreated.portalLink ?? "")} className="gap-1">
                <Copy className="h-3 w-3" /> Copiar
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setNewlyCreated(null)}>
                <XCircle className="h-4 w-4" />
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: "Total", value: stats.total, icon: UserCheck, color: "text-blue-600" },
          { label: "Activos", value: stats.active, icon: CheckCircle2, color: "text-green-600" },
          { label: "En proceso", value: stats.pending, icon: Clock, color: "text-amber-600" },
          { label: "MRR aprobados", value: `$${(stats.mrr / 100).toLocaleString()}`, icon: DollarSign, color: "text-purple-600" },
        ].map(({ label, value, icon: Icon, color }) => (
          <Card key={label}>
            <CardContent className="py-4 px-4 flex items-center gap-3">
              <Icon className={`h-8 w-8 ${color} opacity-80`} />
              <div>
                <p className="text-2xl font-bold">{value}</p>
                <p className="text-xs text-muted-foreground">{label}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Filters */}
      <div className="flex gap-3 flex-wrap">
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-48">
            <SelectValue placeholder="Filtrar por estado" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos los estados</SelectItem>
            {Object.entries(STATUS_LABELS).map(([k, v]) => (
              <SelectItem key={k} value={k}>{v.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={planFilter} onValueChange={setPlanFilter}>
          <SelectTrigger className="w-44">
            <SelectValue placeholder="Filtrar por plan" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos los planes</SelectItem>
            <SelectItem value="chyrris_growth">Growth</SelectItem>
            <SelectItem value="chyrris_legacy">Legacy</SelectItem>
          </SelectContent>
        </Select>

        <Button variant="outline" size="sm" onClick={() => query.refetch()} className="gap-1">
          <RefreshCw className={`h-4 w-4 ${query.isFetching ? "animate-spin" : ""}`} />
          Actualizar
        </Button>
      </div>

      {/* Client list */}
      {query.isLoading ? (
        <div className="text-center py-12 text-muted-foreground">Cargando clientes aprobados...</div>
      ) : clients.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <UserCheck className="h-12 w-12 text-muted-foreground mx-auto mb-3 opacity-40" />
            <p className="font-medium">No hay clientes aprobados todavía</p>
            <p className="text-sm text-muted-foreground mt-1">
              Crea el primer cliente aprobado para generar su link de portal privado.
            </p>
            <Button className="mt-4 gap-2" onClick={() => setShowCreate(true)}>
              <Plus className="h-4 w-4" /> Crear primer cliente
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {clients.map((client) => (
            <Card
              key={client.id}
              className="cursor-pointer hover:shadow-md transition-shadow"
              onClick={() => setSelectedClient(client)}
            >
              <CardContent className="py-3 px-4">
                <div className="flex items-center gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-sm">{client.contactName}</span>
                      <span className="text-muted-foreground text-sm">·</span>
                      <span className="text-sm text-muted-foreground truncate">{client.companyName}</span>
                    </div>
                    <div className="flex items-center gap-2 mt-1 flex-wrap">
                      <StatusBadge status={client.status} />
                      <span className="text-xs text-muted-foreground">{planLabel(client.plan)}</span>
                      <span className="text-xs text-muted-foreground">·</span>
                      <span className="text-xs text-muted-foreground">{client.email}</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 shrink-0">
                    <div className="text-right hidden sm:block">
                      <p className="text-sm font-medium">${(client.monthlyPriceCents / 100).toFixed(0)}/mes</p>
                      <p className="text-xs text-muted-foreground flex items-center gap-1">
                        <Calendar className="h-3 w-3" />
                        {formatDate(client.createdAt)}
                      </p>
                    </div>

                    {client.portalLink && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={(e) => { e.stopPropagation(); copyLink(client.portalLink!); }}
                        className="gap-1 text-xs"
                      >
                        <Copy className="h-3 w-3" />
                        Link
                      </Button>
                    )}

                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Dialogs */}
      <CreateClientDialog
        open={showCreate}
        onClose={() => setShowCreate(false)}
        onCreated={handleCreated}
      />

      {selectedClient && (
        <ClientDetailDialog
          client={selectedClient}
          open={!!selectedClient}
          onClose={() => setSelectedClient(null)}
        />
      )}
    </div>
  );
}
