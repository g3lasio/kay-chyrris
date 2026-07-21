/**
 * LeadPrime — Suscripciones Pendientes de Vinculación
 *
 * Panel para gestionar los pagos recibidos por los portales /join/growth y
 * /join/legacy. Muestra los registros en pending_subscriptions que aún no
 * tienen una cuenta de contratista vinculada (status = 'paid').
 *
 * Flujo:
 *   1. El contratista paga en /join/growth o /join/legacy (Stripe ACH).
 *   2. El webhook de Stripe escribe el registro en pending_subscriptions.
 *   3. G. Sánchez crea la cuenta del contratista en LeadPrime.
 *   4. Aquí se vincula el pending_id con el contractor_id → activa el tier.
 */

import { useState } from 'react';
import { trpc } from '@/lib/trpc';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import {
  Loader2,
  RefreshCw,
  Link2,
  CheckCircle2,
  Clock,
  AlertCircle,
  ExternalLink,
  User,
  Building2,
  Mail,
  Phone,
  DollarSign,
  CreditCard,
  CalendarDays,
  Search,
  Filter,
  ChevronRight,
} from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────

interface PendingSubscription {
  id: number;
  tier: string;
  businessName: string | null;
  contactName: string | null;
  email: string;
  phone: string | null;
  stripeCustomerId: string;
  stripeSubscriptionId: string;
  stripeInvoiceId: string | null;
  amountPaidCents: number;
  status: 'paid' | 'linked' | 'failed';
  goodFaithConfirmed: boolean;
  paidAt: string | null;
  linkedContractorId: string | null;
  createdAt: string;
  updatedAt: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('es-MX', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function fmtDollars(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function tierLabel(tier: string): string {
  if (tier === 'chyrris_growth') return 'Growth';
  if (tier === 'chyrris_legacy') return 'Legacy';
  return tier;
}

function tierColor(tier: string): string {
  if (tier === 'chyrris_growth') return 'bg-violet-500/20 text-violet-300 border-violet-500/30';
  if (tier === 'chyrris_legacy') return 'bg-amber-500/20 text-amber-300 border-amber-500/30';
  return 'bg-muted text-muted-foreground';
}

function statusBadge(status: string) {
  if (status === 'paid') {
    return (
      <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-yellow-500/15 text-yellow-300 border border-yellow-500/30">
        <Clock className="h-3 w-3" /> Pendiente
      </span>
    );
  }
  if (status === 'linked') {
    return (
      <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-green-500/15 text-green-300 border border-green-500/30">
        <CheckCircle2 className="h-3 w-3" /> Vinculado
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-red-500/15 text-red-300 border border-red-500/30">
      <AlertCircle className="h-3 w-3" /> Fallido
    </span>
  );
}

// ─── Link Modal ───────────────────────────────────────────────────────────────

interface LinkModalProps {
  pending: PendingSubscription;
  onClose: () => void;
  onSuccess: () => void;
}

function LinkModal({ pending, onClose, onSuccess }: LinkModalProps) {
  const [contractorId, setContractorId] = useState('');
  const [staffPhone, setStaffPhone] = useState('');
  const [staffEmail, setStaffEmail] = useState('');
  const [staffName, setStaffName] = useState('');
  const [addStaff, setAddStaff] = useState(false);

  const utils = trpc.useUtils();
  const linkMutation = trpc.leadprime.linkPendingSubscription.useMutation({
    onSuccess: (data) => {
      if (data.success) {
        toast.success(
          `✅ Vinculado correctamente — Tier: ${tierLabel(data.tier ?? '')}${data.creditsGrantedCents ? ` · ${fmtDollars(data.creditsGrantedCents)} en créditos otorgados` : ''}${data.staffAdded ? ' · Staff agregado' : ''}`
        );
        utils.leadprime.getPendingSubscriptions.invalidate();
        onSuccess();
      } else {
        toast.error(data.error ?? 'Error al vincular');
      }
    },
    onError: (err) => {
      toast.error(err.message ?? 'Error inesperado');
    },
  });

  function handleLink() {
    if (!contractorId.trim()) {
      toast.error('Ingresa el Contractor ID');
      return;
    }
    if (addStaff && !staffPhone.trim()) {
      toast.error('El teléfono del staff es requerido');
      return;
    }
    linkMutation.mutate({
      pendingId: pending.id,
      contractorId: contractorId.trim(),
      staff: addStaff && staffPhone.trim()
        ? { phone: staffPhone.trim(), email: staffEmail.trim() || undefined, name: staffName.trim() || undefined }
        : null,
    });
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Link2 className="h-5 w-5 text-violet-400" />
            Vincular Suscripción #{pending.id}
          </DialogTitle>
          <DialogDescription>
            Vincula este pago a una cuenta de contratista existente en LeadPrime.
            Esto activará el tier <strong>{tierLabel(pending.tier)}</strong> en la cuenta seleccionada.
          </DialogDescription>
        </DialogHeader>

        {/* Pending summary */}
        <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-1.5 text-sm">
          <div className="flex items-center gap-2">
            <Building2 className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <span className="font-medium">{pending.businessName ?? pending.contactName ?? '—'}</span>
            <span className={`ml-auto text-xs px-1.5 py-0.5 rounded border ${tierColor(pending.tier)}`}>
              {tierLabel(pending.tier)}
            </span>
          </div>
          <div className="flex items-center gap-2 text-muted-foreground">
            <Mail className="h-3.5 w-3.5 shrink-0" />
            <span>{pending.email}</span>
          </div>
          {pending.phone && (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Phone className="h-3.5 w-3.5 shrink-0" />
              <span>{pending.phone}</span>
            </div>
          )}
          <div className="flex items-center gap-2 text-muted-foreground">
            <DollarSign className="h-3.5 w-3.5 shrink-0" />
            <span>{fmtDollars(pending.amountPaidCents)} pagados · {fmtDate(pending.paidAt)}</span>
          </div>
          <div className="flex items-center gap-2 text-muted-foreground">
            <CreditCard className="h-3.5 w-3.5 shrink-0" />
            <a
              href={`https://dashboard.stripe.com/customers/${pending.stripeCustomerId}`}
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-foreground transition-colors flex items-center gap-1"
            >
              {pending.stripeCustomerId}
              <ExternalLink className="h-3 w-3" />
            </a>
          </div>
        </div>

        {/* Contractor ID input */}
        <div className="space-y-1.5">
          <Label htmlFor="contractor-id">Contractor ID (LeadPrime)</Label>
          <Input
            id="contractor-id"
            placeholder="con_xxxxxxxxxxxxxxxxxxxx"
            value={contractorId}
            onChange={(e) => setContractorId(e.target.value)}
            className="font-mono text-sm"
          />
          <p className="text-xs text-muted-foreground">
            Encuéntralo en la tabla de Usuarios → columna ID del contratista.
          </p>
        </div>

        {/* Optional staff */}
        <div className="space-y-2">
          <button
            type="button"
            onClick={() => setAddStaff(v => !v)}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <ChevronRight className={`h-3.5 w-3.5 transition-transform ${addStaff ? 'rotate-90' : ''}`} />
            Agregar miembro de staff a la cuenta (opcional)
          </button>
          {addStaff && (
            <div className="rounded-lg border border-border p-3 space-y-2">
              <div className="space-y-1">
                <Label htmlFor="staff-phone" className="text-xs">Teléfono del staff *</Label>
                <Input
                  id="staff-phone"
                  placeholder="+15551234567"
                  value={staffPhone}
                  onChange={(e) => setStaffPhone(e.target.value)}
                  className="text-sm h-8"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label htmlFor="staff-email" className="text-xs">Email (opcional)</Label>
                  <Input
                    id="staff-email"
                    placeholder="staff@empresa.com"
                    value={staffEmail}
                    onChange={(e) => setStaffEmail(e.target.value)}
                    className="text-sm h-8"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="staff-name" className="text-xs">Nombre (opcional)</Label>
                  <Input
                    id="staff-name"
                    placeholder="Juan Pérez"
                    value={staffName}
                    onChange={(e) => setStaffName(e.target.value)}
                    className="text-sm h-8"
                  />
                </div>
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={linkMutation.isPending}>
            Cancelar
          </Button>
          <Button
            className="bg-violet-600 hover:bg-violet-700 text-white"
            onClick={handleLink}
            disabled={linkMutation.isPending || !contractorId.trim()}
          >
            {linkMutation.isPending
              ? <><Loader2 className="h-4 w-4 animate-spin mr-1.5" /> Vinculando...</>
              : <><Link2 className="h-4 w-4 mr-1.5" /> Vincular y Activar Tier</>
            }
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function LeadPrimePendingSubscriptions() {
  const [statusFilter, setStatusFilter] = useState<'paid' | 'linked' | 'failed' | 'all'>('paid');
  const [search, setSearch] = useState('');
  const [linkTarget, setLinkTarget] = useState<PendingSubscription | null>(null);

  const query = trpc.leadprime.getPendingSubscriptions.useQuery(
    { status: statusFilter, limit: 200, offset: 0 },
    { staleTime: 0, refetchInterval: 30_000 }
  );

  const rows: PendingSubscription[] = (query.data?.data ?? []) as PendingSubscription[];
  const total = query.data?.total ?? 0;

  // Client-side search filter
  const filtered = search.trim()
    ? rows.filter(r => {
        const q = search.toLowerCase();
        return (
          r.email.toLowerCase().includes(q) ||
          (r.businessName ?? '').toLowerCase().includes(q) ||
          (r.contactName ?? '').toLowerCase().includes(q) ||
          (r.phone ?? '').includes(q) ||
          r.stripeCustomerId.toLowerCase().includes(q) ||
          String(r.id).includes(q)
        );
      })
    : rows;

  const pendingCount = rows.filter(r => r.status === 'paid').length;

  return (
    <div className="space-y-5 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold flex items-center gap-2">
            <Link2 className="h-5 w-5 text-violet-400" />
            Suscripciones Pendientes
            {pendingCount > 0 && statusFilter === 'paid' && (
              <span className="ml-1 text-xs bg-yellow-500/20 text-yellow-300 border border-yellow-500/30 px-2 py-0.5 rounded-full">
                {pendingCount} sin vincular
              </span>
            )}
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Pagos recibidos por los portales <code className="text-xs bg-muted px-1 rounded">/join/growth</code> y{' '}
            <code className="text-xs bg-muted px-1 rounded">/join/legacy</code> que esperan vinculación a una cuenta.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => query.refetch()}
          disabled={query.isFetching}
          className="shrink-0"
        >
          <RefreshCw className={`h-4 w-4 mr-1.5 ${query.isFetching ? 'animate-spin' : ''}`} />
          Actualizar
        </Button>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: 'Total registros', value: total, icon: CreditCard, color: 'text-muted-foreground' },
          { label: 'Sin vincular', value: rows.filter(r => r.status === 'paid').length, icon: Clock, color: 'text-yellow-400' },
          { label: 'Vinculados', value: rows.filter(r => r.status === 'linked').length, icon: CheckCircle2, color: 'text-green-400' },
        ].map(stat => (
          <div key={stat.label} className="rounded-lg border border-border bg-card p-3 flex items-center gap-3">
            <stat.icon className={`h-5 w-5 ${stat.color} shrink-0`} />
            <div>
              <p className="text-lg font-semibold leading-none">{stat.value}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{stat.label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          <Input
            placeholder="Buscar por email, negocio, teléfono, ID..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8 h-9 text-sm"
          />
        </div>
        <div className="flex items-center gap-2">
          <Filter className="h-4 w-4 text-muted-foreground" />
          <Select
            value={statusFilter}
            onValueChange={(v) => setStatusFilter(v as typeof statusFilter)}
          >
            <SelectTrigger className="h-9 w-36 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="paid">Sin vincular</SelectItem>
              <SelectItem value="linked">Vinculados</SelectItem>
              <SelectItem value="failed">Fallidos</SelectItem>
              <SelectItem value="all">Todos</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Table */}
      {query.isLoading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-2">
          <CheckCircle2 className="h-8 w-8 text-green-400/60" />
          <p className="text-sm">
            {statusFilter === 'paid'
              ? 'No hay suscripciones pendientes de vinculación.'
              : 'No se encontraron registros con este filtro.'}
          </p>
        </div>
      ) : (
        <div className="rounded-xl border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                <th className="text-left px-4 py-2.5 font-medium text-muted-foreground text-xs">#</th>
                <th className="text-left px-4 py-2.5 font-medium text-muted-foreground text-xs">Negocio / Contacto</th>
                <th className="text-left px-4 py-2.5 font-medium text-muted-foreground text-xs">Tier</th>
                <th className="text-left px-4 py-2.5 font-medium text-muted-foreground text-xs">Monto</th>
                <th className="text-left px-4 py-2.5 font-medium text-muted-foreground text-xs">Estado</th>
                <th className="text-left px-4 py-2.5 font-medium text-muted-foreground text-xs">Fecha</th>
                <th className="text-left px-4 py-2.5 font-medium text-muted-foreground text-xs">Stripe</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.map((row) => (
                <tr key={row.id} className="hover:bg-muted/20 transition-colors">
                  <td className="px-4 py-3 text-muted-foreground font-mono text-xs">{row.id}</td>
                  <td className="px-4 py-3">
                    <div className="font-medium leading-tight">
                      {row.businessName ?? row.contactName ?? '—'}
                    </div>
                    <div className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                      <Mail className="h-3 w-3" />
                      {row.email}
                    </div>
                    {row.phone && (
                      <div className="text-xs text-muted-foreground flex items-center gap-1">
                        <Phone className="h-3 w-3" />
                        {row.phone}
                      </div>
                    )}
                    {row.linkedContractorId && (
                      <div className="text-xs text-green-400/80 flex items-center gap-1 mt-0.5 font-mono">
                        <User className="h-3 w-3" />
                        {row.linkedContractorId}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-xs px-1.5 py-0.5 rounded border ${tierColor(row.tier)}`}>
                      {tierLabel(row.tier)}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-medium tabular-nums">
                    {fmtDollars(row.amountPaidCents)}
                  </td>
                  <td className="px-4 py-3">
                    {statusBadge(row.status)}
                    {row.goodFaithConfirmed && (
                      <div className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
                        <CheckCircle2 className="h-3 w-3 text-green-400/60" />
                        Buena fe confirmada
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    <div className="flex items-center gap-1">
                      <CalendarDays className="h-3 w-3" />
                      {fmtDate(row.paidAt ?? row.createdAt)}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <a
                      href={`https://dashboard.stripe.com/customers/${row.stripeCustomerId}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1 font-mono"
                    >
                      {row.stripeCustomerId.slice(0, 14)}…
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  </td>
                  <td className="px-4 py-3 text-right">
                    {row.status === 'paid' && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs border-violet-500/40 text-violet-300 hover:bg-violet-500/10"
                        onClick={() => setLinkTarget(row)}
                      >
                        <Link2 className="h-3.5 w-3.5 mr-1" />
                        Vincular
                      </Button>
                    )}
                    {row.status === 'linked' && (
                      <span className="text-xs text-green-400/70 flex items-center gap-1 justify-end">
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        Activo
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Link modal */}
      {linkTarget && (
        <LinkModal
          pending={linkTarget}
          onClose={() => setLinkTarget(null)}
          onSuccess={() => setLinkTarget(null)}
        />
      )}
    </div>
  );
}
