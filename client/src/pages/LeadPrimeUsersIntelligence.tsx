/**
 * LEADPRIME USUARIOS — Chyrris KAI
 *
 * Página unificada de usuarios (antes: Users Intelligence + Credits Admin).
 * Pestañas:
 *   - Directorio: tabla enriquecida con filtros/orden + acciones por fila
 *     (editar, créditos, hosting, suscripción, eliminar) + acciones masivas
 *     (dar créditos / eliminar a la selección).
 *   - Transacciones: movimientos de wallet (antes en la página de Créditos).
 *   - Historial de créditos: grants de admin (antes en la página de Créditos).
 * El modal de suscripción es el componente compartido SubscriptionConfigModal.
 */
import { Fragment, useState, useMemo, useEffect } from 'react';
import { trpc } from '@/lib/trpc';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import {
  Users, Search, RefreshCw, Loader2, TrendingUp, DollarSign,
  Activity, Building2, Shield, ChevronUp, ChevronDown,
  Pencil, Trash2, Gift, X, Check, AlertTriangle, BadgeCheck,
  Phone, Mail, Calendar, Briefcase, Star, Server,
  CreditCard, Send,
} from 'lucide-react';
import { SubscriptionConfigModal } from '@/components/leadprime/SubscriptionConfigModal';

// ─── Types ────────────────────────────────────────────────────────────────────
interface EnrichedUser {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  networkHandle: string | null;
  companyName: string | null;
  createdAt: string;
  balanceCents: number;
  balanceDollars: string;
  totalSpentCents: number;
  totalSpentDollars: string;
  lastActivityAt: string | null;
  subscriptionStatus: string | null;
  subscriptionPlanId: string | null;
  businessName: string | null;
  businessType: string | null;
  city: string | null;
  state: string | null;
  hasLicense: boolean;
  licenseNumber: string | null;
  website: string | null;
  industry: string | null;
  tradeType: string | null;
  teamMemberCount: number;
  daysSinceSignup: number;
  isActive: boolean;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function fmt$(cents: number) { return `$${(cents / 100).toFixed(2)}`; }
function fmtDate(d: string | null) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
function subBadge(status: string | null) {
  if (!status) return <span className="text-xs text-muted-foreground px-2 py-0.5 rounded-full bg-gray-500/10">none</span>;
  const c: Record<string, string> = {
    active: 'bg-green-500/20 text-green-300 border border-green-500/30',
    trialing: 'bg-amber-500/20 text-amber-300 border border-amber-500/30',
    canceled: 'bg-red-500/20 text-red-300 border border-red-500/30',
    past_due: 'bg-orange-500/20 text-orange-300 border border-orange-500/30',
  };
  return <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${c[status] ?? 'bg-gray-500/20 text-gray-300'}`}>{status}</span>;
}
function activityBadge(isActive: boolean) {
  return isActive
    ? <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">active</span>
    : <span className="text-xs px-2 py-0.5 rounded-full bg-gray-500/10 text-gray-400">inactive</span>;
}

// Plan SIEMPRE visible por fila: una cuenta sin plan es un huérfano de datos y
// se marca en rojo para detectarlo de inmediato (no debería existir ninguno).
const PLAN_COLORS: Record<string, string> = {
  pay: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
  starter: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
  basic: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
  growth: 'bg-violet-500/15 text-violet-300 border-violet-500/30',
  chyrris: 'bg-violet-500/15 text-violet-300 border-violet-500/30',
  pro: 'bg-fuchsia-500/15 text-fuchsia-300 border-fuchsia-500/30',
  premium: 'bg-fuchsia-500/15 text-fuchsia-300 border-fuchsia-500/30',
  network: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  elite: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  enterprise: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
};

function planBadge(plan: string | null) {
  if (!plan) {
    return (
      <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-red-500/15 text-red-300 border border-red-500/30 whitespace-nowrap">
        ⚠ sin plan
      </span>
    );
  }
  const label = plan.replace(/^price_/, '').replace(/[_-]+/g, ' ').trim();
  const colorKey = label.split(' ')[0].toLowerCase();
  const cls = PLAN_COLORS[colorKey] ?? 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30';
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-medium border capitalize whitespace-nowrap ${cls}`} title={plan}>
      {label}
    </span>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function LeadPrimeUsersIntelligence() {
  const [activeTab, setActiveTab] = useState<'directorio' | 'transactions' | 'grants'>('directorio');
  const [txTypeFilter, setTxTypeFilter] = useState('');
  const [search, setSearch] = useState('');
  const [industryFilter, setIndustryFilter] = useState('');
  const [subFilter, setSubFilter] = useState('all');
  const [activeFilter, setActiveFilter] = useState<boolean | undefined>(undefined);
  const [licenseFilter, setLicenseFilter] = useState<boolean | undefined>(undefined);
  const [sortBy, setSortBy] = useState<'created_at' | 'balance' | 'last_activity' | 'total_spent' | 'team_size'>('created_at');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 50;

  // Edit modal state
  const [editUser, setEditUser] = useState<EnrichedUser | null>(null);
  const [editName, setEditName] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editIndustry, setEditIndustry] = useState('');
  const [editCompanyName, setEditCompanyName] = useState('');
  const [editCity, setEditCity] = useState('');
  const [editState, setEditState] = useState('');
  const [editWebsite, setEditWebsite] = useState('');
  const [editBusinessType, setEditBusinessType] = useState('');

