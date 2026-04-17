/**
 * LEADPRIME USERS INTELLIGENCE — Chyrris KAI
 *
 * Full enriched user table with:
 * - Stats overview (total, active, balance, spent, by industry)
 * - Filterable/sortable table with all user data
 * - Quick filters: inactive, low balance, no subscription, licensed
 * - Per-user actions: edit contact, grant credits, delete
 * - Batch delete: select multiple users and delete at once
 */
import { useState, useMemo } from 'react';
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
  Phone, Mail, MapPin, Calendar, Briefcase, Star,
} from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────
interface EnrichedUser {
  id: string;
  name: string;
  email: string;
  phone: string | null;
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

// ─── Component ────────────────────────────────────────────────────────────────
export default function LeadPrimeUsersIntelligence() {
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

  // Grant credits modal state
  const [grantUser, setGrantUser] = useState<EnrichedUser | null>(null);
  const [grantAmount, setGrantAmount] = useState('');
  const [grantDesc, setGrantDesc] = useState('Admin grant');

  // Delete confirm state (single)
  const [deleteUser, setDeleteUser] = useState<EnrichedUser | null>(null);

  // Batch selection state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showBatchDeleteConfirm, setShowBatchDeleteConfirm] = useState(false);

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
          <h1 className="text-2xl font-bold tracking-tight">Users Intelligence</h1>
          <p className="text-sm text-muted-foreground mt-1">Full enriched user data for marketing and operations</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => { utils.leadprime.getEnrichedUsers.invalidate(); utils.leadprime.getUserIntelligenceStats.invalidate(); }}>
          <RefreshCw className="h-4 w-4 mr-2" /> Refresh
        </Button>
      </div>

      {/* Stats Cards */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1"><Users className="h-3.5 w-3.5" /> Total Users</div>
              <div className="text-2xl font-bold">{stats.totalUsers}</div>
              <div className="text-xs text-muted-foreground mt-0.5">{stats.activeUsers} active (30d)</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1"><DollarSign className="h-3.5 w-3.5" /> Total Wallet</div>
              <div className="text-2xl font-bold">{fmt$(stats.totalBalanceCents)}</div>
              <div className="text-xs text-muted-foreground mt-0.5">across all users</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1"><TrendingUp className="h-3.5 w-3.5" /> Total Spent</div>
              <div className="text-2xl font-bold">{fmt$(stats.totalSpentCents)}</div>
              <div className="text-xs text-muted-foreground mt-0.5">all time revenue</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1"><Shield className="h-3.5 w-3.5" /> Licensed</div>
              <div className="text-2xl font-bold">{stats.withLicense}</div>
              <div className="text-xs text-muted-foreground mt-0.5">{stats.withoutLicense} without license</div>
            </CardContent>
          </Card>
        </div>
      )}

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
        <div className="flex items-center gap-3 px-4 py-2.5 bg-destructive/10 border border-destructive/30 rounded-lg">
          <span className="text-sm font-medium text-destructive">{selectedIds.size} user{selectedIds.size > 1 ? 's' : ''} selected</span>
          <Button
            variant="destructive"
            size="sm"
            onClick={() => setShowBatchDeleteConfirm(true)}
            disabled={deleteUsersMutation.isPending}
          >
            <Trash2 className="h-3.5 w-3.5 mr-1.5" />
            Delete Selected
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setSelectedIds(new Set())}>
            <X className="h-3.5 w-3.5 mr-1" /> Clear selection
          </Button>
        </div>
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
                    <th className="text-left px-4 py-3 font-medium">User / Company</th>
                    <th className="text-left px-3 py-3 font-medium">Industry</th>
                    <th className="text-left px-3 py-3 font-medium">Location</th>
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
                    <>
                      <tr
                        key={u.id}
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
                          <div className="font-medium truncate max-w-[180px]">{u.businessName || u.name}</div>
                          <div className="text-xs text-muted-foreground truncate max-w-[180px]">{u.email}</div>
                          {u.hasLicense && <span className="text-xs text-emerald-400 flex items-center gap-0.5 mt-0.5"><BadgeCheck className="h-3 w-3" /> Licensed</span>}
                        </td>
                        <td className="px-3 py-3">
                          <div className="text-xs">{u.industry ?? '—'}</div>
                          {u.tradeType && <div className="text-xs text-muted-foreground">{u.tradeType}</div>}
                        </td>
                        <td className="px-3 py-3 text-xs text-muted-foreground">
                          {u.city && u.state ? `${u.city}, ${u.state}` : u.state ?? u.city ?? '—'}
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
                            <button onClick={() => setDeleteUser(u)} className="p-1.5 rounded hover:bg-accent transition-colors" title="Delete user">
                              <Trash2 className="h-3.5 w-3.5 text-muted-foreground hover:text-red-400" />
                            </button>
                          </div>
                        </td>
                      </tr>
                      {expandedId === u.id && (
                        <tr key={`${u.id}-expanded`} className="bg-accent/20">
                          <td colSpan={11} className="px-6 py-4">
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
                                <div>{u.subscriptionPlanId ?? '—'}</div>
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
                              <div>
                                <div className="text-muted-foreground mb-1">User ID</div>
                                <div className="font-mono text-xs opacity-60 truncate">{u.id}</div>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </>
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
          <span>Showing {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} of {total} users</span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(p => p - 1)}>Previous</Button>
            <Button variant="outline" size="sm" disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}>Next</Button>
          </div>
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
            <div className="space-y-3">
              <div><Label>Name</Label><Input value={editName} onChange={e => setEditName(e.target.value)} /></div>
              <div><Label>Email</Label><Input value={editEmail} onChange={e => setEditEmail(e.target.value)} /></div>
              <div><Label>Phone</Label><Input value={editPhone} onChange={e => setEditPhone(e.target.value)} /></div>
            </div>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => setEditUser(null)}>Cancel</Button>
              <Button
                disabled={updateContact.isPending}
                onClick={() => updateContact.mutate({ contractorId: editUser.id, name: editName || undefined, email: editEmail || undefined, phone: editPhone || undefined })}
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
