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

import { useState, useEffect } from 'react';
import { trpc } from '@/lib/trpc';
import { UserPicker, type PickedUser } from '@/components/leadprime/UserPicker';
import { SubscriptionConfigModal } from '@/components/leadprime/SubscriptionConfigModal';
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
  UserPlus,
  UserCog,
  Building2,
  Mail,
  Phone,
  DollarSign,
  CreditCard,
  CalendarDays,
  Search,
  Filter,
  ChevronRight,
  Copy,
  Check,
  X,
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

// ─── Identidad de staff Chyrris ───────────────────────────────────────────────
// Los planes Growth/Legacy ($1,200/mes) incluyen la configuración de la cuenta
// por parte de Chyrris; para eso G. Sánchez se agrega como staff (sin cargo de
// asiento). Su identidad se recuerda en localStorage tras el primer uso.

const STAFF_IDENTITY_KEY = 'kai_staff_identity';

interface StaffIdentity {
  phone: string;
  email: string;
  name: string;
}

function loadStaffIdentity(): StaffIdentity {
  try {
    const raw = localStorage.getItem(STAFF_IDENTITY_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        phone: parsed.phone ?? '',
        email: parsed.email ?? 'gelasio@chyrris.com',
        name: parsed.name ?? 'Gelasio (Chyrris)',
      };
    }
  } catch { /* localStorage no disponible o corrupto — usar defaults */ }
  return { phone: '', email: 'gelasio@chyrris.com', name: 'Gelasio (Chyrris)' };
}

function saveStaffIdentity(identity: StaffIdentity) {
  try {
    localStorage.setItem(STAFF_IDENTITY_KEY, JSON.stringify(identity));
  } catch { /* ignorar */ }
}

// ─── Link Modal ───────────────────────────────────────────────────────────────

interface LinkModalProps {
  pending: PendingSubscription;
  onClose: () => void;
  onSuccess: () => void;
}

