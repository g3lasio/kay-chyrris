/**
 * LEADPRIME CREDITS ADMIN — Chyrris KAI
 *
 * Admin panel for managing LeadPrime user wallet credits.
 * Features:
 *   - Stats overview: total users, balances, active subscribers
 *   - User table with real-time wallet balances, search, and checkbox selection
 *   - Grant panel: individual or batch credit grants with description + note
 *   - Transaction history with type filter
 *   - Admin grant history with batch grouping
 */
import { useState, useMemo } from 'react';
import { trpc } from '@/lib/trpc';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import {
  Wallet,
  Users,
  Gift,
  History,
  Search,
  CheckSquare,
  Square,
  Loader2,
  RefreshCw,
  TrendingUp,
  DollarSign,
  ChevronDown,
  ChevronUp,
  Send,
  AlertTriangle,
  BadgeCheck,
  Clock,
} from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────

interface LeadPrimeUser {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  createdAt: string;
  balanceCents: number;
  balanceDollars: string;
  welcomeCreditGranted: boolean;
  welcomeCreditExpiresAt: string | null;
  subscriptionStatus: string | null;
  trialEnd: string | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function subscriptionBadge(status: string | null) {
  if (!status) return <span className="text-xs text-muted-foreground">No sub</span>;
  const colors: Record<string, string> = {
    active: 'bg-green-500/20 text-green-300 border border-green-500/30',
    trialing: 'bg-amber-500/20 text-amber-300 border border-amber-500/30',
    canceled: 'bg-red-500/20 text-red-300 border border-red-500/30',
    past_due: 'bg-orange-500/20 text-orange-300 border border-orange-500/30',
  };
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${colors[status] ?? 'bg-gray-500/20 text-gray-300'}`}>
      {status}
    </span>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function LeadPrimeCreditsAdmin() {
  const [search, setSearch] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [amountDollars, setAmountDollars] = useState('');
  const [description, setDescription] = useState('');
  const [note, setNote] = useState('');
  const [activeTab, setActiveTab] = useState<'users' | 'transactions' | 'grants'>('users');
  const [showGrantPanel, setShowGrantPanel] = useState(false);
  const [txTypeFilter, setTxTypeFilter] = useState('');

  // ─── Queries ────────────────────────────────────────────────────────────────

  const statsQuery = trpc.leadprime.getStats.useQuery(undefined, { refetchInterval: 30000 });
  const usersQuery = trpc.leadprime.getUsers.useQuery({ search: search || undefined, limit: 200 }, {
    refetchInterval: 30000,
  });
  const transactionsQuery = trpc.leadprime.getTransactions.useQuery(
    { type: txTypeFilter || undefined, limit: 100 },
    { enabled: activeTab === 'transactions' }
  );
  const grantsQuery = trpc.leadprime.getGrantHistory.useQuery(
    { limit: 100 },
    { enabled: activeTab === 'grants' }
  );

  // ─── Mutations ──────────────────────────────────────────────────────────────

  const grantSingleMutation = trpc.leadprime.grantCredits.useMutation();
  const grantBatchMutation = trpc.leadprime.grantCreditsBatch.useMutation();
  const utils = trpc.useUtils();

  // ─── Derived state ──────────────────────────────────────────────────────────

  const users: LeadPrimeUser[] = useMemo(() => usersQuery.data?.data ?? [], [usersQuery.data]);
  const stats = statsQuery.data?.data;
  const allSelected = users.length > 0 && selectedIds.size === users.length;
  const someSelected = selectedIds.size > 0 && !allSelected;

  // ─── Handlers ───────────────────────────────────────────────────────────────

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
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(users.map(u => u.id)));
    }
  }

  async function handleGrant() {
    const amount = parseFloat(amountDollars);
    if (!amount || amount <= 0) {
      toast.error('Enter a valid amount');
      return;
    }
    if (!description.trim()) {
      toast.error('Description is required');
      return;
    }
    if (selectedIds.size === 0) {
      toast.error('Select at least one user');
      return;
    }

    const ids = Array.from(selectedIds);

    try {
      if (ids.length === 1) {
        const result = await grantSingleMutation.mutateAsync({
          contractorId: ids[0],
          amountDollars: amount,
          description: description.trim(),
          note: note.trim() || undefined,
        });
        toast.success(`Granted $${amount.toFixed(2)} to user. New balance: ${formatCents(result.newBalanceCents)}`);
      } else {
        const result = await grantBatchMutation.mutateAsync({
          contractorIds: ids,
          amountDollars: amount,
          description: description.trim(),
          note: note.trim() || undefined,
        });
        toast.success(
          `Batch grant complete: ${result.successCount} users credited, ${result.failCount} failed. Batch ID: ${result.batchId}`
        );
      }

      // Reset form
      setAmountDollars('');
      setDescription('');
      setNote('');
      setSelectedIds(new Set());
      setShowGrantPanel(false);

      // Refresh
      utils.leadprime.getUsers.invalidate();
      utils.leadprime.getStats.invalidate();
      utils.leadprime.getGrantHistory.invalidate();
      utils.leadprime.getTransactions.invalidate();
    } catch (err: any) {
      toast.error(`Grant failed: ${err.message}`);
    }
  }

  const isGranting = grantSingleMutation.isPending || grantBatchMutation.isPending;

  // ─── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6 pb-10">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Wallet className="h-6 w-6 text-primary" />
            LeadPrime Credits
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Manage wallet credits for LeadPrime users
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            utils.leadprime.getUsers.invalidate();
            utils.leadprime.getStats.invalidate();
          }}
        >
          <RefreshCw className="h-4 w-4 mr-2" />
          Refresh
        </Button>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {[
          { label: 'Total Users', value: stats?.totalUsers ?? '—', icon: Users },
          { label: 'With Wallet', value: stats?.usersWithWallet ?? '—', icon: Wallet },
          { label: 'Total Balance', value: stats ? formatCents(stats.totalBalanceCents) : '—', icon: DollarSign },
          { label: 'Granted This Month', value: stats ? formatCents(stats.totalGrantedThisMonth) : '—', icon: TrendingUp },
          { label: 'Active Subs', value: stats?.activeSubscribers ?? '—', icon: BadgeCheck },
          { label: 'Trial Users', value: stats?.trialUsers ?? '—', icon: Clock },
        ].map(({ label, value, icon: Icon }) => (
          <Card key={label} className="bg-card/50">
            <CardContent className="p-3">
              <div className="flex items-center gap-2 mb-1">
                <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-xs text-muted-foreground">{label}</span>
              </div>
              <p className="text-lg font-bold">{statsQuery.isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b">
        {(['users', 'transactions', 'grants'] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 text-sm font-medium capitalize transition-colors border-b-2 -mb-px ${
              activeTab === tab
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {tab === 'users' ? 'Users & Wallets' : tab === 'transactions' ? 'Transactions' : 'Grant History'}
          </button>
        ))}
      </div>

      {/* ── USERS TAB ─────────────────────────────────────────────────────── */}
      {activeTab === 'users' && (
        <div className="space-y-4">
          {/* Search + Grant Button */}
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by name, email, or phone..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>
            <Button
              onClick={() => setShowGrantPanel(!showGrantPanel)}
              disabled={selectedIds.size === 0}
              className="gap-2"
            >
              <Gift className="h-4 w-4" />
              Grant Credits
              {selectedIds.size > 0 && (
                <span className="bg-white/20 text-white text-xs px-1.5 py-0.5 rounded-full">
                  {selectedIds.size}
                </span>
              )}
              {showGrantPanel ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            </Button>
          </div>

          {/* Grant Panel */}
          {showGrantPanel && selectedIds.size > 0 && (
            <Card className="border-primary/40 bg-primary/5">
              <CardHeader className="pb-3 pt-4">
                <CardTitle className="text-base flex items-center gap-2">
                  <Gift className="h-4 w-4" />
                  Grant Credits to {selectedIds.size} user{selectedIds.size > 1 ? 's' : ''}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div>
                    <Label className="text-xs">Amount (USD) *</Label>
                    <Input
                      type="number"
                      min="0.01"
                      max="1000"
                      step="0.01"
                      placeholder="e.g. 5.00"
                      value={amountDollars}
                      onChange={e => setAmountDollars(e.target.value)}
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Description *</Label>
                    <Input
                      placeholder="e.g. December Event Bonus"
                      value={description}
                      onChange={e => setDescription(e.target.value)}
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Internal Note (optional)</Label>
                    <Input
                      placeholder="e.g. Promo code XMAS2025"
                      value={note}
                      onChange={e => setNote(e.target.value)}
                    />
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <Button onClick={handleGrant} disabled={isGranting} className="gap-2">
                    {isGranting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                    {isGranting ? 'Granting...' : `Grant $${parseFloat(amountDollars || '0').toFixed(2)} to ${selectedIds.size} user${selectedIds.size > 1 ? 's' : ''}`}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => { setShowGrantPanel(false); setSelectedIds(new Set()); }}>
                    Cancel
                  </Button>
                  {selectedIds.size > 0 && amountDollars && (
                    <span className="text-xs text-muted-foreground">
                      Total: {formatCents(Math.round(parseFloat(amountDollars || '0') * 100 * selectedIds.size))}
                    </span>
                  )}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Users Table */}
          <Card>
            <CardContent className="p-0">
              {usersQuery.isLoading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : usersQuery.isError ? (
                <div className="flex items-center gap-2 text-destructive p-6">
                  <AlertTriangle className="h-5 w-5" />
                  <span>Failed to load users: {usersQuery.error?.message}</span>
                </div>
              ) : users.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">No users found</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-muted/30">
                        <th className="p-3 text-left w-10">
                          <button onClick={toggleAll} className="text-muted-foreground hover:text-foreground">
                            {allSelected ? (
                              <CheckSquare className="h-4 w-4 text-primary" />
                            ) : someSelected ? (
                              <CheckSquare className="h-4 w-4 text-primary/50" />
                            ) : (
                              <Square className="h-4 w-4" />
                            )}
                          </button>
                        </th>
                        <th className="p-3 text-left font-medium text-muted-foreground">User</th>
                        <th className="p-3 text-left font-medium text-muted-foreground">Phone</th>
                        <th className="p-3 text-right font-medium text-muted-foreground">Balance</th>
                        <th className="p-3 text-center font-medium text-muted-foreground">Subscription</th>
                        <th className="p-3 text-center font-medium text-muted-foreground">Welcome Credit</th>
                        <th className="p-3 text-left font-medium text-muted-foreground">Joined</th>
                      </tr>
                    </thead>
                    <tbody>
                      {users.map(user => {
                        const isSelected = selectedIds.has(user.id);
                        return (
                          <tr
                            key={user.id}
                            onClick={() => toggleUser(user.id)}
                            className={`border-b cursor-pointer transition-colors hover:bg-muted/20 ${isSelected ? 'bg-primary/5' : ''}`}
                          >
                            <td className="p-3">
                              {isSelected ? (
                                <CheckSquare className="h-4 w-4 text-primary" />
                              ) : (
                                <Square className="h-4 w-4 text-muted-foreground" />
                              )}
                            </td>
                            <td className="p-3">
                              <div className="font-medium">{user.name}</div>
                              <div className="text-xs text-muted-foreground">{user.email}</div>
                            </td>
                            <td className="p-3 text-muted-foreground text-xs">{user.phone ?? '—'}</td>
                            <td className="p-3 text-right">
                              <span className={`font-mono font-semibold ${user.balanceCents <= 0 ? 'text-red-400' : user.balanceCents < 200 ? 'text-amber-400' : 'text-green-400'}`}>
                                {formatCents(user.balanceCents)}
                              </span>
                            </td>
                            <td className="p-3 text-center">{subscriptionBadge(user.subscriptionStatus)}</td>
                            <td className="p-3 text-center">
                              {user.welcomeCreditGranted ? (
                                <span className="text-xs text-green-400">✓ Granted</span>
                              ) : (
                                <span className="text-xs text-muted-foreground">—</span>
                              )}
                            </td>
                            <td className="p-3 text-xs text-muted-foreground">
                              {new Date(user.createdAt).toLocaleDateString()}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  <div className="p-3 text-xs text-muted-foreground border-t">
                    {users.length} users loaded · {selectedIds.size} selected
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* ── TRANSACTIONS TAB ──────────────────────────────────────────────── */}
      {activeTab === 'transactions' && (
        <div className="space-y-4">
          <div className="flex gap-2">
            <select
              value={txTypeFilter}
              onChange={e => setTxTypeFilter(e.target.value)}
              className="h-9 rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="">All types</option>
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
                <div className="text-center py-12 text-muted-foreground">No transactions found</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-muted/30">
                        <th className="p-3 text-left font-medium text-muted-foreground">Date</th>
                        <th className="p-3 text-left font-medium text-muted-foreground">User</th>
                        <th className="p-3 text-left font-medium text-muted-foreground">Type</th>
                        <th className="p-3 text-right font-medium text-muted-foreground">Amount</th>
                        <th className="p-3 text-left font-medium text-muted-foreground">Description</th>
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
                              {tx.amountCents >= 0 ? '+' : ''}{formatCents(tx.amountCents)}
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

      {/* ── GRANT HISTORY TAB ─────────────────────────────────────────────── */}
      {activeTab === 'grants' && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <Button variant="outline" size="sm" onClick={() => utils.leadprime.getGrantHistory.invalidate()}>
              <RefreshCw className="h-4 w-4 mr-2" />
              Refresh
            </Button>
          </div>
          <Card>
            <CardContent className="p-0">
              {grantsQuery.isLoading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : (grantsQuery.data?.data ?? []).length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">No grants yet</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-muted/30">
                        <th className="p-3 text-left font-medium text-muted-foreground">Date</th>
                        <th className="p-3 text-left font-medium text-muted-foreground">User</th>
                        <th className="p-3 text-right font-medium text-muted-foreground">Amount</th>
                        <th className="p-3 text-left font-medium text-muted-foreground">Description</th>
                        <th className="p-3 text-left font-medium text-muted-foreground">Note</th>
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
                            +{formatCents(grant.amountCents)}
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
    </div>
  );
}
