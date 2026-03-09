/**
 * AI CREDITS ADMIN — Chyrris KAI
 *
 * Central page for managing AI credits across all Owl Fenc users.
 * Features:
 *   - Real-time wallet balance table with plan filtering and search
 *   - Checkbox selection: individual, by plan, or all users
 *   - Grant panel: amount + description + optional expiry date
 *   - Full grant history with batch grouping
 *   - C1: Notify Users post-grant via Announcements system
 */

import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import {
  Zap,
  Users,
  Gift,
  History,
  Search,
  CheckSquare,
  Square,
  Loader2,
  RefreshCw,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  Send,
  Megaphone,
  ChevronDown,
  ChevronUp,
} from "lucide-react";

type PlanFilter = 'all' | 'primo' | 'mero' | 'master' | 'free';

interface UserWalletRow {
  userId: number;
  firebaseUid: string;
  email: string;
  displayName: string | null;
  planName: string;
  planId: number;
  creditBalance: number;
  lifetimeCreditsEarned: number;
  lifetimeCreditsSpent: number;
  lastTransactionAt: Date | null;
  walletCreatedAt: Date | null;
}

const PLAN_BADGE_COLORS: Record<string, string> = {
  'Master Contractor': 'bg-purple-500/20 text-purple-300 border border-purple-500/30',
  'Mero Patrón': 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30',
  'Primo Chambeador': 'bg-blue-500/20 text-blue-300 border border-blue-500/30',
  'Free Trial': 'bg-amber-500/20 text-amber-300 border border-amber-500/30',
  'Free': 'bg-slate-500/20 text-slate-400 border border-slate-500/30',
};