  // Grant credits modal state
  const [grantUser, setGrantUser] = useState<EnrichedUser | null>(null);
  const [grantAmount, setGrantAmount] = useState('');
  const [grantDesc, setGrantDesc] = useState('Admin grant');

  // Managed hosting modal state
  const [hostingUser, setHostingUser] = useState<EnrichedUser | null>(null);
  const [hostingEnabled, setHostingEnabled] = useState(false);
  const [hostingAmount, setHostingAmount] = useState('');

  // Subscription config modal state (form vive en SubscriptionConfigModal)
  const [subUser, setSubUser] = useState<EnrichedUser | null>(null);

  // Delete confirm state (single)
  const [deleteUser, setDeleteUser] = useState<EnrichedUser | null>(null);

  // Batch selection state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showBatchDeleteConfirm, setShowBatchDeleteConfirm] = useState(false);

  // Batch grant credits state (antes en la página de Créditos)
  const [showBatchGrant, setShowBatchGrant] = useState(false);
  const [batchAmount, setBatchAmount] = useState('');
  const [batchDesc, setBatchDesc] = useState('');
  const [batchNote, setBatchNote] = useState('');

  // Expanded row
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Queries
  const statsQuery = trpc.leadprime.getUserIntelligenceStats.useQuery(undefined, { staleTime: 60_000 });
  const usersQuery = trpc.leadprime.getEnrichedUsers.useQuery({
    search: search || undefined,
    industry: industryFilter || undefined,
    subscriptionStatus: subFilter !== 'all' ? subFilter : undefined,
    isActive: activeFilter,
    hasLicense: licenseFilter,
    sortBy,
    sortDir,
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
  }, { staleTime: 30_000 });

  const utils = trpc.useUtils();

