import { useState } from 'react';
import { trpc } from '@/lib/trpc';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  ShieldCheck,
  Wallet,
  TrendingDown,
  RotateCcw,
  Ban,
  Clock3,
  Activity,
  Cpu,
  Database,
  Gauge,
  Server,
  Timer,
  Zap,
  Lightbulb,
  Coins,
  TrendingUp,
  CreditCard,
  PlugZap,
  Bot,
  Mic,
  Phone,
  AudioLines,
} from 'lucide-react';
import {
  ResponsiveContainer,
  ComposedChart,
  Area,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RTooltip,
  ReferenceLine,
} from 'recharts';

// ── Types (mirror the two server services) ────────────────────────────────────

interface Detector<T> {
  available: boolean;
  rows: T[];
  count?: number;
}

interface BillingHealth {
  generatedAt: string;
  negativeBalances: Detector<{ contractorId: string; contractorName: string | null; contractorEmail: string | null; balanceCents: number }> & { count: number };
  reconciledActivity7d: Detector<{ eventType: string; count: number; totalCents: number }> & { count: number; totalCents: number };
  unchargedUsage24h: Detector<{ eventType: string; count: number; totalCostCents: number }> & { count: number; totalCostCents: number };
  reconcileFailures: Detector<{ eventType: string; count: number; totalCostCents: number }> & { count: number };
  retryQueueBacklog: Detector<{ status: string; count: number; totalCents: number }> & { count: number };
  notes: string[];
}

interface NeonDay {
  date: string;
  activeHours: number;
  computeHours: number;
  storageGb: number;
  dataTransferGb: number;
  alwaysOn: boolean;
}

interface InfraHealth {
  generatedAt: string;
  autosuspendMinutes: number;
  neon: {
    available: boolean;
    note?: string;
    days: NeonDay[];
    monthComputeHours: number;
    monthCostUsd: number;
    projectedMonthCostUsd: number;
    alwaysOnDays: number;
    costPerCuHour: number;
  };
  costPerUser: {
    available: boolean;
    note?: string;
    totalUsers: number;
    activeUsers30d: number;
    monthComputeHours: number;
    cuHoursPerActiveUser: number;
    severity: 'ok' | 'watch' | 'alarm' | 'unknown';
  };
  hotQueries: Detector<{ query: string; calls: number; totalExecMs: number; meanExecMs: number; rows: number; callsPerMin: number | null }> & { statsResetAt: string | null };
  liveActivity: {
    available: boolean;
    note?: string;
    totalConnections: number;
    activeConnections: number;
    idleInTransaction: number;
    longestActiveSeconds: number | null;
    longestActiveQuery: string | null;
  };
  workers: Detector<{
    workerName: string;
    lastRunAt: string | null;
    lastDurationMs: number | null;
    observedIntervalMs: number | null;
    configuredIntervalMs: number | null;
    totalRuns: number;
    lastError: string | null;
    keepsComputeAwake: boolean;
  }>;
  notes: string[];
}

type ProviderId = 'anthropic' | 'openai' | 'twilio' | 'elevenlabs';

interface ProviderSpend {
  provider: ProviderId;
  label: string;
  available: boolean;
  note?: string;
  monthSpendUsd: number | null;
  projectedMonthUsd: number | null;
  todaySpendUsd: number | null;
  planTier?: string | null;
  usagePct?: number | null;
  limitLabel?: string | null;
  resetAt?: string | null;
  accountStatus?: string | null;
  paymentIssue: boolean;
  keyIssue: boolean;
  configured: boolean;
  severity: 'ok' | 'watch' | 'alarm' | 'unknown';
  billedToUsersUsd: number;
  marginUsd: number | null;
  marginPct: number | null;
}

interface ServiceSpend {
  generatedAt: string;
  providers: ProviderSpend[];
  totals: { monthSpendUsd: number; billedToUsersUsd: number; marginUsd: number; marginPct: number | null };
  topConsumers: { contractorId: string; billedUsd: number; events: number }[];
  notes: string[];
}

// ── Helpers ────────────────────────────────────────────────────────────────────

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;
const usd = (n: number) => `$${n.toFixed(2)}`;
const pct = (f: number | null | undefined) => (f == null ? '—' : `${Math.round(f * 100)}%`);

const PROVIDER_ICON: Record<ProviderId, any> = {
  anthropic: Bot,
  openai: Mic,
  twilio: Phone,
  elevenlabs: AudioLines,
};
/** Where each provider's key/limit is managed — for the "fix it" hint. */
const PROVIDER_FIX: Record<ProviderId, { envVar: string; where: string }> = {
  anthropic: { envVar: 'ANTHROPIC_ADMIN_KEY', where: 'console.anthropic.com → Settings → Admin keys' },
  openai: { envVar: 'OPENAI_ADMIN_KEY', where: 'platform.openai.com → Settings → Organization → Admin keys' },
  twilio: { envVar: 'TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN', where: 'console.twilio.com (Account Info)' },
  elevenlabs: { envVar: 'ELEVENLABS_API_KEY', where: 'elevenlabs.io → Profile → API key' },
};

function fmtInterval(ms: number | null): string {
  if (ms == null) return '—';
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  if (s < 90) return `${Math.round(s)}s`;
  const m = s / 60;
  if (m < 90) return `${m.toFixed(1)}m`;
  return `${(m / 60).toFixed(1)}h`;
}

function ago(iso: string | null): string {
  if (!iso) return 'never';
  const diff = Date.now() - new Date(iso).getTime();
  const m = diff / 60000;
  if (m < 1) return 'just now';
  if (m < 90) return `${Math.round(m)}m ago`;
  return `${(m / 60).toFixed(1)}h ago`;
}