function getPlanBadge(planName: string) {
  const cls = PLAN_BADGE_COLORS[planName] ?? PLAN_BADGE_COLORS['Free'];
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${cls}`}>
      {planName}
    </span>
  );
}

function getCreditColor(balance: number) {
  if (balance === 0) return 'text-red-400';
  if (balance < 20) return 'text-amber-400';
  if (balance < 100) return 'text-yellow-300';
  return 'text-green-400';
}

export default function AICreditsAdmin() {
  // ─── State ───────────────────────────────────────────────────────────────
  const [planFilter, setPlanFilter] = useState<PlanFilter>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedUserIds, setSelectedUserIds] = useState<Set<number>>(new Set());
  const [grantAmount, setGrantAmount] = useState('');
  const [grantDescription, setGrantDescription] = useState('');
  const [grantNote, setGrantNote] = useState('');
  const [grantExpiry, setGrantExpiry] = useState('');
  const [isGranting, setIsGranting] = useState(false);
  const [showHistory, setShowHistory] = useState(true);
  const [showNotifyPanel, setShowNotifyPanel] = useState(false);
  const [notifyTitle, setNotifyTitle] = useState('');
  const [notifyMessage, setNotifyMessage] = useState('');
  const [lastGrantResult, setLastGrantResult] = useState<{
    usersGranted: number;
    totalCreditsGranted: number;
    description: string;
  } | null>(null);

  // ─── tRPC Queries ─────────────────────────────────────────────────────────
  const {
    data: walletData,
    isLoading: loadingWallets,
    refetch: refetchWallets,
  } = trpc.owlfenc.getUserWalletBalances.useQuery(
    { planFilter: planFilter === 'all' ? undefined : planFilter },
    { refetchInterval: 8000, refetchIntervalInBackground: false }
  );

  const {
    data: statsData,
    refetch: refetchStats,
  } = trpc.owlfenc.getWalletStats.useQuery(
    undefined,
    { refetchInterval: 10000, refetchIntervalInBackground: false }
  );

  const {
    data: historyData,
    isLoading: loadingHistory,
    refetch: refetchHistory,
  } = trpc.owlfenc.getAdminGrantHistory.useQuery(
    { limit: 200 },
    { refetchInterval: 15000, refetchIntervalInBackground: false }
  );

  const grantMutation = trpc.owlfenc.grantCreditsToUsers.useMutation({
    onSuccess: (result) => {
      setIsGranting(false);
      if (result.success) {
        toast.success(
          `✅ ${result.usersGranted} users received ${result.totalCreditsGranted.toLocaleString()} credits`
        );
        setLastGrantResult({
          usersGranted: result.usersGranted,
          totalCreditsGranted: result.totalCreditsGranted,
          description: grantDescription,
        });
        setSelectedUserIds(new Set());
        setGrantAmount('');
        setGrantDescription('');
        setGrantNote('');
        setGrantExpiry('');
        refetchWallets();
        refetchStats();
        refetchHistory();
        // Auto-show notify panel after successful grant
        setShowNotifyPanel(true);
        setNotifyTitle(`🎁 You received ${result.totalCreditsGranted} AI Credits!`);
        setNotifyMessage(
          `We've just added ${result.totalCreditsGranted} AI Credits to your account.\n\nReason: ${grantDescription}\n\nYour credits are ready to use — generate estimates, contracts, permits, and more. Credits never expire.\n\nThank you for being part of Mervin AI! 🚀`
        );
      } else {
        toast.error(`Grant partially failed. ${result.errors.length} errors.`);
      }
    },
    onError: (error) => {
      setIsGranting(false);
      toast.error(`Grant failed: ${error.message}`);
    },
  });

  const sendCampaignMutation = trpc.notifications.sendCampaign.useMutation({
    onSuccess: (data) => {
      if (data.success) {
        toast.success(`📧 Notification sent to ${data.sentCount} users!`);
        setShowNotifyPanel(false);
        setNotifyTitle('');
        setNotifyMessage('');
      } else {
        toast.error(`Failed to send notification: ${data.error}`);
      }
    },
    onError: (error) => {
      toast.error(`Notification error: ${error.message}`);
    },
  });

  // ─── Derived Data ─────────────────────────────────────────────────────────
  const users: UserWalletRow[] = useMemo(() => {
    const raw = walletData?.data ?? [];
    if (!searchQuery.trim()) return raw;
    const q = searchQuery.toLowerCase();
    return raw.filter(
      (u) =>
        u.email.toLowerCase().includes(q) ||
        (u.displayName ?? '').toLowerCase().includes(q)
    );
  }, [walletData, searchQuery]);

  const stats = statsData?.data;
  const history = historyData?.data ?? [];

  // ─── Selection Helpers ────────────────────────────────────────────────────
  const allSelected = users.length > 0 && users.every((u) => selectedUserIds.has(u.userId));
  const someSelected = selectedUserIds.size > 0;

  const toggleUser = (userId: number) => {
    setSelectedUserIds((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  };

  const toggleAll = () => {
    if (allSelected) {
      setSelectedUserIds(new Set());
    } else {
      setSelectedUserIds(new Set(users.map((u) => u.userId)));
    }
  };

  const selectByPlan = (planName: string) => {
    const ids = users
      .filter((u) => u.planName.toLowerCase().includes(planName.toLowerCase()))
      .map((u) => u.userId);
    setSelectedUserIds(new Set(ids));
    toast.info(`Selected ${ids.length} ${planName} users`);
  };

  // ─── Grant Handler ────────────────────────────────────────────────────────
  const handleGrant = () => {
    if (selectedUserIds.size === 0) {
      toast.error('Select at least one user');
      return;
    }
    const amount = parseInt(grantAmount, 10);
    if (!amount || amount < 1 || amount > 10000) {
      toast.error('Enter a valid amount between 1 and 10,000');
      return;
    }
    if (!grantDescription.trim() || grantDescription.trim().length < 3) {
      toast.error('Description is required (min 3 characters)');
      return;
    }

    setIsGranting(true);
    grantMutation.mutate({
      userIds: Array.from(selectedUserIds),
      amount,
      description: grantDescription.trim(),
      adminNote: grantNote.trim() || undefined,
      expiresAt: grantExpiry || undefined,
    });
  };

  // ─── Notify Handler ───────────────────────────────────────────────────────
  const handleNotify = () => {
    if (!notifyTitle.trim() || !notifyMessage.trim()) {
      toast.error('Title and message are required');
      return;
    }
    sendCampaignMutation.mutate({
      title: notifyTitle,
      message: notifyMessage,
      type: 'announcement',
      targetAudience: 'all',
    });
  };

  // ─── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-slate-950 text-white p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-yellow-500/20 border border-yellow-500/30 flex items-center justify-center">
            <Zap className="w-5 h-5 text-yellow-400" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white">AI Credits Admin</h1>
            <p className="text-slate-400 text-sm">Grant and manage AI credits for Owl Fenc users</p>
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => { refetchWallets(); refetchStats(); refetchHistory(); }}
          className="border-slate-700 text-slate-400 hover:text-white"
        >
          <RefreshCw className="w-4 h-4 mr-2" />
          Refresh
        </Button>
      </div>

      {/* Stats Row */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        {[
          {
            label: 'Credits in Circulation',
            value: stats?.totalCreditsInCirculation?.toLocaleString() ?? '—',
            icon: <Zap className="w-4 h-4 text-yellow-400" />,
            color: 'text-yellow-400',
          },
          {
            label: 'Admin Grants This Month',
            value: stats?.totalAdminGrantsThisMonth?.toLocaleString() ?? '—',
            icon: <Gift className="w-4 h-4 text-green-400" />,
            color: 'text-green-400',
          },
          {
            label: 'Consumed This Month',
            value: stats?.totalCreditsConsumedThisMonth?.toLocaleString() ?? '—',
            icon: <TrendingDown className="w-4 h-4 text-red-400" />,
            color: 'text-red-400',
          },
          {
            label: 'Users with Wallet',
            value: stats?.usersWithWallet?.toLocaleString() ?? '—',
            icon: <Users className="w-4 h-4 text-cyan-400" />,
            color: 'text-cyan-400',
          },
          {
            label: 'Zero Balance Users',
            value: stats?.usersWithZeroBalance?.toLocaleString() ?? '—',
            icon: <AlertTriangle className="w-4 h-4 text-amber-400" />,
            color: 'text-amber-400',
          },
        ].map((stat) => (
          <Card key={stat.label} className="bg-slate-900 border-slate-800">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-1">
                {stat.icon}
                <span className="text-xs text-slate-500">{stat.label}</span>
              </div>
              <div className={`text-2xl font-bold ${stat.color}`}>{stat.value}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        {/* Left: User Table */}
        <div className="xl:col-span-2 space-y-4">
          <Card className="bg-slate-900 border-slate-800">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between flex-wrap gap-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Users className="w-4 h-4 text-cyan-400" />
                  Users — Wallet Balances
                  {someSelected && (
                    <span className="text-xs bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 px-2 py-0.5 rounded-full ml-2">
                      {selectedUserIds.size} selected
                    </span>
                  )}
                </CardTitle>
                <div className="flex items-center gap-2 flex-wrap">
                  {/* Quick-select by plan */}
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => selectByPlan('Master')}
                    className="text-xs border-purple-700 text-purple-300 hover:bg-purple-500/10 h-7"
                  >
                    Select Masters
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => selectByPlan('Mero')}
                    className="text-xs border-cyan-700 text-cyan-300 hover:bg-cyan-500/10 h-7"
                  >
                    Select Mero Patrones
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setSelectedUserIds(new Set())}
                    className="text-xs border-slate-700 text-slate-400 h-7"
                    disabled={!someSelected}
                  >
                    Clear
                  </Button>
                </div>
              </div>
              {/* Search + Plan Filter */}
              <div className="flex gap-3 mt-3">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                  <Input
                    placeholder="Search by name or email..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-9 bg-slate-800 border-slate-700 text-white placeholder-slate-500 h-9"
                  />
                </div>
                <Select value={planFilter} onValueChange={(v) => setPlanFilter(v as PlanFilter)}>
                  <SelectTrigger className="w-44 bg-slate-800 border-slate-700 text-white h-9">
                    <SelectValue placeholder="All Plans" />
                  </SelectTrigger>
                  <SelectContent className="bg-slate-800 border-slate-700">
                    <SelectItem value="all">All Plans</SelectItem>
                    <SelectItem value="master">Master Contractor</SelectItem>
                    <SelectItem value="mero">Mero Patrón</SelectItem>
                    <SelectItem value="primo">Primo Chambeador</SelectItem>
                    <SelectItem value="free">Free</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-slate-800">
                      <th className="w-10 py-2 px-3">
                        <button onClick={toggleAll} className="text-slate-400 hover:text-white transition-colors">
                          {allSelected ? (
                            <CheckSquare className="w-4 h-4 text-cyan-400" />
                          ) : (
                            <Square className="w-4 h-4" />
                          )}
                        </button>
                      </th>
                      <th className="text-left py-2 px-3 text-xs font-semibold text-slate-400">User</th>
                      <th className="text-left py-2 px-3 text-xs font-semibold text-slate-400">Plan</th>
                      <th className="text-center py-2 px-3 text-xs font-semibold text-yellow-400">
                        <span className="flex items-center justify-center gap-1">
                          <Zap className="w-3 h-3" /> Balance
                        </span>
                      </th>
                      <th className="text-center py-2 px-3 text-xs font-semibold text-slate-400">Earned</th>
                      <th className="text-center py-2 px-3 text-xs font-semibold text-slate-400">Spent</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loadingWallets ? (
                      <tr>
                        <td colSpan={6} className="text-center py-8">
                          <Loader2 className="w-5 h-5 animate-spin text-cyan-400 mx-auto" />
                        </td>
                      </tr>
                    ) : users.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="text-center py-8 text-slate-500 text-sm">
                          No users found
                        </td>
                      </tr>
                    ) : (
                      users.map((user) => {
                        const isSelected = selectedUserIds.has(user.userId);
                        return (
                          <tr
                            key={user.userId}
                            onClick={() => toggleUser(user.userId)}
                            className={`border-b border-slate-800 cursor-pointer transition-colors ${
                              isSelected
                                ? 'bg-cyan-500/10 hover:bg-cyan-500/15'
                                : 'hover:bg-slate-800/50'
                            }`}
                          >
                            <td className="py-2 px-3">
                              {isSelected ? (
                                <CheckSquare className="w-4 h-4 text-cyan-400" />
                              ) : (
                                <Square className="w-4 h-4 text-slate-600" />
                              )}
                            </td>
                            <td className="py-2 px-3">
                              <div className="text-white text-sm font-medium">
                                {user.displayName || 'N/A'}
                              </div>
                              <div className="text-slate-500 text-xs">{user.email}</div>
                            </td>
                            <td className="py-2 px-3">
                              {getPlanBadge(user.planName)}
                            </td>
                            <td className={`py-2 px-3 text-center font-bold text-sm ${getCreditColor(user.creditBalance)}`}>
                              {user.creditBalance.toLocaleString()}
                            </td>
                            <td className="py-2 px-3 text-center text-slate-400 text-xs">
                              {user.lifetimeCreditsEarned.toLocaleString()}
                            </td>
                            <td className="py-2 px-3 text-center text-slate-400 text-xs">
                              {user.lifetimeCreditsSpent.toLocaleString()}
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Right: Grant Panel */}
        <div className="space-y-4">
          <Card className="bg-slate-900 border-slate-800 sticky top-6">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Gift className="w-4 h-4 text-green-400" />
                Grant Credits
              </CardTitle>
              {someSelected && (
                <p className="text-xs text-slate-400 mt-1">
                  Will grant to{' '}
                  <span className="text-cyan-400 font-semibold">{selectedUserIds.size} user{selectedUserIds.size !== 1 ? 's' : ''}</span>
                </p>
              )}
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Amount */}
              <div className="space-y-1.5">
                <Label className="text-xs text-slate-400">Credits to Grant *</Label>
                <div className="relative">
                  <Zap className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-yellow-400" />
                  <Input
                    type="number"
                    min="1"
                    max="10000"
                    placeholder="e.g. 120"
                    value={grantAmount}
                    onChange={(e) => setGrantAmount(e.target.value)}
                    className="pl-9 bg-slate-800 border-slate-700 text-white placeholder-slate-500"
                  />
                </div>
                {/* Quick amounts */}
                <div className="flex gap-2 flex-wrap">
                  {[20, 50, 120, 300, 600, 1500].map((amt) => (
                    <button
                      key={amt}
                      onClick={() => setGrantAmount(String(amt))}
                      className={`text-xs px-2 py-1 rounded border transition-colors ${
                        grantAmount === String(amt)
                          ? 'bg-yellow-500/20 border-yellow-500/50 text-yellow-300'
                          : 'border-slate-700 text-slate-500 hover:border-slate-500 hover:text-slate-300'
                      }`}
                    >
                      {amt}
                    </button>
                  ))}
                </div>
              </div>

              {/* Description */}
              <div className="space-y-1.5">
                <Label className="text-xs text-slate-400">Event Description *</Label>
                <Input
                  placeholder="e.g. Networking Event December 2026"
                  value={grantDescription}
                  onChange={(e) => setGrantDescription(e.target.value)}
                  className="bg-slate-800 border-slate-700 text-white placeholder-slate-500"
                />
              </div>

              {/* Admin Note (internal) */}
              <div className="space-y-1.5">
                <Label className="text-xs text-slate-400">Admin Note (internal only)</Label>
                <Input
                  placeholder="Optional internal note..."
                  value={grantNote}
                  onChange={(e) => setGrantNote(e.target.value)}
                  className="bg-slate-800 border-slate-700 text-white placeholder-slate-500"
                />
              </div>

              {/* Expiry Date */}
              <div className="space-y-1.5">
                <Label className="text-xs text-slate-400">Expiry Date (optional)</Label>
                <Input
                  type="date"
                  value={grantExpiry}
                  onChange={(e) => setGrantExpiry(e.target.value)}
                  className="bg-slate-800 border-slate-700 text-white"
                />
                <p className="text-xs text-slate-600">Leave empty for credits that never expire</p>
              </div>

              {/* Preview */}
              {someSelected && grantAmount && parseInt(grantAmount) > 0 && (
                <div className="bg-slate-800 rounded-lg p-3 border border-slate-700">
                  <p className="text-xs text-slate-400 mb-1">Grant Preview</p>
                  <p className="text-sm text-white font-semibold">
                    {parseInt(grantAmount).toLocaleString()} credits × {selectedUserIds.size} users
                  </p>
                  <p className="text-xs text-yellow-400 font-bold">
                    = {(parseInt(grantAmount) * selectedUserIds.size).toLocaleString()} total credits
                  </p>
                </div>
              )}

              {/* Grant Button */}
              <Button
                onClick={handleGrant}
                disabled={isGranting || !someSelected || !grantAmount || !grantDescription.trim()}
                className="w-full bg-green-600 hover:bg-green-500 text-white font-semibold disabled:opacity-50"
              >
                {isGranting ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Granting...
                  </>
                ) : (
                  <>
                    <Gift className="w-4 h-4 mr-2" />
                    Grant Credits
                    {someSelected && ` to ${selectedUserIds.size} User${selectedUserIds.size !== 1 ? 's' : ''}`}
                  </>
                )}
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* C1: Notify Users Post-Grant Panel */}
      {showNotifyPanel && lastGrantResult && (
        <Card className="bg-slate-900 border-green-500/30 border-2">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2 text-green-400">
                <Megaphone className="w-4 h-4" />
                Notify Users About Their New Credits
              </CardTitle>
              <button
                onClick={() => setShowNotifyPanel(false)}
                className="text-slate-500 hover:text-white text-xs"
              >
                Dismiss
              </button>
            </div>
            <p className="text-xs text-slate-400 mt-1">
              ✅ Grant successful — {lastGrantResult.usersGranted} users received{' '}
              <span className="text-yellow-400 font-semibold">
                {lastGrantResult.totalCreditsGranted.toLocaleString()} credits
              </span>
              . Send them a notification now?
            </p>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs text-slate-400">Email Subject</Label>
              <Input
                value={notifyTitle}
                onChange={(e) => setNotifyTitle(e.target.value)}
                className="bg-slate-800 border-slate-700 text-white"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-slate-400">Message</Label>
              <textarea
                value={notifyMessage}
                onChange={(e) => setNotifyMessage(e.target.value)}
                rows={5}
                className="w-full bg-slate-800 border border-slate-700 rounded-md text-white text-sm p-3 resize-none focus:outline-none focus:ring-1 focus:ring-cyan-500"
              />
            </div>
            <div className="flex gap-3">
              <Button
                onClick={handleNotify}
                disabled={sendCampaignMutation.isPending}
                className="bg-green-600 hover:bg-green-500 text-white"
              >
                {sendCampaignMutation.isPending ? (
                  <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Sending...</>
                ) : (
                  <><Send className="w-4 h-4 mr-2" /> Send Notification</>
                )}
              </Button>
              <Button
                variant="outline"
                onClick={() => setShowNotifyPanel(false)}
                className="border-slate-700 text-slate-400"
              >
                Skip
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Grant History */}
      <Card className="bg-slate-900 border-slate-800">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <History className="w-4 h-4 text-slate-400" />
              Admin Grant History
              <span className="text-xs text-slate-500 font-normal">({history.length} records)</span>
            </CardTitle>
            <button
              onClick={() => setShowHistory(!showHistory)}
              className="text-slate-400 hover:text-white transition-colors"
            >
              {showHistory ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>
          </div>
        </CardHeader>
        {showHistory && (
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-slate-800">
                    <th className="text-left py-2 px-4 text-xs font-semibold text-slate-400">Date</th>
                    <th className="text-left py-2 px-4 text-xs font-semibold text-slate-400">User</th>
                    <th className="text-left py-2 px-4 text-xs font-semibold text-slate-400">Description</th>
                    <th className="text-center py-2 px-4 text-xs font-semibold text-yellow-400">Credits</th>
                    <th className="text-center py-2 px-4 text-xs font-semibold text-slate-400">Balance After</th>
                    <th className="text-left py-2 px-4 text-xs font-semibold text-slate-400">Admin Note</th>
                    <th className="text-center py-2 px-4 text-xs font-semibold text-slate-400">Expires</th>
                  </tr>
                </thead>
                <tbody>
                  {loadingHistory ? (
                    <tr>
                      <td colSpan={7} className="text-center py-8">
                        <Loader2 className="w-5 h-5 animate-spin text-cyan-400 mx-auto" />
                      </td>
                    </tr>
                  ) : history.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="text-center py-8 text-slate-500 text-sm">
                        No admin grants yet
                      </td>
                    </tr>
                  ) : (
                    history.map((record) => (
                      <tr key={record.id} className="border-b border-slate-800 hover:bg-slate-800/30">
                        <td className="py-2 px-4 text-xs text-slate-400 whitespace-nowrap">
                          {new Date(record.createdAt).toLocaleString('en-US', {
                            month: 'short',
                            day: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </td>
                        <td className="py-2 px-4">
                          <div className="text-white text-xs font-medium">{record.displayName || 'N/A'}</div>
                          <div className="text-slate-500 text-xs">{record.email}</div>
                        </td>
                        <td className="py-2 px-4 text-sm text-slate-300 max-w-xs truncate">
                          {record.description}
                        </td>
                        <td className="py-2 px-4 text-center">
                          <span className="text-green-400 font-bold text-sm">
                            +{record.amount.toLocaleString()}
                          </span>
                        </td>
                        <td className="py-2 px-4 text-center text-yellow-300 text-sm font-semibold">
                          {record.balanceAfter.toLocaleString()}
                        </td>
                        <td className="py-2 px-4 text-xs text-slate-500 max-w-xs truncate">
                          {record.adminNote || '—'}
                        </td>
                        <td className="py-2 px-4 text-center text-xs text-slate-500">
                          {record.expiresAt
                            ? new Date(record.expiresAt).toLocaleDateString()
                            : <span className="text-green-600">Never</span>}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        )}
      </Card>
    </div>
  );
}