function LinkModal({ pending, onClose, onSuccess }: LinkModalProps) {
  const savedIdentity = loadStaffIdentity();
  const [pickedUser, setPickedUser] = useState<PickedUser | null>(null);
  const contractorId = pickedUser?.id ?? '';
  const [staffPhone, setStaffPhone] = useState(savedIdentity.phone);
  const [staffEmail, setStaffEmail] = useState(savedIdentity.email);
  const [staffName, setStaffName] = useState(savedIdentity.name);
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
      toast.error('Elige la cuenta destino');
      return;
    }
    if (addStaff && !staffPhone.trim()) {
      toast.error('El teléfono del staff es requerido');
      return;
    }
    if (addStaff && staffPhone.trim()) {
      saveStaffIdentity({ phone: staffPhone.trim(), email: staffEmail.trim(), name: staffName.trim() });
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

        {/* Cuenta destino — dropdown + buscador */}
        <div className="space-y-1.5">
          <Label>Cuenta de LeadPrime destino</Label>
          <UserPicker selected={pickedUser} onSelect={setPickedUser} />
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

// ─── Create Account Modal ─────────────────────────────────────────────────────
// Crea una cuenta completa de LeadPrime desde Kai (parte del servicio de
// configuración incluido en Growth/Legacy). Si se abre desde un pago pendiente,
// prellena los datos del cliente y al crear ofrece vincular el pago en un clic.

const INDUSTRY_OPTIONS = [
  { value: 'construction', label: 'Construcción' },
  { value: 'real_estate', label: 'Bienes raíces' },
  { value: 'home_services', label: 'Servicios del hogar' },
  { value: 'other', label: 'Otro' },
];

function CreateAccountModal({ pending, onClose, onCreated }: {
  pending: PendingSubscription | null;
  onClose: () => void;
  onCreated: () => void;
}) {
  const savedIdentity = loadStaffIdentity();
  const [name, setName] = useState(pending?.contactName ?? '');
  const [businessName, setBusinessName] = useState(pending?.businessName ?? '');
  const [email, setEmail] = useState(pending?.email ?? '');
  const [phone, setPhone] = useState(pending?.phone ?? '');
  const [industry, setIndustry] = useState('construction');
  const [addStaff, setAddStaff] = useState(true);
  const [staffPhone, setStaffPhone] = useState(savedIdentity.phone);
  const [allowAdditional, setAllowAdditional] = useState(false);
  const [existingBusinesses, setExistingBusinesses] = useState<Array<{ id: string; name: string }>>([]);
  const [createdId, setCreatedId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState(false);

  const utils = trpc.useUtils();
  const createMutation = trpc.leadprime.createContractor.useMutation({
    onSuccess: (data) => {
      if (data.success && 'contractorId' in data) {
        setCreatedId(data.contractorId as string);
        setExistingBusinesses([]);
        utils.leadprime.getUsers.invalidate();
        toast.success(`✅ Cuenta creada — ${data.contractorId}${(data as any).staffAdded ? ' · Staff agregado' : ''}`);
      } else {
        if ((data as any).accountExists && (data as any).existingBusinesses?.length) {
          setExistingBusinesses((data as any).existingBusinesses);
          toast.warning('Este teléfono ya tiene cuenta(s) en LeadPrime');
        } else {
          toast.error((data as any).error ?? 'Error al crear la cuenta');
        }
      }
    },
    onError: (err) => toast.error(err.message ?? 'Error inesperado'),
  });

  const linkMutation = trpc.leadprime.linkPendingSubscription.useMutation({
    onSuccess: (data) => {
      if (data.success) {
        toast.success(`✅ Pago #${pending?.id} vinculado — Tier ${tierLabel(data.tier ?? '')} activado`);
        utils.leadprime.getPendingSubscriptions.invalidate();
        onCreated();
      } else {
        toast.error(data.error ?? 'Error al vincular');
      }
    },
    onError: (err) => toast.error(err.message ?? 'Error inesperado'),
  });

  function handleCreate() {
    if (!name.trim() || !email.trim() || !phone.trim()) {
      toast.error('Nombre, email y teléfono son requeridos');
      return;
    }
    if (addStaff && !staffPhone.trim()) {
      toast.error('Ingresa tu teléfono de staff (o desactiva la opción)');
      return;
    }
    if (addStaff && staffPhone.trim()) {
      saveStaffIdentity({ ...savedIdentity, phone: staffPhone.trim() });
    }
    createMutation.mutate({
      name: name.trim(),
      businessName: businessName.trim() || undefined,
      email: email.trim(),
      phone: phone.trim(),
      industry,
      allowAdditionalBusiness: allowAdditional,
      staff: addStaff && staffPhone.trim()
        ? { phone: staffPhone.trim(), email: savedIdentity.email || undefined, name: savedIdentity.name || undefined }
        : null,
    });
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserPlus className="h-5 w-5 text-violet-400" />
            Crear cuenta de LeadPrime
          </DialogTitle>
          <DialogDescription>
            {pending
              ? <>Crea la cuenta del cliente del pago <strong>#{pending.id}</strong> ({tierLabel(pending.tier)}) y vincúlalo en un clic.</>
              : 'Crea una cuenta completa (perfil, owner, plan base y créditos de bienvenida). El cliente entra después con su teléfono vía OTP.'}
          </DialogDescription>
        </DialogHeader>

        {createdId ? (
          // ── Paso 2: cuenta creada ─────────────────────────────────────────
          <div className="space-y-4">
            <div className="rounded-lg border border-green-500/30 bg-green-500/10 p-3 space-y-2">
              <p className="text-sm font-medium text-green-300 flex items-center gap-1.5">
                <CheckCircle2 className="h-4 w-4" /> Cuenta creada correctamente
              </p>
              <div className="flex items-center gap-2">
                <code className="text-xs font-mono flex-1 truncate">{createdId}</code>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(createdId);
                    setCopiedId(true);
                    setTimeout(() => setCopiedId(false), 2000);
                  }}
                  className="shrink-0 p-1 rounded hover:bg-accent transition-colors"
                  title="Copiar Contractor ID"
                >
                  {copiedId ? <Check className="h-3.5 w-3.5 text-green-400" /> : <Copy className="h-3.5 w-3.5" />}
                </button>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={onCreated}>Cerrar</Button>
              {pending && (
                <Button
                  className="bg-violet-600 hover:bg-violet-700 text-white"
                  onClick={() => linkMutation.mutate({ pendingId: pending.id, contractorId: createdId, staff: null })}
                  disabled={linkMutation.isPending}
                >
                  {linkMutation.isPending
                    ? <><Loader2 className="h-4 w-4 animate-spin mr-1.5" /> Vinculando...</>
                    : <><Link2 className="h-4 w-4 mr-1.5" /> Vincular pago #{pending.id}</>}
                </Button>
              )}
            </DialogFooter>
          </div>
        ) : (
          // ── Paso 1: formulario ────────────────────────────────────────────
          <>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="ca-name" className="text-xs">Nombre del dueño *</Label>
                <Input id="ca-name" value={name} onChange={e => setName(e.target.value)} placeholder="Juan Pérez" className="h-9 text-sm" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="ca-business" className="text-xs">Negocio</Label>
                <Input id="ca-business" value={businessName} onChange={e => setBusinessName(e.target.value)} placeholder="Pérez Construction LLC" className="h-9 text-sm" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="ca-email" className="text-xs">Email *</Label>
                <Input id="ca-email" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="cliente@negocio.com" className="h-9 text-sm" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="ca-phone" className="text-xs">Teléfono *</Label>
                <Input id="ca-phone" value={phone} onChange={e => setPhone(e.target.value)} placeholder="+15551234567" className="h-9 text-sm font-mono" />
              </div>
              <div className="space-y-1 col-span-2">
                <Label htmlFor="ca-industry" className="text-xs">Industria</Label>
                <select
                  id="ca-industry"
                  value={industry}
                  onChange={e => setIndustry(e.target.value)}
                  className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm h-9"
                >
                  {INDUSTRY_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
            </div>

            {/* Staff Chyrris al crear */}
            <div className="rounded-lg border border-border p-3 space-y-2">
              <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
                <input type="checkbox" checked={addStaff} onChange={e => setAddStaff(e.target.checked)} className="h-4 w-4 accent-violet-500" />
                Agregarme como staff al crear (servicio de configuración incluido)
              </label>
              {addStaff && (
                <div className="space-y-1">
                  <Label htmlFor="ca-staff-phone" className="text-xs">Mi teléfono de staff *</Label>
                  <Input id="ca-staff-phone" value={staffPhone} onChange={e => setStaffPhone(e.target.value)} placeholder="+15551234567" className="h-8 text-sm font-mono" />
                  <p className="text-xs text-muted-foreground">Se agrega como admin sin cargo de asiento ({savedIdentity.email}). Se recuerda para la próxima vez.</p>
                </div>
              )}
            </div>

            {/* 409: el teléfono ya tiene cuentas */}
            {existingBusinesses.length > 0 && (
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 space-y-2">
                <p className="text-xs text-amber-300 font-medium flex items-center gap-1.5">
                  <AlertCircle className="h-3.5 w-3.5" /> Este teléfono ya tiene cuenta(s):
                </p>
                {existingBusinesses.map(b => (
                  <div key={b.id} className="flex items-center justify-between gap-2 text-xs">
                    <span className="truncate">{b.name}</span>
                    <code className="font-mono text-muted-foreground shrink-0">{b.id}</code>
                  </div>
                ))}
                <label className="flex items-center gap-2 text-xs cursor-pointer select-none text-amber-200">
                  <input type="checkbox" checked={allowAdditional} onChange={e => setAllowAdditional(e.target.checked)} className="h-3.5 w-3.5 accent-amber-500" />
                  Crear de todos modos como negocio adicional del mismo dueño
                </label>
              </div>
            )}

            <DialogFooter>
              <Button variant="outline" onClick={onClose} disabled={createMutation.isPending}>Cancelar</Button>
              <Button
                className="bg-violet-600 hover:bg-violet-700 text-white"
                onClick={handleCreate}
                disabled={createMutation.isPending || !name.trim() || !email.trim() || !phone.trim()}
              >
                {createMutation.isPending
                  ? <><Loader2 className="h-4 w-4 animate-spin mr-1.5" /> Creando...</>
                  : <><UserPlus className="h-4 w-4 mr-1.5" /> Crear cuenta</>}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ─── Add Staff Modal ──────────────────────────────────────────────────────────
// Agrega a G. Sánchez como staff (admin, is_staff=true — sin cargo de asiento)
// a la cuenta de un cliente, parte de los acuerdos del servicio Growth/Legacy.

function AddStaffModal({ onClose }: { onClose: () => void }) {
  const savedIdentity = loadStaffIdentity();
  const [selected, setSelected] = useState<PickedUser | null>(null);
  const [staffPhone, setStaffPhone] = useState(savedIdentity.phone);
  const [staffEmail, setStaffEmail] = useState(savedIdentity.email);
  const [staffName, setStaffName] = useState(savedIdentity.name);

  const addStaffMutation = trpc.leadprime.addStaff.useMutation({
    onSuccess: (data) => {
      if (data.success) {
        saveStaffIdentity({ phone: staffPhone.trim(), email: staffEmail.trim(), name: staffName.trim() });
        toast.success(`✅ Agregado como staff en ${selected?.businessName ?? selected?.name} (admin, sin cargo de asiento)`);
        onClose();
      } else {
        toast.error(data.error ?? 'Error al agregar staff');
      }
    },
    onError: (err) => toast.error(err.message ?? 'Error inesperado'),
  });

  function handleAdd() {
    if (!selected) {
      toast.error('Elige la cuenta del cliente');
      return;
    }
    if (!staffPhone.trim()) {
      toast.error('Tu teléfono de staff es requerido');
      return;
    }
    addStaffMutation.mutate({
      contractorId: selected.id,
      staff: {
        phone: staffPhone.trim(),
        email: staffEmail.trim() || undefined,
        name: staffName.trim() || undefined,
      },
    });
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserCog className="h-5 w-5 text-violet-400" />
            Agregarme como staff
          </DialogTitle>
          <DialogDescription>
            Te agrega como admin (staff Chyrris, sin cargo de asiento) a la cuenta del cliente,
            para el servicio de configuración incluido en Growth/Legacy.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-1.5">
          <Label className="text-xs">Cuenta del cliente</Label>
          <UserPicker selected={selected} onSelect={setSelected} />
        </div>

        <div className="rounded-lg border border-border p-3 space-y-2">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Mi identidad de staff</p>
          <div className="space-y-1">
            <Label htmlFor="st-phone" className="text-xs">Teléfono *</Label>
            <Input id="st-phone" value={staffPhone} onChange={e => setStaffPhone(e.target.value)} placeholder="+15551234567" className="h-8 text-sm font-mono" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label htmlFor="st-email" className="text-xs">Email</Label>
              <Input id="st-email" value={staffEmail} onChange={e => setStaffEmail(e.target.value)} className="h-8 text-sm" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="st-name" className="text-xs">Nombre</Label>
              <Input id="st-name" value={staffName} onChange={e => setStaffName(e.target.value)} className="h-8 text-sm" />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">Se recuerda en este navegador para la próxima vez.</p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={addStaffMutation.isPending}>Cancelar</Button>
          <Button
            className="bg-violet-600 hover:bg-violet-700 text-white"
            onClick={handleAdd}
            disabled={addStaffMutation.isPending || !selected || !staffPhone.trim()}
          >
            {addStaffMutation.isPending
              ? <><Loader2 className="h-4 w-4 animate-spin mr-1.5" /> Agregando...</>
              : <><UserCog className="h-4 w-4 mr-1.5" /> Agregarme como staff</>}
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
  // null = modal cerrado; {pending: null} = crear cuenta desde cero;
  // {pending: row} = crear cuenta prellenada desde un pago pendiente.
  const [createTarget, setCreateTarget] = useState<{ pending: PendingSubscription | null } | null>(null);
  const [showAssignModal, setShowAssignModal] = useState(false);
  const [showStaffModal, setShowStaffModal] = useState(false);

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
  const [copiedGrowth, setCopiedGrowth] = useState(false);
  const [copiedLegacy, setCopiedLegacy] = useState(false);

  const BASE_URL = 'https://leadprime.chyrris.com';
  const PORTAL_LINKS = [
    {
      tier: 'Growth',
      url: `${BASE_URL}/join/growth`,
      color: 'border-violet-500/30 bg-violet-500/10 text-violet-300',
      btnColor: 'hover:bg-violet-500/20 text-violet-300',
      copied: copiedGrowth,
      setCopied: setCopiedGrowth,
    },
    {
      tier: 'Legacy',
      url: `${BASE_URL}/join/legacy`,
      color: 'border-amber-500/30 bg-amber-500/10 text-amber-300',
      btnColor: 'hover:bg-amber-500/20 text-amber-300',
      copied: copiedLegacy,
      setCopied: setCopiedLegacy,
    },
  ];

  function copyLink(url: string, setCopied: (v: boolean) => void) {
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

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

      {/* Acciones de gestión — crear cuentas, asignar tiers, staff Chyrris */}
      <div className="flex items-center gap-2 flex-wrap">
        <Button
          size="sm"
          className="bg-violet-600 hover:bg-violet-700 text-white"
          onClick={() => setCreateTarget({ pending: null })}
        >
          <UserPlus className="h-4 w-4 mr-1.5" />
          Crear cuenta
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="border-violet-500/40 text-violet-300 hover:bg-violet-500/10"
          onClick={() => setShowAssignModal(true)}
        >
          <CreditCard className="h-4 w-4 mr-1.5" />
          Asignar suscripción
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="border-violet-500/40 text-violet-300 hover:bg-violet-500/10"
          onClick={() => setShowStaffModal(true)}
        >
          <UserCog className="h-4 w-4 mr-1.5" />
          Agregarme como staff
        </Button>
      </div>

      {/* Portal Links — links fijos para mandar a clientes */}
      <div className="rounded-xl border border-border bg-card p-4 space-y-2">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Links de captación (copiar y mandar al cliente)</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {PORTAL_LINKS.map(({ tier, url, color, btnColor, copied, setCopied }) => (
            <div key={tier} className={`flex items-center gap-2 rounded-lg border px-3 py-2 ${color}`}>
              <span className="text-xs font-semibold shrink-0">{tier}</span>
              <code className="flex-1 text-xs truncate opacity-80">{url}</code>
              <button
                onClick={() => copyLink(url, setCopied)}
                className={`shrink-0 flex items-center gap-1 text-xs px-2 py-1 rounded transition-colors ${btnColor}`}
                title="Copiar link"
              >
                {copied
                  ? <><Check className="h-3.5 w-3.5" /> Copiado</>
                  : <><Copy className="h-3.5 w-3.5" /> Copiar</>
                }
              </button>
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className={`shrink-0 ${btnColor} p-1 rounded transition-colors`}
                title="Abrir portal"
              >
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            </div>
          ))}
        </div>
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
                      <div className="flex items-center gap-1.5 justify-end">
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs border-violet-500/40 text-violet-300 hover:bg-violet-500/10"
                          onClick={() => setCreateTarget({ pending: row })}
                          title="Crear la cuenta del cliente con estos datos y vincular el pago"
                        >
                          <UserPlus className="h-3.5 w-3.5 mr-1" />
                          Crear cuenta
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs border-violet-500/40 text-violet-300 hover:bg-violet-500/10"
                          onClick={() => setLinkTarget(row)}
                          title="Vincular a una cuenta existente"
                        >
                          <Link2 className="h-3.5 w-3.5 mr-1" />
                          Vincular
                        </Button>
                      </div>
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

      {/* Create account modal (desde cero o prellenado desde un pago) */}
      {createTarget && (
        <CreateAccountModal
          pending={createTarget.pending}
          onClose={() => setCreateTarget(null)}
          onCreated={() => setCreateTarget(null)}
        />
      )}

      {/* Assign subscription modal — componente compartido con Usuarios */}
      {showAssignModal && (
        <SubscriptionConfigModal user={null} onClose={() => setShowAssignModal(false)} />
      )}

      {/* Add staff modal */}
      {showStaffModal && (
        <AddStaffModal onClose={() => setShowStaffModal(false)} />
      )}
    </div>
  );
}