/** Map heartbeat worker name → source file, so the fix is one click away. */
const WORKER_SOURCE: Record<string, string> = {
  usageAggregation: 'backend/src/workers/usageAggregationWorker.ts',
  metaLeadSync: 'backend/src/services/metaLeadSyncWorker.ts',
  automationQueue: 'backend/src/services/automationQueueWorker.ts',
  followUp: 'backend/src/services/followUpWorker.ts',
  leadsignReminder: 'backend/src/workers/leadsignReminderWorker.ts',
  billingReconciliation: 'backend/src/workers/billingReconciliationWorker.ts',
  outbound: 'backend/src/services/outboundWorker.ts',
};

// ── Futuristic primitives ───────────────────────────────────────────────────────

type Tone = 'ok' | 'warn' | 'alarm' | 'muted';

const toneRing: Record<Tone, string> = {
  ok: 'border-emerald-500/30 shadow-[0_0_24px_-12px] shadow-emerald-500/40',
  warn: 'border-amber-500/40 shadow-[0_0_24px_-10px] shadow-amber-500/50',
  alarm: 'border-rose-500/50 shadow-[0_0_28px_-8px] shadow-rose-500/60',
  muted: 'border-slate-700/60',
};
const toneText: Record<Tone, string> = {
  ok: 'text-emerald-400',
  warn: 'text-amber-400',
  alarm: 'text-rose-400',
  muted: 'text-slate-400',
};

function StatTile({
  icon: Icon,
  label,
  value,
  sub,
  tone,
}: {
  icon: any;
  label: string;
  value: string;
  sub: string;
  tone: Tone;
}) {
  return (
    <div
      className={`relative overflow-hidden rounded-xl border bg-gradient-to-b from-slate-900/80 to-slate-950/90 p-4 ${toneRing[tone]}`}
    >
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-current to-transparent opacity-30" />
      <div className="flex items-center justify-between">
        <span className="text-[11px] uppercase tracking-widest text-slate-400">{label}</span>
        <Icon className={`h-4 w-4 ${toneText[tone]}`} />
      </div>
      <div className={`mt-2 font-mono text-2xl font-bold ${toneText[tone]}`}>{value}</div>
      <div className="mt-0.5 text-[11px] text-slate-500">{sub}</div>
    </div>
  );
}