  // Mutations
  const updateContact = trpc.leadprime.updateUserContact.useMutation({
    onSuccess: () => {
      toast.success('User updated');
      setEditUser(null);
      utils.leadprime.getEnrichedUsers.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const grantCredits = trpc.leadprime.grantCredits.useMutation({
    onSuccess: () => {
      toast.success('Credits granted');
      setGrantUser(null);
      setGrantAmount('');
      utils.leadprime.getEnrichedUsers.invalidate();
      utils.leadprime.getUserIntelligenceStats.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const deleteUserMutation = trpc.leadprime.deleteUser.useMutation({
    onSuccess: () => {
      toast.success('User deleted');
      setDeleteUser(null);
      utils.leadprime.getEnrichedUsers.invalidate();
      utils.leadprime.getUserIntelligenceStats.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  // Wallet: transacciones + historial de grants (pestañas absorbidas de la
  // antigua página de Créditos) y stats de wallet para las tarjetas.
  const walletStatsQuery = trpc.leadprime.getStats.useQuery(undefined, { staleTime: 60_000 });
  const transactionsQuery = trpc.leadprime.getTransactions.useQuery(
    { type: txTypeFilter || undefined, limit: 100 },
    { enabled: activeTab === 'transactions' }
  );
  const grantsQuery = trpc.leadprime.getGrantHistory.useQuery(
    { limit: 100 },
    { enabled: activeTab === 'grants' }
  );

  const grantBatchMutation = trpc.leadprime.grantCreditsBatch.useMutation({
    onSuccess: (result: any) => {
      toast.success(`Créditos otorgados a ${result.successCount} cuenta(s)${result.failCount ? ` · ${result.failCount} fallaron` : ''}`);
      setShowBatchGrant(false);
      setBatchAmount('');
      setBatchDesc('');
      setBatchNote('');
      setSelectedIds(new Set());
      utils.leadprime.getEnrichedUsers.invalidate();
      utils.leadprime.getStats.invalidate();
      utils.leadprime.getGrantHistory.invalidate();
      utils.leadprime.getTransactions.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  // Managed hosting: read current config when a user's hosting modal opens.
  const hostingQuery = trpc.leadprime.getHosting.useQuery(
    { contractorId: hostingUser?.id ?? '' },
    { enabled: !!hostingUser, staleTime: 0 },
  );
  const setHosting = trpc.leadprime.setHosting.useMutation({
    onSuccess: () => {
      toast.success('Hosting settings saved');
      setHostingUser(null);
      utils.leadprime.getEnrichedUsers.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  function openHosting(u: EnrichedUser) {
    setHostingUser(u);
    setHostingEnabled(false);
    setHostingAmount('');
  }

  // Prime the modal fields from the fetched config when it loads.
  useEffect(() => {
    if (hostingUser && hostingQuery.data) {
      setHostingEnabled(hostingQuery.data.enabled);
      setHostingAmount(hostingQuery.data.monthlyCents ? (hostingQuery.data.monthlyCents / 100).toFixed(2) : '');
    }
  }, [hostingUser, hostingQuery.data]);

  const deleteUsersMutation = trpc.leadprime.deleteUsers.useMutation({
    onSuccess: (result: any) => {
      toast.success(result.message || `${result.deleted} user(s) deleted`);
      if (result.failed?.length > 0) {
        toast.error(`${result.failed.length} user(s) could not be deleted`);
      }
      setSelectedIds(new Set());
      setShowBatchDeleteConfirm(false);
      utils.leadprime.getEnrichedUsers.invalidate();
      utils.leadprime.getUserIntelligenceStats.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const users: EnrichedUser[] = (usersQuery.data?.data as any) ?? [];
  const total = usersQuery.data?.total ?? 0;
  const stats = statsQuery.data?.data as any;

  const totalPages = Math.ceil(total / PAGE_SIZE);

  // Selection helpers
  const allSelected = users.length > 0 && users.every(u => selectedIds.has(u.id));
  const someSelected = users.some(u => selectedIds.has(u.id));

  function toggleUser(id: string) {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    if (allSelected) {
      setSelectedIds(prev => {
        const next = new Set(prev);
        users.forEach(u => next.delete(u.id));
        return next;
      });
    } else {
      setSelectedIds(prev => {
        const next = new Set(prev);
        users.forEach(u => next.add(u.id));
        return next;
      });
    }
  }

  function toggleSort(col: typeof sortBy) {
    if (sortBy === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortBy(col); setSortDir('desc'); }
  }

  function SortIcon({ col }: { col: typeof sortBy }) {
    if (sortBy !== col) return <ChevronDown className="h-3 w-3 opacity-30" />;
    return sortDir === 'asc' ? <ChevronUp className="h-3 w-3 text-primary" /> : <ChevronDown className="h-3 w-3 text-primary" />;
  }

  function openEdit(u: EnrichedUser) {
    setEditUser(u);
    setEditName(u.name);
    setEditEmail(u.email);
    setEditPhone(u.phone ?? '');
    setEditIndustry(u.industry ?? '');
    setEditCompanyName(u.companyName ?? '');
    setEditCity(u.city ?? '');
    setEditState(u.state ?? '');
    setEditWebsite(u.website ?? '');
    setEditBusinessType(u.businessType ?? '');
  }

  const industries = useMemo(() => {
    if (!stats?.byIndustry) return [];
    return stats.byIndustry.map((x: any) => x.industry);
  }, [stats]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Users className="h-6 w-6 text-primary" /> Usuarios
          </h1>
          <p className="text-sm text-muted-foreground mt-1">Directorio, wallet y créditos de LeadPrime en un solo lugar</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => { utils.leadprime.getEnrichedUsers.invalidate(); utils.leadprime.getUserIntelligenceStats.invalidate(); utils.leadprime.getStats.invalidate(); }}>
          <RefreshCw className="h-4 w-4 mr-2" /> Actualizar
        </Button>
      </div>

      {/* Stats Cards */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1"><Users className="h-3.5 w-3.5" /> Usuarios</div>
              <div className="text-2xl font-bold">{stats.totalUsers}</div>
              <div className="text-xs text-muted-foreground mt-0.5">{stats.activeUsers} activos (30d)</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1"><DollarSign className="h-3.5 w-3.5" /> Wallet total</div>
              <div className="text-2xl font-bold">{fmt$(stats.totalBalanceCents)}</div>
              <div className="text-xs text-muted-foreground mt-0.5">en todas las cuentas</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1"><TrendingUp className="h-3.5 w-3.5" /> Gastado</div>
              <div className="text-2xl font-bold">{fmt$(stats.totalSpentCents)}</div>
              <div className="text-xs text-muted-foreground mt-0.5">histórico</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1"><Gift className="h-3.5 w-3.5" /> Otorgado (mes)</div>
              <div className="text-2xl font-bold">{walletStatsQuery.data?.data ? fmt$(walletStatsQuery.data.data.totalGrantedThisMonth) : '—'}</div>
              <div className="text-xs text-muted-foreground mt-0.5">créditos de admin</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1"><BadgeCheck className="h-3.5 w-3.5" /> Subs activas</div>
              <div className="text-2xl font-bold">{walletStatsQuery.data?.data?.activeSubscribers ?? '—'}</div>
              <div className="text-xs text-muted-foreground mt-0.5">{walletStatsQuery.data?.data?.trialUsers ?? 0} en trial</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1"><Shield className="h-3.5 w-3.5" /> Con licencia</div>
              <div className="text-2xl font-bold">{stats.withLicense}</div>
              <div className="text-xs text-muted-foreground mt-0.5">{stats.withoutLicense} sin licencia</div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Pestañas: Directorio | Transacciones | Historial de créditos */}
      <div className="flex gap-1 border-b">
        {([
          { key: 'directorio', label: 'Directorio' },
          { key: 'transactions', label: 'Transacciones' },
          { key: 'grants', label: 'Historial de créditos' },
        ] as const).map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${
              activeTab === tab.key
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'directorio' && (<>

      {/* Industry Distribution */}
      {stats?.byIndustry && stats.byIndustry.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">By Industry</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {stats.byIndustry.map((item: any) => (
                <button
                  key={item.industry}
                  onClick={() => setIndustryFilter(industryFilter === item.industry ? '' : item.industry)}
                  className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${industryFilter === item.industry ? 'bg-primary text-primary-foreground border-primary' : 'border-border hover:border-primary/50'}`}
                >
                  {item.industry} <span className="opacity-60 ml-1">{item.count}</span>
                </button>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-end">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search name, email, phone, company..."
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(0); }}
            className="pl-9"
          />
        </div>
        <select
          value={subFilter}
          onChange={e => { setSubFilter(e.target.value); setPage(0); }}
          className="h-10 rounded-md border border-input bg-background px-3 text-sm"
        >
          <option value="all">All subscriptions</option>
          <option value="active">Active</option>
          <option value="trialing">Trialing</option>
          <option value="canceled">Canceled</option>
          <option value="none">No subscription</option>
        </select>
        <Button
          variant={activeFilter === true ? 'default' : 'outline'} size="sm"
          onClick={() => { setActiveFilter(activeFilter === true ? undefined : true); setPage(0); }}
        >
          <Activity className="h-3.5 w-3.5 mr-1" /> Active
        </Button>
        <Button
          variant={activeFilter === false ? 'default' : 'outline'} size="sm"
          onClick={() => { setActiveFilter(activeFilter === false ? undefined : false); setPage(0); }}
        >
          Inactive
        </Button>
        <Button
          variant={licenseFilter === true ? 'default' : 'outline'} size="sm"
          onClick={() => { setLicenseFilter(licenseFilter === true ? undefined : true); setPage(0); }}
        >
          <BadgeCheck className="h-3.5 w-3.5 mr-1" /> Licensed
        </Button>
        {(search || industryFilter || subFilter !== 'all' || activeFilter !== undefined || licenseFilter !== undefined) && (
          <Button variant="ghost" size="sm" onClick={() => { setSearch(''); setIndustryFilter(''); setSubFilter('all'); setActiveFilter(undefined); setLicenseFilter(undefined); setPage(0); }}>
            <X className="h-3.5 w-3.5 mr-1" /> Clear
          </Button>
        )}
      </div>

      {/* Batch action toolbar */}
      {selectedIds.size > 0 && (
        <div className="flex items-center gap-3 px-4 py-2.5 bg-primary/5 border border-primary/30 rounded-lg flex-wrap">
          <span className="text-sm font-medium">{selectedIds.size} seleccionado{selectedIds.size > 1 ? 's' : ''}</span>
          <Button
            size="sm"
            onClick={() => setShowBatchGrant(v => !v)}
            className="gap-1.5"
          >
            <Gift className="h-3.5 w-3.5" /> Dar créditos
          </Button>
          <Button
            variant="destructive"
            size="sm"
            onClick={() => setShowBatchDeleteConfirm(true)}
            disabled={deleteUsersMutation.isPending}
          >
            <Trash2 className="h-3.5 w-3.5 mr-1.5" />
            Eliminar
          </Button>
          <Button variant="ghost" size="sm" onClick={() => { setSelectedIds(new Set()); setShowBatchGrant(false); }}>
            <X className="h-3.5 w-3.5 mr-1" /> Limpiar selección
          </Button>
        </div>
      )}

      {/* Panel de grant masivo (antes en la página de Créditos) */}
      {showBatchGrant && selectedIds.size > 0 && (
        <Card className="border-primary/40 bg-primary/5">
          <CardHeader className="pb-3 pt-4">
            <CardTitle className="text-base flex items-center gap-2">
              <Gift className="h-4 w-4" />
              Dar créditos a {selectedIds.size} cuenta{selectedIds.size > 1 ? 's' : ''}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div>
                <Label className="text-xs">Monto (USD) *</Label>
                <Input type="number" min="0.01" max="1200" step="0.01" placeholder="ej. 5.00"
                  value={batchAmount} onChange={e => setBatchAmount(e.target.value)} />
              </div>
              <div>
                <Label className="text-xs">Descripción *</Label>
                <Input placeholder="ej. Bono de diciembre" value={batchDesc} onChange={e => setBatchDesc(e.target.value)} />
              </div>
              <div>
                <Label className="text-xs">Nota interna (opcional)</Label>
                <Input placeholder="ej. Promo XMAS" value={batchNote} onChange={e => setBatchNote(e.target.value)} />
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Button
                disabled={grantBatchMutation.isPending || !batchAmount || parseFloat(batchAmount) <= 0 || !batchDesc.trim()}
                onClick={() => grantBatchMutation.mutate({
                  contractorIds: Array.from(selectedIds),
                  amountDollars: parseFloat(batchAmount),
                  description: batchDesc.trim(),
                  note: batchNote.trim() || undefined,
                })}
                className="gap-2"
              >
                {grantBatchMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                {grantBatchMutation.isPending ? 'Otorgando...' : `Dar $${parseFloat(batchAmount || '0').toFixed(2)} a ${selectedIds.size} cuenta${selectedIds.size > 1 ? 's' : ''}`}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setShowBatchGrant(false)}>Cancelar</Button>
              {batchAmount && (
                <span className="text-xs text-muted-foreground">
                  Total: {fmt$(Math.round(parseFloat(batchAmount || '0') * 100 * selectedIds.size))}
                </span>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          {usersQuery.isLoading ? (
            <div className="flex items-center justify-center h-40"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
          ) : users.length === 0 ? (
            <div className="flex items-center justify-center h-40 text-muted-foreground text-sm">No users found</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border/50 text-muted-foreground text-xs">
                    <th className="px-4 py-3 w-8">
                      <input
                        type="checkbox"
                        checked={allSelected}
                        ref={el => { if (el) el.indeterminate = someSelected && !allSelected; }}
                        onChange={toggleAll}
                        className="cursor-pointer accent-primary"
                        title="Select all"
                      />
                    </th>
                    <th className="text-left px-4 py-3 font-medium">User</th>
                    <th className="text-left px-3 py-3 font-medium">Business</th>
                    <th className="text-left px-3 py-3 font-medium">Industry</th>
                    <th className="text-left px-3 py-3 font-medium">Location</th>
                    <th className="text-left px-3 py-3 font-medium">Plan</th>
                    <th className="text-left px-3 py-3 font-medium">Status</th>
                    <th className="text-right px-3 py-3 font-medium cursor-pointer hover:text-foreground" onClick={() => toggleSort('balance')}>
                      <span className="flex items-center justify-end gap-1">Balance <SortIcon col="balance" /></span>
                    </th>
                    <th className="text-right px-3 py-3 font-medium cursor-pointer hover:text-foreground" onClick={() => toggleSort('total_spent')}>
                      <span className="flex items-center justify-end gap-1">Spent <SortIcon col="total_spent" /></span>
                    </th>
                    <th className="text-center px-3 py-3 font-medium cursor-pointer hover:text-foreground" onClick={() => toggleSort('team_size')}>
                      <span className="flex items-center justify-center gap-1">Team <SortIcon col="team_size" /></span>
                    </th>
                    <th className="text-left px-3 py-3 font-medium cursor-pointer hover:text-foreground" onClick={() => toggleSort('created_at')}>
                      <span className="flex items-center gap-1">Joined <SortIcon col="created_at" /></span>
                    </th>
                    <th className="text-left px-3 py-3 font-medium cursor-pointer hover:text-foreground" onClick={() => toggleSort('last_activity')}>
                      <span className="flex items-center gap-1">Last Active <SortIcon col="last_activity" /></span>
                    </th>
                    <th className="px-3 py-3"></th>
                  </tr>
                </thead>
                <tbody>
                  {users.map(u => (
                    <Fragment key={u.id}>
                      <tr
                        className={`border-b border-border/30 hover:bg-accent/30 transition-colors cursor-pointer ${selectedIds.has(u.id) ? 'bg-destructive/5' : ''}`}
                        onClick={() => setExpandedId(expandedId === u.id ? null : u.id)}
                      >
                        <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            checked={selectedIds.has(u.id)}
                            onChange={() => toggleUser(u.id)}
                            className="cursor-pointer accent-primary"
                          />
                        </td>
                        <td className="px-4 py-3">
                          <div className="font-medium truncate max-w-[180px]">{u.name}</div>
                          <div className="text-xs text-muted-foreground truncate max-w-[180px]">{u.email}</div>
                          {u.networkHandle && <div className="text-xs text-primary/70 font-mono mt-0.5">@{u.networkHandle}</div>}
                          {u.hasLicense && <span className="text-xs text-emerald-400 flex items-center gap-0.5 mt-0.5"><BadgeCheck className="h-3 w-3" /> Licensed</span>}
                        </td>
                        <td className="px-3 py-3">
                          {(u.businessName || u.companyName) ? (
                            <div className="flex items-center gap-1.5">
                              <Building2 className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                              <span className="text-xs font-medium truncate max-w-[160px]">{u.businessName || u.companyName}</span>
                            </div>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="px-3 py-3">
                          <div className="text-xs">{u.industry ?? '—'}</div>
                          {u.tradeType && <div className="text-xs text-muted-foreground">{u.tradeType}</div>}
                        </td>
                        <td className="px-3 py-3 text-xs text-muted-foreground">
                          {u.city && u.state ? `${u.city}, ${u.state}` : u.state ?? u.city ?? '—'}
                        </td>
                        <td className="px-3 py-3">
                          {planBadge(u.subscriptionPlanId)}
                        </td>
                        <td className="px-3 py-3">
                          <div className="flex flex-col gap-1">
                            {subBadge(u.subscriptionStatus)}
                            {activityBadge(u.isActive)}
                          </div>
                        </td>
                        <td className="px-3 py-3 text-right font-mono text-xs">
                          <span className={u.balanceCents < 200 ? 'text-red-400' : 'text-foreground'}>${u.balanceDollars}</span>
                        </td>
                        <td className="px-3 py-3 text-right font-mono text-xs text-muted-foreground">${u.totalSpentDollars}</td>
                        <td className="px-3 py-3 text-center text-xs">{u.teamMemberCount}</td>
                        <td className="px-3 py-3 text-xs text-muted-foreground whitespace-nowrap">{fmtDate(u.createdAt)}</td>
                        <td className="px-3 py-3 text-xs text-muted-foreground whitespace-nowrap">{fmtDate(u.lastActivityAt)}</td>
                        <td className="px-3 py-3">
                          <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                            <button onClick={() => openEdit(u)} className="p-1.5 rounded hover:bg-accent transition-colors" title="Edit contact">
                              <Pencil className="h-3.5 w-3.5 text-muted-foreground hover:text-foreground" />
                            </button>
                            <button onClick={() => setGrantUser(u)} className="p-1.5 rounded hover:bg-accent transition-colors" title="Grant credits">
                              <Gift className="h-3.5 w-3.5 text-muted-foreground hover:text-emerald-400" />
                            </button>
                            <button onClick={() => openHosting(u)} className="p-1.5 rounded hover:bg-accent transition-colors" title="Managed hosting">
                              <Server className="h-3.5 w-3.5 text-muted-foreground hover:text-cyan-400" />
                            </button>
                            <button onClick={() => setSubUser(u)} className="p-1.5 rounded hover:bg-accent transition-colors" title="Suscripción">
                              <CreditCard className="h-3.5 w-3.5 text-muted-foreground hover:text-violet-400" />
                            </button>
                            <button onClick={() => setDeleteUser(u)} className="p-1.5 rounded hover:bg-accent transition-colors" title="Delete user">
                              <Trash2 className="h-3.5 w-3.5 text-muted-foreground hover:text-red-400" />
                            </button>
                          </div>
                        </td>
                      </tr>
                      {expandedId === u.id && (
                        <tr className="bg-accent/20">
                          <td colSpan={13} className="px-6 py-4">
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-xs">
                              <div>
                                <div className="text-muted-foreground mb-1 flex items-center gap-1"><Mail className="h-3 w-3" /> Email</div>
                                <div>{u.email}</div>
                              </div>
                              <div>
                                <div className="text-muted-foreground mb-1 flex items-center gap-1"><Phone className="h-3 w-3" /> Phone</div>
                                <div>{u.phone ?? '—'}</div>
                              </div>
                              <div>
                                <div className="text-muted-foreground mb-1 flex items-center gap-1"><Briefcase className="h-3 w-3" /> Business Type</div>
                                <div>{u.businessType ?? '—'}</div>
                              </div>
                              <div>
                                <div className="text-muted-foreground mb-1 flex items-center gap-1"><Star className="h-3 w-3" /> Plan</div>
                                <div className="capitalize" title={u.subscriptionPlanId ?? undefined}>
                                  {u.subscriptionPlanId ? u.subscriptionPlanId.replace(/^price_/, '').replace(/[_-]+/g, ' ') : '—'}
                                </div>
                              </div>
                              {u.licenseNumber && (
                                <div>
                                  <div className="text-muted-foreground mb-1 flex items-center gap-1"><Shield className="h-3 w-3" /> License #</div>
                                  <div>{u.licenseNumber}</div>
                                </div>
                              )}
                              {u.website && (
                                <div>
                                  <div className="text-muted-foreground mb-1">Website</div>
                                  <a href={u.website} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline truncate block max-w-[200px]">{u.website}</a>
                                </div>
                              )}
                              <div>
                                <div className="text-muted-foreground mb-1 flex items-center gap-1"><Calendar className="h-3 w-3" /> Days since signup</div>
                                <div>{u.daysSinceSignup} days</div>
                              </div>
                              {u.networkHandle && (
                                <div>
                                  <div className="text-muted-foreground mb-1 flex items-center gap-1"><span className="text-primary font-bold">@</span> Handle</div>
                                  <div className="font-mono text-primary">@{u.networkHandle}</div>
                                </div>
                              )}
                              {u.companyName && (
                                <div>
                                  <div className="text-muted-foreground mb-1 flex items-center gap-1"><Building2 className="h-3 w-3" /> Company</div>
                                  <div>{u.companyName}</div>
                                </div>
                              )}
                              <div>
                                <div className="text-muted-foreground mb-1">User ID</div>
                                <div className="font-mono text-xs opacity-60 truncate">{u.id}</div>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>Mostrando {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} de {total} usuarios</span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(p => p - 1)}>Anterior</Button>
            <Button variant="outline" size="sm" disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}>Siguiente</Button>
          </div>
        </div>
      )}

      </>)}

      {/* ── TRANSACCIONES (antes en la página de Créditos) ─────────────────── */}
      {activeTab === 'transactions' && (
        <div className="space-y-4">
          <div className="flex gap-2">
            <select
              value={txTypeFilter}
              onChange={e => setTxTypeFilter(e.target.value)}
              className="h-9 rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="">Todos los tipos</option>
              <option value="welcome_credit">welcome_credit</option>
              <option value="admin_grant">admin_grant</option>
              <option value="usage">usage</option>
              <option value="subscription_recharge">subscription_recharge</option>
              <option value="welcome_credit_expired">welcome_credit_expired</option>
            </select>
            <Button variant="outline" size="sm" onClick={() => utils.leadprime.getTransactions.invalidate()}>
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>
          <Card>
            <CardContent className="p-0">
              {transactionsQuery.isLoading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : (transactionsQuery.data?.data ?? []).length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">Sin transacciones</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-muted/30">
                        <th className="p-3 text-left font-medium text-muted-foreground">Fecha</th>
                        <th className="p-3 text-left font-medium text-muted-foreground">Usuario</th>
                        <th className="p-3 text-left font-medium text-muted-foreground">Tipo</th>
                        <th className="p-3 text-right font-medium text-muted-foreground">Monto</th>
                        <th className="p-3 text-left font-medium text-muted-foreground">Descripción</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(transactionsQuery.data?.data ?? []).map((tx: any) => (
                        <tr key={tx.id} className="border-b hover:bg-muted/10">
                          <td className="p-3 text-xs text-muted-foreground">
                            {new Date(tx.createdAt).toLocaleString()}
                          </td>
                          <td className="p-3">
                            <div className="font-medium text-xs">{tx.contractorName ?? tx.contractorId}</div>
                            <div className="text-xs text-muted-foreground">{tx.contractorEmail}</div>
                          </td>
                          <td className="p-3">
                            <span className="text-xs bg-muted px-2 py-0.5 rounded-full">{tx.type}</span>
                          </td>
                          <td className="p-3 text-right font-mono font-semibold">
                            <span className={tx.amountCents >= 0 ? 'text-green-400' : 'text-red-400'}>
                              {tx.amountCents >= 0 ? '+' : ''}{fmt$(tx.amountCents)}
                            </span>
                          </td>
                          <td className="p-3 text-xs text-muted-foreground max-w-xs truncate">{tx.description}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* ── HISTORIAL DE CRÉDITOS (antes en la página de Créditos) ─────────── */}
      {activeTab === 'grants' && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <Button variant="outline" size="sm" onClick={() => utils.leadprime.getGrantHistory.invalidate()}>
              <RefreshCw className="h-4 w-4 mr-2" /> Actualizar
            </Button>
          </div>
          <Card>
            <CardContent className="p-0">
              {grantsQuery.isLoading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : (grantsQuery.data?.data ?? []).length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">Sin grants todavía</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-muted/30">
                        <th className="p-3 text-left font-medium text-muted-foreground">Fecha</th>
                        <th className="p-3 text-left font-medium text-muted-foreground">Usuario</th>
                        <th className="p-3 text-right font-medium text-muted-foreground">Monto</th>
                        <th className="p-3 text-left font-medium text-muted-foreground">Descripción</th>
                        <th className="p-3 text-left font-medium text-muted-foreground">Nota</th>
                        <th className="p-3 text-left font-medium text-muted-foreground">Batch ID</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(grantsQuery.data?.data ?? []).map((grant: any) => (
                        <tr key={grant.id} className="border-b hover:bg-muted/10">
                          <td className="p-3 text-xs text-muted-foreground">
                            {new Date(grant.createdAt).toLocaleString()}
                          </td>
                          <td className="p-3">
                            <div className="font-medium text-xs">{grant.contractorName ?? grant.contractorId}</div>
                            <div className="text-xs text-muted-foreground">{grant.contractorEmail}</div>
                          </td>
                          <td className="p-3 text-right font-mono font-semibold text-green-400">
                            +{fmt$(grant.amountCents)}
                          </td>
                          <td className="p-3 text-xs">{grant.description}</td>
                          <td className="p-3 text-xs text-muted-foreground">{grant.note ?? '—'}</td>
                          <td className="p-3 text-xs text-muted-foreground font-mono">
                            {grant.batchId ? (
                              <span className="bg-muted px-1.5 py-0.5 rounded text-xs">{grant.batchId.slice(0, 16)}…</span>
                            ) : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* Edit Contact Modal */}
      {editUser && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-background border border-border rounded-xl p-6 w-full max-w-md space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold">Edit Contact — {editUser.name}</h2>
              <button onClick={() => setEditUser(null)}><X className="h-4 w-4" /></button>
            </div>
            <div className="space-y-3 max-h-[60vh] overflow-y-auto pr-1">
              <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider pt-1">Identity</div>
              <div><Label>Name</Label><Input value={editName} onChange={e => setEditName(e.target.value)} /></div>
              <div><Label>Email</Label><Input type="email" value={editEmail} onChange={e => setEditEmail(e.target.value)} /></div>
              <div><Label>Phone</Label><Input type="tel" placeholder="+1 (555) 000-0000" value={editPhone} onChange={e => setEditPhone(e.target.value)} /></div>
              <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider pt-2">Business</div>
              <div><Label>Company Name</Label><Input placeholder="Acme LLC" value={editCompanyName} onChange={e => setEditCompanyName(e.target.value)} /></div>
              <div><Label>Industry</Label><Input placeholder="e.g. Roofing, HVAC, Plumbing" value={editIndustry} onChange={e => setEditIndustry(e.target.value)} /></div>
              <div><Label>Business Type</Label><Input placeholder="e.g. LLC, Sole Proprietor" value={editBusinessType} onChange={e => setEditBusinessType(e.target.value)} /></div>
              <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider pt-2">Location & Web</div>
              <div className="grid grid-cols-2 gap-2">
                <div><Label>City</Label><Input placeholder="Austin" value={editCity} onChange={e => setEditCity(e.target.value)} /></div>
                <div><Label>State</Label><Input placeholder="TX" maxLength={2} value={editState} onChange={e => setEditState(e.target.value.toUpperCase())} /></div>
              </div>
              <div><Label>Website</Label><Input type="url" placeholder="https://example.com" value={editWebsite} onChange={e => setEditWebsite(e.target.value)} /></div>
            </div>
            <div className="flex gap-2 justify-end pt-2">
              <Button variant="outline" onClick={() => setEditUser(null)}>Cancel</Button>
              <Button
                disabled={updateContact.isPending}
                onClick={() => updateContact.mutate({
                  contractorId: editUser.id,
                  name: editName || undefined,
                  email: editEmail || undefined,
                  phone: editPhone || undefined,
                  industry: editIndustry || undefined,
                  companyName: editCompanyName || undefined,
                  businessName: editCompanyName || undefined,
                  businessType: editBusinessType || undefined,
                  city: editCity || undefined,
                  state: editState || undefined,
                  website: editWebsite || undefined,
                })}
              >
                {updateContact.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4 mr-1" />} Save
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Grant Credits Modal */}
      {grantUser && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-background border border-border rounded-xl p-6 w-full max-w-md space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold">Grant Credits — {grantUser.name}</h2>
              <button onClick={() => setGrantUser(null)}><X className="h-4 w-4" /></button>
            </div>
            <div className="text-sm text-muted-foreground">Current balance: <span className="text-foreground font-medium">${grantUser.balanceDollars}</span></div>
            <div className="space-y-3">
              <div><Label>Amount ($)</Label><Input type="number" min="0.01" step="0.01" placeholder="5.00" value={grantAmount} onChange={e => setGrantAmount(e.target.value)} /></div>
              <div><Label>Description</Label><Input value={grantDesc} onChange={e => setGrantDesc(e.target.value)} /></div>
            </div>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => setGrantUser(null)}>Cancel</Button>
              <Button
                disabled={!grantAmount || parseFloat(grantAmount) <= 0 || grantCredits.isPending}
                onClick={() => grantCredits.mutate({ contractorId: grantUser.id, amountDollars: parseFloat(grantAmount), description: grantDesc })}
              >
                {grantCredits.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Gift className="h-4 w-4 mr-1" />} Grant
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Managed Hosting Modal */}
      {hostingUser && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-background border border-border rounded-xl p-6 w-full max-w-md space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold flex items-center gap-2"><Server className="h-4 w-4 text-cyan-400" /> Website Hosting — {hostingUser.name}</h2>
              <button onClick={() => setHostingUser(null)}><X className="h-4 w-4" /></button>
            </div>

            {hostingQuery.isLoading ? (
              <div className="py-6 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
            ) : (
              <>
                {/* Status summary from the current config */}
                <div className="rounded-lg border border-border p-3 text-sm space-y-1.5">
                  <div className="flex justify-between"><span className="text-muted-foreground">Status</span>
                    <span className={
                      hostingQuery.data?.status === 'active' ? 'text-emerald-400 font-medium' :
                      hostingQuery.data?.status === 'suspended' ? 'text-amber-400 font-medium' : 'text-muted-foreground'
                    }>{hostingQuery.data?.status ?? 'inactive'}</span>
                  </div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Total charged to date</span>
                    <span className="text-foreground font-medium">${((hostingQuery.data?.totalChargedCents ?? 0) / 100).toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Last charged</span>
                    <span className="text-foreground">{hostingQuery.data?.lastChargedAt ? fmtDate(hostingQuery.data.lastChargedAt) : '—'}</span>
                  </div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Next charge</span>
                    <span className="text-foreground">{hostingQuery.data?.nextChargeAt ? fmtDate(hostingQuery.data.nextChargeAt) : '—'}</span>
                  </div>
                </div>

                {/* Controls */}
                <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
                  <input type="checkbox" checked={hostingEnabled} onChange={e => setHostingEnabled(e.target.checked)} className="h-4 w-4 accent-cyan-500" />
                  Hosting enabled (bill this contractor monthly)
                </label>
                <div>
                  <Label>Monthly amount ($)</Label>
                  <Input type="number" min="0" step="0.01" placeholder="0.00" value={hostingAmount} onChange={e => setHostingAmount(e.target.value)} disabled={!hostingEnabled} />
                  <p className="text-xs text-muted-foreground mt-1">
                    Charged from the contractor's credit wallet by LeadPrime's daily billing sweep. Enabling starts billing on the next sweep; disabling stops future charges.
                  </p>
                </div>

                <div className="flex gap-2 justify-end">
                  <Button variant="outline" onClick={() => setHostingUser(null)}>Cancel</Button>
                  <Button
                    disabled={setHosting.isPending || (hostingEnabled && (!hostingAmount || parseFloat(hostingAmount) <= 0))}
                    onClick={() => setHosting.mutate({
                      contractorId: hostingUser.id,
                      enabled: hostingEnabled,
                      monthlyDollars: hostingEnabled ? parseFloat(hostingAmount || '0') : 0,
                    })}
                  >
                    {setHosting.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4 mr-1" />} Save
                  </Button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Subscription Config Modal — componente compartido con Suscripciones */}
      {subUser && (
        <SubscriptionConfigModal
          user={{ id: subUser.id, name: subUser.name }}
          balanceDollars={subUser.balanceDollars}
          onClose={() => setSubUser(null)}
        />
      )}

      {/* Delete Confirm Modal (single) */}
      {deleteUser && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-background border border-border rounded-xl p-6 w-full max-w-md space-y-4">
            <div className="flex items-center gap-3">
              <AlertTriangle className="h-5 w-5 text-red-400 shrink-0" />
              <h2 className="font-semibold">Delete User</h2>
            </div>
            <p className="text-sm text-muted-foreground">
              This will permanently delete <span className="text-foreground font-medium">{deleteUser.name}</span> ({deleteUser.email}) and all their data. This cannot be undone.
            </p>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => setDeleteUser(null)}>Cancel</Button>
              <Button
                variant="destructive"
                disabled={deleteUserMutation.isPending}
                onClick={() => deleteUserMutation.mutate({ contractorId: deleteUser.id })}
              >
                {deleteUserMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4 mr-1" />} Delete Permanently
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Batch Delete Confirm Modal */}
      {showBatchDeleteConfirm && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-background border border-border rounded-xl p-6 w-full max-w-md space-y-4">
            <div className="flex items-center gap-3">
              <AlertTriangle className="h-5 w-5 text-red-400 shrink-0" />
              <h2 className="font-semibold">Delete {selectedIds.size} Users</h2>
            </div>
            <p className="text-sm text-muted-foreground">
              This will permanently delete <span className="text-foreground font-medium">{selectedIds.size} users</span> and all their data. This cannot be undone.
            </p>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => setShowBatchDeleteConfirm(false)}>Cancel</Button>
              <Button
                variant="destructive"
                disabled={deleteUsersMutation.isPending}
                onClick={() => deleteUsersMutation.mutate({ contractorIds: Array.from(selectedIds) })}
              >
                {deleteUsersMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4 mr-1" />} Delete {selectedIds.size} Users
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