function GlowCard({
  title,
  icon: Icon,
  tone = 'muted',
  children,
}: {
  title: string;
  icon: any;
  tone?: Tone;
  children: React.ReactNode;
}) {
  return (
    <Card className={`bg-slate-950/60 backdrop-blur ${toneRing[tone]}`}>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm font-semibold tracking-wide text-slate-200">
          <Icon className={`h-4 w-4 ${toneText[tone]}`} />
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

/** The "correction output" block — what to do about a detected problem. */
function ActionHint({ children, tone = 'warn' }: { children: React.ReactNode; tone?: Tone }) {
  return (
    <div
      className={`mt-3 flex gap-2 rounded-lg border px-3 py-2 text-xs ${
        tone === 'alarm' ? 'border-rose-500/30 bg-rose-500/5' : 'border-amber-500/30 bg-amber-500/5'
      }`}
    >
      <Lightbulb className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${toneText[tone]}`} />
      <div className="space-y-1 text-slate-300">{children}</div>
    </div>
  );
}

function Pill({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  const cls: Record<Tone, string> = {
    ok: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
    warn: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
    alarm: 'bg-rose-500/15 text-rose-400 border-rose-500/30',
    muted: 'bg-slate-700/30 text-slate-400 border-slate-600/40',
  };
  return <Badge className={`border ${cls[tone]}`}>{children}</Badge>;
}

// ── Page ────────────────────────────────────────────────────────────────────────

export default function LeadPrimeSystemHealth() {
  const [tab, setTab] = useState('infra');

  const billingQ = trpc.leadprime.billingHealth.useQuery(undefined, { refetchInterval: 60000 });
  const infraQ = trpc.leadprime.infraHealth.useQuery(undefined, { refetchInterval: 60000 });
  const spendQ = trpc.leadprime.serviceSpend.useQuery(undefined, { refetchInterval: 120000 });

  const billing = billingQ.data?.data as BillingHealth | null | undefined;
  const infra = infraQ.data?.data as InfraHealth | null | undefined;
  const spend = spendQ.data?.data as ServiceSpend | null | undefined;
  const billingErr = billingQ.data?.success === false ? billingQ.data?.error : null;
  const infraErr = infraQ.data?.success === false ? infraQ.data?.error : null;
  const spendErr = spendQ.data?.success === false ? spendQ.data?.error : null;

  // Billing rollups
  const negCount = billing?.negativeBalances.count ?? 0;
  const unchargedCount = billing?.unchargedUsage24h.count ?? 0;
  const unchargedCents = billing?.unchargedUsage24h.totalCostCents ?? 0;
  const failuresCount = billing?.reconcileFailures.count ?? 0;
  const retryCount = billing?.retryQueueBacklog.count ?? 0;
  const billingClean = !!billing && negCount === 0 && unchargedCount === 0 && failuresCount === 0 && retryCount === 0;

  // Infra rollups
  const awakeWorkers = infra?.workers.rows.filter((w) => w.keepsComputeAwake) ?? [];
  const errorWorkers = infra?.workers.rows.filter((w) => w.lastError) ?? [];
  const cpu = infra?.costPerUser;
  const neon = infra?.neon;
  const hotTop = infra?.hotQueries.rows[0];
  const hotHammer = (infra?.hotQueries.rows ?? []).filter((q) => (q.callsPerMin ?? 0) >= 30);

  const cpuTone: Tone =
    cpu?.severity === 'alarm' ? 'alarm' : cpu?.severity === 'watch' ? 'warn' : cpu?.severity === 'ok' ? 'ok' : 'muted';
  const neonTone: Tone = !neon?.available ? 'muted' : neon.alwaysOnDays > 0 ? 'alarm' : neon.projectedMonthCostUsd > 50 ? 'warn' : 'ok';
  const workerTone: Tone = !infra?.workers.available ? 'muted' : awakeWorkers.length > 0 ? 'alarm' : errorWorkers.length > 0 ? 'warn' : 'ok';

  // Service-spend rollups
  const spendIssues = (spend?.providers ?? []).filter((p) => p.paymentIssue || p.keyIssue);
  const spendNearLimit = (spend?.providers ?? []).filter((p) => (p.usagePct ?? 0) >= 0.9);
  const marginUsd = spend?.totals.marginUsd ?? 0;
  const marginTone: Tone = !spend ? 'muted' : spendIssues.length > 0 ? 'alarm' : marginUsd < 0 ? 'warn' : 'ok';

  const sevTone = (s: ProviderSpend['severity']): Tone =>
    s === 'alarm' ? 'alarm' : s === 'watch' ? 'warn' : s === 'ok' ? 'ok' : 'muted';

  const refreshAll = () => {
    billingQ.refetch();
    infraQ.refetch();
    spendQ.refetch();
  };
  const loading = billingQ.isFetching || infraQ.isFetching || spendQ.isFetching;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-slate-100">
            <ShieldCheck className="h-6 w-6 text-cyan-400" />
            System Health
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            Read-only mission control for LeadPrime — billing leaks, Neon compute cost, and
            background-worker cadence. Surfaces problems and the fix. Never moves money, never mutates data.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={refreshAll} disabled={loading}>
          <RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      {(billingErr || infraErr || spendErr) && (
        <Card className="border-rose-500/40">
          <CardContent className="flex items-center gap-2 pt-6 text-rose-400">
            <AlertTriangle className="h-4 w-4" />
            {billingErr && <span>Billing: {billingErr}. </span>}
            {infraErr && <span>Infra: {infraErr}. </span>}
            {spendErr && <span>Spend: {spendErr}.</span>}
          </CardContent>
        </Card>
      )}

      {/* Command deck — cross-domain KPI tiles */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-7">
        <StatTile
          icon={neonTone === 'alarm' ? Zap : Cpu}
          label="Neon / mo (proj.)"
          value={neon?.available ? usd(neon.projectedMonthCostUsd) : '—'}
          sub={neon?.available ? `${neon.monthComputeHours.toFixed(1)} CU-h MTD` : 'API key off'}
          tone={neonTone}
        />
        <StatTile
          icon={Gauge}
          label="Cost / user"
          value={cpu?.available ? `${cpu.cuHoursPerActiveUser} CU-h` : '—'}
          sub={cpu?.available ? `${cpu.activeUsers30d} active / ${cpu.totalUsers} total` : 'needs Neon API'}
          tone={cpuTone}
        />
        <StatTile
          icon={Timer}
          label="Pollers 24/7"
          value={infra?.workers.available ? String(awakeWorkers.length) : '—'}
          sub={`keep compute awake (<${infra?.autosuspendMinutes ?? 5}m)`}
          tone={workerTone}
        />
        <StatTile
          icon={Wallet}
          label="Billing leaks"
          value={billing ? String(negCount + unchargedCount + failuresCount) : '—'}
          sub="neg. bal + unbilled + failed"
          tone={billing ? (negCount + unchargedCount + failuresCount > 0 ? 'alarm' : 'ok') : 'muted'}
        />
        <StatTile
          icon={Activity}
          label="Live conns"
          value={infra?.liveActivity.available ? String(infra.liveActivity.totalConnections) : '—'}
          sub={`${infra?.liveActivity.activeConnections ?? 0} active`}
          tone={(infra?.liveActivity.idleInTransaction ?? 0) > 0 ? 'warn' : 'ok'}
        />
        <StatTile
          icon={Database}
          label="Hot query"
          value={hotTop ? `${hotTop.callsPerMin ?? '?'}/min` : '—'}
          sub={hotHammer.length > 0 ? `${hotHammer.length} hammering` : 'top by calls'}
          tone={hotHammer.length > 0 ? 'warn' : 'ok'}
        />
        <StatTile
          icon={spendIssues.length > 0 ? CreditCard : Coins}
          label="Service margin"
          value={spend ? usd(marginUsd) : '—'}
          sub={
            spendIssues.length > 0
              ? `${spendIssues.length} provider issue${spendIssues.length > 1 ? 's' : ''}`
              : spend
                ? `${usd(spend.totals.billedToUsersUsd)} billed − ${usd(spend.totals.monthSpendUsd)} cost`
                : 'API keys off'
          }
          tone={marginTone}
        />
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="bg-slate-900/60">
          <TabsTrigger value="infra">Infra &amp; Cost</TabsTrigger>
          <TabsTrigger value="services">Services &amp; Spend</TabsTrigger>
          <TabsTrigger value="workers">Workers &amp; Crons</TabsTrigger>
          <TabsTrigger value="billing">Billing &amp; Wallet</TabsTrigger>
        </TabsList>

        {/* ───────────────────────── INFRA & COST ───────────────────────── */}
        <TabsContent value="infra" className="space-y-4 pt-4">
          <GlowCard title="Neon Compute — daily active vs CU hours (30d)" icon={Cpu} tone={neonTone}>
            {!neon?.available ? (
              <div className="text-sm text-slate-400">
                <p>Compute metrics disabled. {neon?.note}</p>
                <ActionHint tone="warn">
                  <p className="font-semibold text-slate-200">To enable (your part):</p>
                  <p>
                    Create a <span className="font-mono">read-only</span> Neon API key (Neon console → Account
                    settings → API keys) and set <span className="font-mono">NEON_API_KEY</span> +{' '}
                    <span className="font-mono">NEON_PROJECT_ID</span> on the kay-chyrris service. Optional:{' '}
                    <span className="font-mono">NEON_ORG_ID</span>, <span className="font-mono">NEON_COST_PER_CU_HOUR</span>.
                  </p>
                </ActionHint>
              </div>
            ) : (
              <>
                <div className="mb-3 flex flex-wrap gap-4 text-xs text-slate-400">
                  <span>MTD compute: <b className="font-mono text-slate-200">{neon.monthComputeHours.toFixed(2)} CU-h</b></span>
                  <span>MTD cost: <b className="font-mono text-slate-200">{usd(neon.monthCostUsd)}</b></span>
                  <span>Projected: <b className={`font-mono ${toneText[neonTone]}`}>{usd(neon.projectedMonthCostUsd)}</b></span>
                  <span>Always-on days: <b className={`font-mono ${neon.alwaysOnDays ? 'text-rose-400' : 'text-emerald-400'}`}>{neon.alwaysOnDays}</b></span>
                </div>
                <ResponsiveContainer width="100%" height={220}>
                  <ComposedChart data={neon.days} margin={{ top: 6, right: 8, left: -16, bottom: 0 }}>
                    <defs>
                      <linearGradient id="cuFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#22d3ee" stopOpacity={0.5} />
                        <stop offset="100%" stopColor="#22d3ee" stopOpacity={0.02} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                    <XAxis dataKey="date" tickFormatter={(d) => String(d).slice(5)} tick={{ fontSize: 10, fill: '#64748b' }} />
                    <YAxis tick={{ fontSize: 10, fill: '#64748b' }} />
                    <RTooltip
                      contentStyle={{ background: '#020617', border: '1px solid #1e293b', borderRadius: 8, fontSize: 12 }}
                      labelStyle={{ color: '#94a3b8' }}
                    />
                    <ReferenceLine y={24} stroke="#f43f5e" strokeDasharray="4 4" label={{ value: '24h (never suspends)', fill: '#f43f5e', fontSize: 9, position: 'insideTopRight' }} />
                    <Area type="monotone" dataKey="computeHours" name="CU-hours" stroke="#22d3ee" fill="url(#cuFill)" strokeWidth={2} />
                    <Line type="monotone" dataKey="activeHours" name="active h" stroke="#fbbf24" strokeWidth={1.5} dot={false} />
                  </ComposedChart>
                </ResponsiveContainer>
                {neon.alwaysOnDays > 0 && (
                  <ActionHint tone="alarm">
                    <p className="font-semibold text-slate-200">Compute basically never suspended on {neon.alwaysOnDays} day(s).</p>
                    <p>
                      A background poller is querying faster than Neon's {infra?.autosuspendMinutes}-min auto-suspend.
                      Open the <b>Workers &amp; Crons</b> tab → any worker flagged “keeps compute awake”. Raise its
                      interval above {infra?.autosuspendMinutes} min (or raise the Neon auto-suspend setting).
                    </p>
                  </ActionHint>
                )}
              </>
            )}
          </GlowCard>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <GlowCard title="Cost per active user" icon={Gauge} tone={cpuTone}>
              {!cpu?.available ? (
                <p className="text-sm text-slate-400">{cpu?.note ?? 'Unavailable — needs Neon compute data.'}</p>
              ) : (
                <>
                  <div className="flex items-end gap-3">
                    <span className={`font-mono text-4xl font-bold ${toneText[cpuTone]}`}>{cpu.cuHoursPerActiveUser}</span>
                    <span className="pb-1 text-sm text-slate-400">CU-h / active user / mo</span>
                  </div>
                  <div className="mt-2 grid grid-cols-3 gap-2 text-center text-xs">
                    <div className="rounded-lg border border-slate-800 bg-slate-900/50 py-2">
                      <div className="font-mono text-lg text-slate-200">{cpu.activeUsers30d}</div>
                      <div className="text-slate-500">active 30d</div>
                    </div>
                    <div className="rounded-lg border border-slate-800 bg-slate-900/50 py-2">
                      <div className="font-mono text-lg text-slate-200">{cpu.totalUsers}</div>
                      <div className="text-slate-500">total users</div>
                    </div>
                    <div className="rounded-lg border border-slate-800 bg-slate-900/50 py-2">
                      <div className="font-mono text-lg text-slate-200">{cpu.monthComputeHours.toFixed(1)}</div>
                      <div className="text-slate-500">CU-h MTD</div>
                    </div>
                  </div>
                  <p className="mt-3 text-xs text-slate-500">
                    Scales with users by design: alarms only when per-user compute is absurd (e.g. a 24/7 poller with
                    a handful of users), normal at scale.
                  </p>
                  {cpuTone !== 'ok' && (
                    <ActionHint tone={cpuTone === 'alarm' ? 'alarm' : 'warn'}>
                      <p>Per-user compute is high for the active-user count. Check the Workers tab for a runaway poller and the Neon chart for always-on days.</p>
                    </ActionHint>
                  )}
                </>
              )}
            </GlowCard>

            <GlowCard title="Live database activity" icon={Activity} tone={(infra?.liveActivity.idleInTransaction ?? 0) > 0 ? 'warn' : 'ok'}>
              {!infra?.liveActivity.available ? (
                <p className="text-sm text-slate-400">{infra?.liveActivity.note ?? 'Unavailable.'}</p>
              ) : (
                <div className="space-y-2 text-sm">
                  <Row label="Connections" value={String(infra.liveActivity.totalConnections)} />
                  <Row label="Active" value={String(infra.liveActivity.activeConnections)} />
                  <Row label="Idle in transaction" value={String(infra.liveActivity.idleInTransaction)} tone={infra.liveActivity.idleInTransaction > 0 ? 'warn' : 'ok'} />
                  <Row label="Longest active query" value={infra.liveActivity.longestActiveSeconds != null ? `${infra.liveActivity.longestActiveSeconds}s` : '—'} tone={(infra.liveActivity.longestActiveSeconds ?? 0) > 30 ? 'warn' : 'muted'} />
                  {infra.liveActivity.longestActiveQuery && (
                    <pre className="mt-2 max-h-24 overflow-auto rounded-lg border border-slate-800 bg-slate-900/60 p-2 font-mono text-[11px] text-slate-400">
                      {infra.liveActivity.longestActiveQuery}
                    </pre>
                  )}
                  {infra.liveActivity.idleInTransaction > 0 && (
                    <ActionHint tone="warn">
                      <p>Idle-in-transaction connections hold locks and keep compute busy. Find the code path that opens a transaction and never commits/rolls back.</p>
                    </ActionHint>
                  )}
                </div>
              )}
            </GlowCard>
          </div>

          <GlowCard title="Hot queries (pg_stat_statements)" icon={Database} tone={hotHammer.length > 0 ? 'warn' : 'ok'}>
            {!infra?.hotQueries.available ? (
              <div className="text-sm text-slate-400">
                <p>pg_stat_statements not enabled on this database.</p>
                <ActionHint tone="warn">
                  <p>Optional: enable it in Neon (<span className="font-mono">CREATE EXTENSION pg_stat_statements;</span> + add to <span className="font-mono">shared_preload_libraries</span>) to see which query is hammering the DB.</p>
                </ActionHint>
              </div>
            ) : infra.hotQueries.rows.length === 0 ? (
              <p className="text-sm text-emerald-400">No statements recorded.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-800 text-left text-xs uppercase tracking-wider text-slate-500">
                      <th className="py-2 pr-4">Query</th>
                      <th className="py-2 pr-4 text-right">Calls</th>
                      <th className="py-2 pr-4 text-right">Calls/min</th>
                      <th className="py-2 pr-4 text-right">Mean ms</th>
                    </tr>
                  </thead>
                  <tbody>
                    {infra.hotQueries.rows.map((q, i) => {
                      const hammer = (q.callsPerMin ?? 0) >= 30;
                      return (
                        <tr key={i} className="border-b border-slate-800/50">
                          <td className="max-w-[420px] truncate py-2 pr-4 font-mono text-xs text-slate-300" title={q.query}>{q.query}</td>
                          <td className="py-2 pr-4 text-right font-mono text-slate-400">{q.calls.toLocaleString()}</td>
                          <td className={`py-2 pr-4 text-right font-mono ${hammer ? 'text-amber-400' : 'text-slate-400'}`}>{q.callsPerMin ?? '—'}</td>
                          <td className="py-2 pr-4 text-right font-mono text-slate-400">{q.meanExecMs}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {hotHammer.length > 0 && (
                  <ActionHint tone="warn">
                    <p>{hotHammer.length} query/queries running ≥30×/min — likely a tight poll loop. Trace the top one and back off its frequency.</p>
                  </ActionHint>
                )}
              </div>
            )}
          </GlowCard>
        </TabsContent>

        {/* ───────────────────────── SERVICES & SPEND ───────────────────────── */}
        <TabsContent value="services" className="space-y-4 pt-4">
          {/* Margin summary strip */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatTile icon={CreditCard} label="Provider cost / mo" value={spend ? usd(spend.totals.monthSpendUsd) : '—'} sub="actual, reported by APIs" tone="muted" />
            <StatTile icon={TrendingUp} label="Billed to users" value={spend ? usd(spend.totals.billedToUsersUsd) : '—'} sub="usage_events MTD" tone="ok" />
            <StatTile icon={Coins} label="Margin" value={spend ? usd(marginUsd) : '—'} sub={spend?.totals.marginPct != null ? `${pct(spend.totals.marginPct)} over cost` : 'revenue − cost'} tone={marginTone} />
            <StatTile icon={PlugZap} label="Provider alerts" value={spend ? String(spendIssues.length + spendNearLimit.length) : '—'} sub="payment / near-limit" tone={spendIssues.length > 0 ? 'alarm' : spendNearLimit.length > 0 ? 'warn' : 'ok'} />
          </div>

          {spend && marginUsd < 0 && spendIssues.length === 0 && (
            <ActionHint tone="warn">
              <p className="font-semibold text-slate-200">You're spending more on providers than you bill users this month ({usd(-marginUsd)} in the red).</p>
              <p>Either pricing/markup is too low for the active usage mix, or internal/admin usage isn't billed. Check the per-provider margins below and the top consumers.</p>
            </ActionHint>
          )}

          {/* Per-provider cards */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {(spend?.providers ?? []).map((p) => {
              const Icon = PROVIDER_ICON[p.provider];
              const tone = sevTone(p.severity);
              const fix = PROVIDER_FIX[p.provider];
              return (
                <GlowCard key={p.provider} title={p.label} icon={Icon} tone={tone}>
                  {!p.available ? (
                    p.configured ? (
                      // Key IS set but the API rejected us → real alert, not "off".
                      <div className="text-sm text-slate-400">
                        <p className="text-rose-300">{p.note}</p>
                        <ActionHint tone="alarm">
                          {p.keyIssue ? (
                            <>
                              <p className="font-semibold text-slate-200">API key rejected (expired, revoked, or wrong scope).</p>
                              <p>Rotate <span className="font-mono">{fix.envVar}</span> at {fix.where} and update it on the kay-chyrris service. For Anthropic/OpenAI make sure it's an <b>Admin/Organization</b> key, not a normal API key.</p>
                            </>
                          ) : p.paymentIssue ? (
                            <>
                              <p className="font-semibold text-slate-200">Payment required — the account is likely out of credit.</p>
                              <p>Top up / fix billing at {fix.where.split(' →')[0]} before this provider starts failing live calls.</p>
                            </>
                          ) : (
                            <p>This provider's API is unreachable right now. If it persists, check the key and the provider's status page.</p>
                          )}
                        </ActionHint>
                      </div>
                    ) : (
                      <div className="text-sm text-slate-400">
                        <p>{p.note}</p>
                        <ActionHint tone="warn">
                          <p className="font-semibold text-slate-200">To enable (your part):</p>
                          <p>Set <span className="font-mono">{fix.envVar}</span> on the kay-chyrris service. Get it from {fix.where}.</p>
                        </ActionHint>
                      </div>
                    )
                  ) : (
                    <div className="space-y-2 text-sm">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          {p.planTier && <Pill tone="muted">{p.planTier}</Pill>}
                          {p.accountStatus && <Pill tone={p.paymentIssue ? 'alarm' : 'ok'}>{p.accountStatus}</Pill>}
                        </div>
                        {p.monthSpendUsd != null && (
                          <span className="font-mono text-2xl font-bold text-slate-100">{usd(p.monthSpendUsd)}<span className="text-xs font-normal text-slate-500"> /mo</span></span>
                        )}
                      </div>

                      {/* Plan / credit usage bar */}
                      {p.usagePct != null && (
                        <div>
                          <div className="flex justify-between text-xs text-slate-400">
                            <span>{p.limitLabel ?? 'plan usage'}</span>
                            <span className={`font-mono ${toneText[tone]}`}>{pct(p.usagePct)}</span>
                          </div>
                          <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-800">
                            <div
                              className={`h-full rounded-full ${tone === 'alarm' ? 'bg-rose-500' : tone === 'warn' ? 'bg-amber-500' : 'bg-emerald-500'}`}
                              style={{ width: `${Math.min(100, Math.round((p.usagePct ?? 0) * 100))}%` }}
                            />
                          </div>
                          {p.resetAt && <p className="mt-1 text-[11px] text-slate-500">resets {new Date(p.resetAt).toLocaleDateString()}</p>}
                        </div>
                      )}

                      <div className="grid grid-cols-3 gap-2 pt-1 text-center text-xs">
                        <div className="rounded-lg border border-slate-800 bg-slate-900/50 py-2">
                          <div className="font-mono text-slate-200">{p.todaySpendUsd != null ? usd(p.todaySpendUsd) : '—'}</div>
                          <div className="text-slate-500">today</div>
                        </div>
                        <div className="rounded-lg border border-slate-800 bg-slate-900/50 py-2">
                          <div className={`font-mono ${toneText[tone]}`}>{p.projectedMonthUsd != null ? usd(p.projectedMonthUsd) : '—'}</div>
                          <div className="text-slate-500">projected</div>
                        </div>
                        <div className="rounded-lg border border-slate-800 bg-slate-900/50 py-2">
                          <div className={`font-mono ${p.marginUsd == null ? 'text-slate-400' : p.marginUsd < 0 ? 'text-rose-400' : 'text-emerald-400'}`}>{p.marginUsd != null ? usd(p.marginUsd) : '—'}</div>
                          <div className="text-slate-500">margin</div>
                        </div>
                      </div>
                      <p className="text-[11px] text-slate-500">Billed to users: <span className="font-mono text-slate-400">{usd(p.billedToUsersUsd)}</span>{p.marginPct != null && <> · margin {pct(p.marginPct)}</>}</p>

                      {p.paymentIssue && (
                        <ActionHint tone="alarm">
                          <p className="font-semibold text-slate-200">Account status “{p.accountStatus}” — likely payment / billing problem.</p>
                          <p>This provider may be failing right now. Check the billing page at {fix.where.split(' →')[0]} and resolve the charge.</p>
                        </ActionHint>
                      )}
                      {!p.paymentIssue && (p.usagePct ?? 0) >= 0.9 && (
                        <ActionHint tone="alarm">
                          <p className="font-semibold text-slate-200">{pct(p.usagePct)} of the plan allowance used.</p>
                          <p>Upgrade the plan or it will throttle/fail before the reset{p.resetAt ? ` on ${new Date(p.resetAt).toLocaleDateString()}` : ''}.</p>
                        </ActionHint>
                      )}
                      {!p.paymentIssue && p.marginUsd != null && p.marginUsd < 0 && (
                        <ActionHint tone="warn">
                          <p>Costs more ({usd(p.monthSpendUsd ?? 0)}) than it bills ({usd(p.billedToUsersUsd)}). This service isn't paying for itself — review markup or internal usage.</p>
                        </ActionHint>
                      )}
                    </div>
                  )}
                </GlowCard>
              );
            })}
          </div>

          {/* Top consumers */}
          <GlowCard title="Top consumers this month (billed)" icon={TrendingUp} tone="muted">
            {!spend || spend.topConsumers.length === 0 ? (
              <p className="text-sm text-slate-400">No billable usage recorded this month.</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-800 text-left text-xs uppercase tracking-wider text-slate-500">
                    <th className="py-2 pr-4">Contractor</th>
                    <th className="py-2 pr-4 text-right">Events</th>
                    <th className="py-2 pr-4 text-right">Billed</th>
                  </tr>
                </thead>
                <tbody>
                  {spend.topConsumers.map((c) => (
                    <tr key={c.contractorId} className="border-b border-slate-800/50">
                      <td className="py-2 pr-4 font-mono text-xs text-slate-300">{c.contractorId}</td>
                      <td className="py-2 pr-4 text-right text-slate-400">{c.events}</td>
                      <td className="py-2 pr-4 text-right font-mono text-emerald-400">{usd(c.billedUsd)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <p className="mt-3 text-[11px] text-slate-500">Helps separate “my usage” from “users’ usage”: a single dominant contractor (or your own admin account) at the top means most spend is internal, not customer-driven.</p>
          </GlowCard>
        </TabsContent>

        {/* ───────────────────────── WORKERS & CRONS ───────────────────────── */}
        <TabsContent value="workers" className="space-y-4 pt-4">
          <GlowCard title={`Background workers — cadence vs ${infra?.autosuspendMinutes ?? 5}-min auto-suspend`} icon={Server} tone={workerTone}>
            {!infra?.workers.available ? (
              <div className="text-sm text-slate-400">
                <p>The <span className="font-mono">worker_runs</span> heartbeat table is not present yet.</p>
                <ActionHint tone="warn">
                  <p>Deploy LeadPrime PR #16 (worker heartbeat). Once live, every recurring worker reports its real cadence here and this panel flags any that keep Neon compute awake.</p>
                </ActionHint>
              </div>
            ) : infra.workers.rows.length === 0 ? (
              <p className="text-sm text-slate-400">No worker heartbeats recorded yet — waiting for the next tick.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-800 text-left text-xs uppercase tracking-wider text-slate-500">
                      <th className="py-2 pr-4">Worker</th>
                      <th className="py-2 pr-4 text-right">Observed</th>
                      <th className="py-2 pr-4 text-right">Configured</th>
                      <th className="py-2 pr-4 text-right">Last run</th>
                      <th className="py-2 pr-4 text-right">Duration</th>
                      <th className="py-2 pr-4 text-right">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {infra.workers.rows.map((w) => (
                      <tr key={w.workerName} className="border-b border-slate-800/50">
                        <td className="py-2 pr-4 font-mono text-slate-200">{w.workerName}</td>
                        <td className={`py-2 pr-4 text-right font-mono ${w.keepsComputeAwake ? 'text-rose-400' : 'text-slate-400'}`}>{fmtInterval(w.observedIntervalMs)}</td>
                        <td className="py-2 pr-4 text-right font-mono text-slate-500">{fmtInterval(w.configuredIntervalMs)}</td>
                        <td className="py-2 pr-4 text-right text-slate-400">{ago(w.lastRunAt)}</td>
                        <td className="py-2 pr-4 text-right font-mono text-slate-500">{w.lastDurationMs != null ? fmtInterval(w.lastDurationMs) : '—'}</td>
                        <td className="py-2 pr-4 text-right">
                          {w.lastError ? <Pill tone="warn">error</Pill> : w.keepsComputeAwake ? <Pill tone="alarm">24/7</Pill> : <Pill tone="ok">ok</Pill>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                {awakeWorkers.length > 0 && (
                  <ActionHint tone="alarm">
                    <p className="font-semibold text-slate-200">These workers keep Neon compute online 24/7:</p>
                    <ul className="list-disc space-y-0.5 pl-4">
                      {awakeWorkers.map((w) => (
                        <li key={w.workerName}>
                          <span className="font-mono text-rose-300">{w.workerName}</span> — polls every {fmtInterval(w.observedIntervalMs ?? w.configuredIntervalMs)}.
                          {WORKER_SOURCE[w.workerName] && <> Raise its interval in <span className="font-mono text-slate-400">{WORKER_SOURCE[w.workerName]}</span> above {infra?.autosuspendMinutes} min.</>}
                        </li>
                      ))}
                    </ul>
                  </ActionHint>
                )}
                {errorWorkers.length > 0 && (
                  <ActionHint tone="warn">
                    <p className="font-semibold text-slate-200">Workers reporting errors on their last run:</p>
                    <ul className="list-disc space-y-0.5 pl-4">
                      {errorWorkers.map((w) => (
                        <li key={w.workerName}>
                          <span className="font-mono">{w.workerName}</span>: <span className="text-slate-400">{w.lastError}</span>
                        </li>
                      ))}
                    </ul>
                  </ActionHint>
                )}
              </div>
            )}
          </GlowCard>
        </TabsContent>

        {/* ───────────────────────── BILLING & WALLET ───────────────────────── */}
        <TabsContent value="billing" className="space-y-4 pt-4">
          {billing && (
            <Card className={billingClean ? 'border-emerald-500/40' : 'border-amber-500/40'}>
              <CardContent className="flex items-center gap-3 pt-6">
                {billingClean ? <CheckCircle2 className="h-6 w-6 text-emerald-400" /> : <AlertTriangle className="h-6 w-6 text-amber-400" />}
                <div>
                  <p className="font-semibold text-slate-100">{billingClean ? 'All billing checks passing' : 'Billing anomalies detected'}</p>
                  <p className="text-xs text-slate-500">Generated {new Date(billing.generatedAt).toLocaleString()}</p>
                </div>
              </CardContent>
            </Card>
          )}

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatTile icon={Wallet} label="Negative bal." value={String(negCount)} sub="wallets below $0" tone={negCount ? 'alarm' : 'ok'} />
            <StatTile icon={TrendingDown} label="Uncharged 24h" value={money(unchargedCents)} sub={`${unchargedCount} events`} tone={unchargedCount ? 'warn' : 'ok'} />
            <StatTile icon={Ban} label="Reconcile fails" value={String(failuresCount)} sub="insufficient funds" tone={failuresCount ? 'warn' : 'ok'} />
            <StatTile icon={Clock3} label="Retry backlog" value={String(retryCount)} sub="pending Layer-1" tone={retryCount ? 'warn' : 'ok'} />
          </div>

          <GlowCard title="Negative wallet balances" icon={Wallet} tone={negCount ? 'alarm' : 'ok'}>
            {!billing?.negativeBalances.available ? (
              <p className="text-sm text-slate-400">Detector unavailable.</p>
            ) : billing.negativeBalances.rows.length === 0 ? (
              <p className="flex items-center gap-2 text-sm text-emerald-400"><CheckCircle2 className="h-4 w-4" /> No negative balances. Atomic deduction holding.</p>
            ) : (
              <>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-800 text-left text-xs uppercase tracking-wider text-slate-500">
                      <th className="py-2 pr-4">Contractor</th>
                      <th className="py-2 pr-4">Email</th>
                      <th className="py-2 pr-4 text-right">Balance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {billing.negativeBalances.rows.map((r) => (
                      <tr key={r.contractorId} className="border-b border-slate-800/50">
                        <td className="py-2 pr-4 text-slate-200">{r.contractorName ?? r.contractorId}</td>
                        <td className="py-2 pr-4 text-slate-500">{r.contractorEmail ?? '—'}</td>
                        <td className="py-2 pr-4 text-right font-mono text-rose-400">{money(r.balanceCents)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <ActionHint tone="alarm">
                  <p>Negative balances should be impossible with atomic deduction. Investigate the contractor's recent charges; this usually means a deduction ran without a balance guard.</p>
                </ActionHint>
              </>
            )}
          </GlowCard>

          <GlowCard title="Uncharged usage (last 24h)" icon={TrendingDown} tone={unchargedCount ? 'warn' : 'ok'}>
            {!billing?.unchargedUsage24h.available ? (
              <p className="text-sm text-slate-400">Detector unavailable.</p>
            ) : billing.unchargedUsage24h.rows.length === 0 ? (
              <p className="flex items-center gap-2 text-sm text-emerald-400"><CheckCircle2 className="h-4 w-4" /> Every billable usage event has a matching charge.</p>
            ) : (
              <>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-800 text-left text-xs uppercase tracking-wider text-slate-500">
                      <th className="py-2 pr-4">Event type</th>
                      <th className="py-2 pr-4 text-right">Events</th>
                      <th className="py-2 pr-4 text-right">Unbilled</th>
                    </tr>
                  </thead>
                  <tbody>
                    {billing.unchargedUsage24h.rows.map((r) => (
                      <tr key={r.eventType} className="border-b border-slate-800/50">
                        <td className="py-2 pr-4 font-mono text-slate-300">{r.eventType}</td>
                        <td className="py-2 pr-4 text-right text-slate-400">{r.count}</td>
                        <td className="py-2 pr-4 text-right font-mono text-amber-400">{money(r.totalCostCents)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <ActionHint tone="warn">
                  <p>Layer 2 (reconciliation worker) should charge these within ~60 min. If they persist, check that billingReconciliationWorker is running (Workers tab) and that the amount-match join still holds.</p>
                </ActionHint>
              </>
            )}
            <p className="mt-3 text-xs text-slate-500">Matched by amount (±2¢, ±5min), type-agnostic — mirrors the reconciliation worker. Events &lt;20min old are excluded.</p>
          </GlowCard>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <GlowCard title="Reconciled charges (7d)" icon={RotateCcw} tone="muted">
              {!billing?.reconciledActivity7d.available ? (
                <p className="text-sm text-slate-400">Unavailable.</p>
              ) : billing.reconciledActivity7d.rows.length === 0 ? (
                <p className="text-sm text-slate-400">No retroactive charges. Layer 1 is clean.</p>
              ) : (
                <ul className="space-y-1 text-sm">
                  {billing.reconciledActivity7d.rows.map((r) => (
                    <li key={r.eventType} className="flex justify-between">
                      <span className="font-mono text-slate-400">{r.eventType}</span>
                      <span className="text-slate-300">{r.count} · <span className="font-mono">{money(r.totalCents)}</span></span>
                    </li>
                  ))}
                </ul>
              )}
            </GlowCard>
            <GlowCard title="Reconcile failures (30d)" icon={Ban} tone={failuresCount ? 'warn' : 'ok'}>
              {!billing?.reconcileFailures.available ? (
                <p className="text-sm text-slate-400">Unavailable.</p>
              ) : billing.reconcileFailures.rows.length === 0 ? (
                <p className="text-sm text-emerald-400">None — no usage stuck on insufficient funds.</p>
              ) : (
                <ul className="space-y-1 text-sm">
                  {billing.reconcileFailures.rows.map((r) => (
                    <li key={r.eventType} className="flex justify-between">
                      <span className="font-mono text-slate-400">{r.eventType}</span>
                      <span className="text-slate-300">{r.count} · <span className="font-mono">{money(r.totalCostCents)}</span></span>
                    </li>
                  ))}
                </ul>
              )}
            </GlowCard>
            <GlowCard title="Retry queue" icon={Clock3} tone={retryCount ? 'warn' : 'ok'}>
              {!billing?.retryQueueBacklog.available ? (
                <p className="text-sm text-slate-400">Queue table not present.</p>
              ) : billing.retryQueueBacklog.rows.length === 0 ? (
                <p className="text-sm text-emerald-400">Empty — no pending retries.</p>
              ) : (
                <ul className="space-y-1 text-sm">
                  {billing.retryQueueBacklog.rows.map((r) => (
                    <li key={r.status} className="flex justify-between">
                      <span className="font-mono text-slate-400">{r.status}</span>
                      <span className="text-slate-300">{r.count} · <span className="font-mono">{money(r.totalCents)}</span></span>
                    </li>
                  ))}
                </ul>
              )}
            </GlowCard>
          </div>
        </TabsContent>
      </Tabs>

      {/* Degradation notes */}
      {((infra?.notes.length ?? 0) > 0 || (billing?.notes.length ?? 0) > 0 || (spend?.notes.length ?? 0) > 0) && (
        <Card className="border-slate-700/60">
          <CardHeader>
            <CardTitle className="text-sm text-slate-400">Detector notes</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="list-disc space-y-1 pl-4 text-xs text-slate-500">
              {infra?.notes.map((n, i) => <li key={`i${i}`}>{n}</li>)}
              {billing?.notes.map((n, i) => <li key={`b${i}`}>{n}</li>)}
              {spend?.notes.map((n, i) => <li key={`s${i}`}>{n}</li>)}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function Row({ label, value, tone = 'muted' }: { label: string; value: string; tone?: Tone }) {
  return (
    <div className="flex justify-between">
      <span className="text-slate-400">{label}</span>
      <span className={`font-mono ${toneText[tone]}`}>{value}</span>
    </div>
  );
}
