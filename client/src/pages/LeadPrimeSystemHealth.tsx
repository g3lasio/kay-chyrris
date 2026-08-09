import { useState } from 'react';
import { trpc } from '@/lib/trpc';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ReportExporter } from '@/components/ReportExporter';
import { buildHealthReportHtml, type HealthReportData } from '@/lib/healthReportHtml';
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
  MinusCircle,
  Users,
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

/**
 * Detector apagado porque la capacidad NO EXISTE (extensión sin instalar, tabla
 * que nunca se creó, endpoint que pide plan Scale). El servidor ya las separa de
 * los errores reales — aquí solo se pintan en gris, aparte, para que "Detector
 * notes" vuelva a significar "algo se rompió".
 */
interface ClassifiedNote {
  detector: string;
  message: string;
  kind: 'unavailable' | 'issue';
  enableWith?: string;
}

interface BillingHealth {
  generatedAt: string;
  negativeBalances: Detector<{ contractorId: string; contractorName: string | null; contractorEmail: string | null; balanceCents: number }> & { count: number };
  reconciledActivity7d: Detector<{ eventType: string; count: number; totalCents: number }> & { count: number; totalCents: number };
  unchargedUsage24h: Detector<{ eventType: string; count: number; totalCostCents: number }> & { count: number; totalCostCents: number };
  reconcileFailures: Detector<{ eventType: string; count: number; totalCostCents: number }> & { count: number };
  retryQueueBacklog: Detector<{ status: string; count: number; totalCents: number }> & { count: number };
  notes: string[];
  unavailable?: ClassifiedNote[];
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
  unavailable?: ClassifiedNote[];
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
  unavailable?: ClassifiedNote[];
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
  const [tab, setTab] = useState('alerts');
  const utils = trpc.useUtils();

  const billingQ = trpc.leadprime.billingHealth.useQuery(undefined, { refetchInterval: 60000 });
  const infraQ = trpc.leadprime.infraHealth.useQuery(undefined, { refetchInterval: 60000 });
  const spendQ = trpc.leadprime.serviceSpend.useQuery(undefined, { refetchInterval: 120000 });
  // Programa de socios: existía desde hace un año con CERO atribuciones y nadie
  // se enteró porque "Referidos 0" se ve igual que "el socio no ha compartido
  // su link". Este detector comprueba el link de verdad.
  const partnerQ = trpc.leadprime.partnerReferralHealth.useQuery(undefined, { refetchInterval: 300000 });
  const partners = partnerQ.data?.data as
    | {
        available: boolean;
        note?: string;
        activePartners: number;
        silentPartners: Array<{ name: string; code: string; attributions: number; clicks: number }>;
        unresolvedClicks7d: number;
        pendingAttributions: number;
        linkCheck: { checked: boolean; url?: string; status?: number; ok: boolean; note?: string };
        emailChannel: { ok: boolean; note?: string };
        verdict: { level: 'ok' | 'warn' | 'alarm'; reason: string } | null;
      }
    | null
    | undefined;
  const uptimeQ = trpc.leadprime.providerUptime.useQuery({ hours: 24 }, { refetchInterval: 60000 });
  const costsQ = trpc.leadprime.providerCosts.useQuery({ days: 30 }, { refetchInterval: 300000 });
  const costs = (costsQ.data?.data ?? []) as Array<{ provider: string; kind: string; events: number; costUsd: number; quantity: number }>;
  const alertsQ = trpc.leadprime.alerts.useQuery({ status: 'all', limit: 100 }, { refetchInterval: 30000 });

  const uptime = (uptimeQ.data?.data ?? []) as Array<{
    provider: string; label: string; checks: number; uptimePct: number; errorPct: number;
    p50Ms: number | null; p95Ms: number | null; lastOk: boolean | null; lastError: string | null; lastCheckedAt: string | null;
  }>;
  const alerts = (alertsQ.data?.data ?? []) as Array<{
    id: number; alertKey: string; severity: string; source: string; title: string; detail: string | null;
    status: string; occurrences: number; lastSeenAt: string; notifiedAt: string | null;
  }>;
  const openAlerts = alerts.filter(a => a.status === 'open');
  const criticalOpen = openAlerts.filter(a => a.severity === 'critical');

  const runCheck = trpc.leadprime.runHealthCheck.useMutation({
    onSuccess: () => { uptimeQ.refetch(); alertsQ.refetch(); },
  });
  const ackAlert = trpc.leadprime.acknowledgeAlert.useMutation({
    onSuccess: () => alertsQ.refetch(),
  });

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
  // Recargas faltantes: el punto ciego del incidente de agosto. Si hay aunque
  // sea UNA, billing NO está limpio por mucho que el resto esté en verde.
  const missingRecharges = (billing as any)?.missingRecharges35d?.count ?? 0;
  const owedCreditsCents = (billing as any)?.missingRecharges35d?.owedCreditsCents ?? 0;
  const billingClean = !!billing && negCount === 0 && unchargedCount === 0
    && failuresCount === 0 && retryCount === 0 && missingRecharges === 0;

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

  // "API key off" mentía cuando el motivo real era un 403 por plan. Se dice el
  // motivo verdadero, corto, en el subtítulo del tile.
  const neonNote = neon?.note ?? '';
  const neonUnavailableReason = /40[23]|plan/i.test(neonNote)
    ? 'requiere plan Scale'
    : /not set/i.test(neonNote)
      ? 'falta API key'
      : 'no disponible';

  // Capacidades ausentes de los tres servicios, deduplicadas por detector+mensaje.
  const unavailableDetectors: ClassifiedNote[] = (() => {
    const all = [
      ...(infra?.unavailable ?? []),
      ...(billing?.unavailable ?? []),
      ...(spend?.unavailable ?? []),
    ];
    const seen = new Set<string>();
    return all.filter((n) => {
      const k = `${n.detector}:${n.message}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  })();

  const refreshAll = () => {
    billingQ.refetch();
    infraQ.refetch();
    spendQ.refetch();
  };
  const loading = billingQ.isFetching || infraQ.isFetching || spendQ.isFetching;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
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
        <div className="flex flex-wrap items-center gap-2 lg:justify-end lg:shrink-0">
          <ReportExporter<HealthReportData>
            fileBase="leadprime-system-health"
            fetchReport={async (range) => {
              const res = await utils.leadprime.healthReport.fetch({ range });
              if (!res.success || !res.data) throw new Error(res.error || 'Report unavailable');
              return res.data as HealthReportData;
            }}
            buildHtml={(data) => buildHealthReportHtml(data)}
          />
          <Button variant="outline" size="sm" onClick={refreshAll} disabled={loading}>
            <RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
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
          sub={neon?.available ? `${neon.monthComputeHours.toFixed(1)} CU-h MTD` : neonUnavailableReason}
          tone={neonTone}
        />
        <StatTile
          icon={Gauge}
          label="Cost / user"
          value={cpu?.available ? `${cpu.cuHoursPerActiveUser} CU-h` : '—'}
          sub={cpu?.available ? `${cpu.activeUsers30d} active / ${cpu.totalUsers} total` : 'no disponible'}
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
          value={billing ? String(negCount + unchargedCount + failuresCount + missingRecharges) : '—'}
          sub="neg. bal + unbilled + failed"
          tone={billing ? (negCount + unchargedCount + failuresCount + missingRecharges > 0 ? 'alarm' : 'ok') : 'muted'}
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
          <TabsTrigger value="alerts">
            Alertas &amp; Uptime
            {openAlerts.length > 0 && (
              <span className={`ml-1.5 text-[10px] px-1.5 py-0.5 rounded-full ${criticalOpen.length > 0 ? 'bg-rose-500 text-white' : 'bg-amber-500/80 text-black'}`}>
                {openAlerts.length}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="infra">Infra &amp; Cost</TabsTrigger>
          <TabsTrigger value="services">Services &amp; Spend</TabsTrigger>
          <TabsTrigger value="workers">Workers &amp; Crons</TabsTrigger>
          <TabsTrigger value="billing">Billing &amp; Wallet</TabsTrigger>
        </TabsList>

        {/* ─────────────────── ALERTAS & UPTIME (vigilancia activa) ─────────────────── */}
        <TabsContent value="alerts" className="space-y-4 pt-4">
          {/* Estado general + disparo manual */}
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2">
              {criticalOpen.length > 0 ? (
                <span className="text-sm font-semibold text-rose-400">
                  {criticalOpen.length} alerta{criticalOpen.length > 1 ? 's' : ''} CRÍTICA{criticalOpen.length > 1 ? 'S' : ''} abierta{criticalOpen.length > 1 ? 's' : ''}
                </span>
              ) : openAlerts.length > 0 ? (
                <span className="text-sm font-semibold text-amber-400">
                  {openAlerts.length} advertencia{openAlerts.length > 1 ? 's' : ''} abierta{openAlerts.length > 1 ? 's' : ''}
                </span>
              ) : (
                <span className="text-sm font-semibold text-emerald-400">
                  Todo en orden — sin alertas abiertas
                </span>
              )}
              <span className="text-xs text-slate-500">
                · el servidor sondea cada 5 min y avisa por SMS/email
              </span>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => runCheck.mutate()}
              disabled={runCheck.isPending}
            >
              {runCheck.isPending ? 'Sondeando...' : 'Sondear ahora'}
            </Button>
          </div>

          {/* Uptime / latencia por proveedor (sondas reales al plano de servicio) */}
          <Card className="bg-slate-900/40 border-slate-800">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-slate-300">Uptime y latencia — últimas 24 h</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {uptime.length === 0 ? (
                <p className="text-xs text-slate-500 px-4 pb-4">
                  Aún no hay sondas registradas. Usa “Sondear ahora” o espera al primer ciclo automático.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-800 text-xs text-slate-400">
                        <th className="text-left px-4 py-2 font-medium">Proveedor</th>
                        <th className="text-center px-3 py-2 font-medium">Estado</th>
                        <th className="text-right px-3 py-2 font-medium">Uptime</th>
                        <th className="text-right px-3 py-2 font-medium">Errores</th>
                        <th className="text-right px-3 py-2 font-medium">Latencia p50</th>
                        <th className="text-right px-3 py-2 font-medium">p95</th>
                        <th className="text-right px-3 py-2 font-medium">Sondas</th>
                      </tr>
                    </thead>
                    <tbody>
                      {uptime.map(u => (
                        <tr key={u.provider} className="border-b border-slate-800/60">
                          <td className="px-4 py-2">
                            <div className="font-medium">{u.label}</div>
                            {u.lastOk === false && u.lastError && (
                              <div className="text-xs text-rose-400 truncate max-w-[280px]" title={u.lastError}>{u.lastError}</div>
                            )}
                          </td>
                          <td className="px-3 py-2 text-center">
                            {u.lastOk === null ? (
                              <Badge className="border bg-slate-700/30 text-slate-400 border-slate-600/40">—</Badge>
                            ) : u.lastOk ? (
                              <Badge className="border bg-emerald-500/15 text-emerald-400 border-emerald-500/30">OK</Badge>
                            ) : (
                              <Badge className="border bg-rose-500/15 text-rose-400 border-rose-500/30">CAÍDO</Badge>
                            )}
                          </td>
                          <td className={`px-3 py-2 text-right font-mono ${u.uptimePct >= 99 ? 'text-emerald-400' : u.uptimePct >= 95 ? 'text-amber-400' : 'text-rose-400'}`}>
                            {u.uptimePct.toFixed(1)}%
                          </td>
                          <td className="px-3 py-2 text-right font-mono text-slate-400">{u.errorPct.toFixed(1)}%</td>
                          <td className="px-3 py-2 text-right font-mono text-slate-300">{u.p50Ms != null ? `${u.p50Ms} ms` : '—'}</td>
                          <td className={`px-3 py-2 text-right font-mono ${(u.p95Ms ?? 0) > 3000 ? 'text-amber-400' : 'text-slate-400'}`}>
                            {u.p95Ms != null ? `${u.p95Ms} ms` : '—'}
                          </td>
                          <td className="px-3 py-2 text-right text-xs text-slate-500">{u.checks}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Alertas: abiertas primero, luego el histórico resuelto */}
          <Card className="bg-slate-900/40 border-slate-800">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-slate-300">Alertas</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {alerts.length === 0 ? (
                <p className="text-xs text-slate-500">Sin alertas registradas.</p>
              ) : (
                alerts.map(a => (
                  <div
                    key={a.id}
                    className={`rounded-lg border p-3 ${
                      a.status !== 'open'
                        ? 'border-slate-800 bg-slate-900/30 opacity-60'
                        : a.severity === 'critical'
                          ? 'border-rose-500/40 bg-rose-500/5'
                          : 'border-amber-500/40 bg-amber-500/5'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium text-sm">{a.title}</span>
                          {a.status === 'open' ? (
                            <Badge className={`border text-[10px] ${a.severity === 'critical' ? 'bg-rose-500/15 text-rose-400 border-rose-500/30' : 'bg-amber-500/15 text-amber-400 border-amber-500/30'}`}>
                              {a.severity === 'critical' ? 'CRÍTICA' : 'ADVERTENCIA'}
                            </Badge>
                          ) : (
                            <Badge className="border text-[10px] bg-emerald-500/15 text-emerald-400 border-emerald-500/30">RESUELTA</Badge>
                          )}
                          <span className="text-[10px] text-slate-500">{a.source}</span>
                          {a.occurrences > 1 && (
                            <span className="text-[10px] text-slate-500">×{a.occurrences}</span>
                          )}
                        </div>
                        {a.detail && <p className="text-xs text-slate-400 mt-1">{a.detail}</p>}
                        <p className="text-[10px] text-slate-600 mt-1">
                          Último registro: {new Date(a.lastSeenAt).toLocaleString('es-MX')}
                          {a.notifiedAt ? ' · notificada' : ' · sin notificar'}
                        </p>
                      </div>
                      {a.status === 'open' && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="shrink-0 text-xs"
                          onClick={() => ackAlert.mutate({ id: a.id })}
                          disabled={ackAlert.isPending}
                          title="Silenciar re-notificaciones (se cierra sola al resolverse)"
                        >
                          Silenciar
                        </Button>
                      )}
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ───────────────────────── INFRA & COST ───────────────────────── */}
        <TabsContent value="infra" className="space-y-4 pt-4">
          <GlowCard title="Neon Compute — daily active vs CU hours (30d)" icon={Cpu} tone={neonTone}>
            {!neon?.available ? (
              <div className="text-sm text-slate-500">
                <p className="flex items-center gap-2">
                  <MinusCircle className="h-4 w-4 text-slate-600" />
                  No disponible — {neon?.note}
                </p>
                {neonUnavailableReason === 'requiere plan Scale' ? (
                  // La key está bien; el endpoint es de pago. Mandar a "crea una API
                  // key" aquí sería mandar al dueño a arreglar algo que no está roto.
                  <p className="mt-2 text-xs text-slate-600">
                    La API de consumo de Neon solo existe en plan Scale. La key está configurada y
                    funciona; el endpoint es el que no está incluido. Mientras tanto el riesgo de
                    compute se evalúa por cadencia de workers (tarjeta "Pollers 24/7"), que es el
                    dato que de verdad dispara el costo — sin inventar un $ exacto.
                  </p>
                ) : (
                  <p className="mt-2 text-xs text-slate-600">
                    Para habilitarlo: crear una API key <span className="font-mono">read-only</span> en Neon
                    (Account settings → API keys) y poner <span className="font-mono">NEON_API_KEY</span> +{' '}
                    <span className="font-mono">NEON_PROJECT_ID</span> en el servicio kay-chyrris. Opcionales:{' '}
                    <span className="font-mono">NEON_ORG_ID</span>, <span className="font-mono">NEON_COST_PER_CU_HOUR</span>.
                  </p>
                )}
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

          {/* Extensión OPCIONAL: si no está, la tarjeta va en gris ('muted'), no
              en ámbar — no hay nada roto, solo una función que nunca se activó. */}
          <GlowCard
            title="Hot queries (pg_stat_statements)"
            icon={Database}
            tone={!infra?.hotQueries.available ? 'muted' : hotHammer.length > 0 ? 'warn' : 'ok'}
          >
            {!infra?.hotQueries.available ? (
              <div className="text-sm text-slate-500">
                <p className="flex items-center gap-2">
                  <MinusCircle className="h-4 w-4 text-slate-600" />
                  No disponible — la extensión pg_stat_statements no está habilitada.
                </p>
                <p className="mt-2 text-xs text-slate-600">
                  No es un fallo: es una función opcional de diagnóstico. Para verla, en Neon →
                  Settings → Extensions: <span className="font-mono">CREATE EXTENSION pg_stat_statements;</span>{' '}
                  y agregarla a <span className="font-mono">shared_preload_libraries</span>. Sirve para
                  identificar qué query martillea la base.
                </p>
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
          {/* COGS REAL — lo que NOS cobran los proveedores, medido desde los
              webhooks de Twilio y los tokens que devuelven los LLM. Antes solo
              existía el precio que le cobramos al cliente: el margen era una
              estimación, no un dato. */}
          <Card className="bg-slate-900/40 border-slate-800">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-slate-300">
                Costo real de proveedores — últimos 30 días
                <span className="ml-2 text-[10px] font-normal text-slate-500">medido, no estimado</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {costs.length === 0 ? (
                <p className="text-xs text-slate-500 px-4 pb-4">
                  Aún no hay costos registrados. Se llenan solos conforme lleguen los webhooks de Twilio
                  y las respuestas de los modelos de IA.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-800 text-xs text-slate-400">
                        <th className="text-left px-4 py-2 font-medium">Proveedor</th>
                        <th className="text-left px-3 py-2 font-medium">Concepto</th>
                        <th className="text-right px-3 py-2 font-medium">Eventos</th>
                        <th className="text-right px-3 py-2 font-medium">Cantidad</th>
                        <th className="text-right px-4 py-2 font-medium">Costo real</th>
                      </tr>
                    </thead>
                    <tbody>
                      {costs.map((c, i) => (
                        <tr key={`${c.provider}-${c.kind}-${i}`} className="border-b border-slate-800/60">
                          <td className="px-4 py-2 font-medium capitalize">{c.provider}</td>
                          <td className="px-3 py-2 text-slate-400">{c.kind}</td>
                          <td className="px-3 py-2 text-right font-mono text-slate-400">{c.events.toLocaleString()}</td>
                          <td className="px-3 py-2 text-right font-mono text-slate-400">
                            {c.quantity.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                          </td>
                          <td className="px-4 py-2 text-right font-mono text-rose-300">
                            ${c.costUsd.toFixed(c.costUsd < 1 ? 4 : 2)}
                          </td>
                        </tr>
                      ))}
                      <tr className="bg-slate-900/60">
                        <td className="px-4 py-2 font-semibold" colSpan={4}>Total pagado a proveedores</td>
                        <td className="px-4 py-2 text-right font-mono font-semibold text-rose-300">
                          ${costs.reduce((s, c) => s + c.costUsd, 0).toFixed(2)}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>

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

          {/* RECARGAS FALTANTES — el tile que faltaba. Durante el incidente de
              agosto 2026 las renovaciones se cobraban sin acreditar créditos y
              esta página estuvo en verde un mes entero porque nadie cruzaba
              "te cobré" contra "te di lo que pagaste". */}
          {billing && (
            <Card className={missingRecharges > 0 ? 'border-rose-500/60 bg-rose-500/5' : 'bg-slate-900/40 border-slate-800'}>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-slate-300 flex items-center gap-2">
                  {missingRecharges > 0
                    ? <AlertTriangle className="h-4 w-4 text-rose-400" />
                    : <CheckCircle2 className="h-4 w-4 text-emerald-400" />}
                  Facturas pagadas SIN recarga de créditos — últimos 35 días
                </CardTitle>
              </CardHeader>
              <CardContent>
                {!(billing as any).missingRecharges35d?.available ? (
                  <p className="text-xs text-slate-500">No disponible (faltan tablas invoices / wallet_transactions).</p>
                ) : missingRecharges === 0 ? (
                  <p className="text-xs text-emerald-400">
                    Cada factura cobrada tiene su recarga aplicada. Este es el check que detecta que un
                    cliente pague y no reciba sus créditos.
                  </p>
                ) : (
                  <div className="space-y-2">
                    <p className="text-sm font-semibold text-rose-300">
                      {missingRecharges} factura(s) cobradas sin acreditar — ${(owedCreditsCents / 100).toFixed(2)} en créditos adeudados
                    </p>
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="border-b border-slate-800 text-slate-400">
                            <th className="text-left py-1.5 pr-3">Cuenta</th>
                            <th className="text-left py-1.5 pr-3">Plan</th>
                            <th className="text-right py-1.5 pr-3">Pagó</th>
                            <th className="text-right py-1.5 pr-3">Le corresponde</th>
                            <th className="text-left py-1.5">Factura</th>
                          </tr>
                        </thead>
                        <tbody>
                          {((billing as any).missingRecharges35d?.rows ?? []).map((r: any) => (
                            <tr key={r.invoiceId} className="border-b border-slate-800/60">
                              <td className="py-1.5 pr-3">
                                <div className="text-slate-200">{r.contractorName ?? r.contractorId ?? '—'}</div>
                                <div className="text-slate-500">{r.email ?? ''}</div>
                              </td>
                              <td className="py-1.5 pr-3 text-slate-400">{r.planName ?? '—'}</td>
                              <td className="py-1.5 pr-3 text-right font-mono text-slate-300">
                                ${(r.amountPaidCents / 100).toFixed(2)}
                              </td>
                              <td className="py-1.5 pr-3 text-right font-mono text-rose-300">
                                ${(r.expectedCreditsCents / 100).toFixed(2)}
                              </td>
                              <td className="py-1.5 font-mono text-slate-500">
                                {r.invoiceId}
                                {r.paidAt ? ` · ${r.paidAt.slice(0, 10)}` : ''}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
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
            {/* Sin tabla de cola no hay verde que dar: 'muted', no 'ok'. Pintar
                verde un detector inexistente es peor que no mostrarlo. */}
            <GlowCard
              title="Retry queue"
              icon={Clock3}
              tone={!billing?.retryQueueBacklog.available ? 'muted' : retryCount ? 'warn' : 'ok'}
            >
              {!billing?.retryQueueBacklog.available ? (
                <div className="text-sm text-slate-500">
                  <p className="flex items-center gap-2">
                    <MinusCircle className="h-4 w-4 text-slate-600" />
                    No disponible — no aplica.
                  </p>
                  <p className="mt-2 text-xs text-slate-600">
                    LeadPrime nunca creó la tabla <span className="font-mono">billing_retry_queue</span>.
                    Hoy los reintentos de cobro los maneja Stripe, así que no hay backlog local que vigilar.
                  </p>
                </div>
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

          {/* PROGRAMA DE SOCIOS. Nace de un fallo que vivió desde el
              lanzamiento del programa: el link de referido daba 404 y los tres
              socios marcaban 0 referidos — indistinguible de "todavía nadie se
              ha registrado". Aquí el link se comprueba de verdad. */}
          <GlowCard
            title="Programa de socios — atribución de referidos"
            icon={Users}
            tone={
              !partners?.available ? 'muted'
              : partners.verdict?.level === 'alarm' ? 'alarm'
              : partners.verdict?.level === 'warn' ? 'warn'
              : 'ok'
            }
          >
            {!partners?.available ? (
              <p className="text-sm text-slate-500">{partners?.note ?? 'Cargando…'}</p>
            ) : (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <Row label="Socios activos" value={String(partners.activePartners)} />
                  <Row
                    label="Sin clics ni referidos"
                    value={String(partners.silentPartners.length)}
                    tone={partners.silentPartners.length > 0 ? 'warn' : 'ok'}
                  />
                  <Row
                    label="Clics sin resolver (7d)"
                    value={String(partners.unresolvedClicks7d)}
                    tone={partners.unresolvedClicks7d > 0 ? 'alarm' : 'ok'}
                  />
                  <Row
                    label="Atribuciones pendientes"
                    value={String(partners.pendingAttributions)}
                    tone={partners.pendingAttributions > 0 ? 'warn' : 'ok'}
                  />
                </div>

                {/* La comprobación que faltaba: ¿el link responde? */}
                <div className="rounded border border-slate-800 bg-slate-950/40 p-2 text-xs">
                  <span className="text-slate-500">Link corto: </span>
                  {!partners.linkCheck.checked ? (
                    <span className="text-slate-500">{partners.linkCheck.note ?? 'sin comprobar'}</span>
                  ) : (
                    <>
                      <span className={partners.linkCheck.ok ? 'text-emerald-400' : 'text-rose-400'}>
                        HTTP {partners.linkCheck.status}
                      </span>
                      <span className="ml-2 font-mono text-slate-500">{partners.linkCheck.url}</span>
                      {!partners.linkCheck.ok && (
                        <p className="mt-1 text-rose-300">{partners.linkCheck.note}</p>
                      )}
                    </>
                  )}
                </div>

                {!partners.emailChannel.ok && (
                  <ActionHint tone="warn">
                    <p className="font-semibold text-slate-200">Los socios no pueden entrar a su portal</p>
                    <p>{partners.emailChannel.note}</p>
                  </ActionHint>
                )}

                {partners.verdict && (
                  <ActionHint tone={partners.verdict.level === 'alarm' ? 'alarm' : 'warn'}>
                    <p>{partners.verdict.reason}</p>
                  </ActionHint>
                )}

                {partners.silentPartners.length > 0 && (
                  <ul className="space-y-0.5 text-xs">
                    {partners.silentPartners.map((p) => (
                      <li key={p.code} className="flex justify-between text-slate-500">
                        <span className="truncate">{p.name}</span>
                        <span className="font-mono">{p.code} · 0 clics · 0 referidos</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </GlowCard>
        </TabsContent>
      </Tabs>

      {/* Detector notes — SOLO problemas reales. Las capacidades ausentes se
          fueron a la tarjeta gris de abajo para que esta lista signifique algo. */}
      {((infra?.notes.length ?? 0) > 0 || (billing?.notes.length ?? 0) > 0 || (spend?.notes.length ?? 0) > 0) && (
        <Card className="border-amber-700/40">
          <CardHeader>
            <CardTitle className="text-sm text-amber-300">Detector notes — requieren atención</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="list-disc space-y-1 pl-4 text-xs text-slate-400">
              {infra?.notes.map((n, i) => <li key={`i${i}`}>{n}</li>)}
              {billing?.notes.map((n, i) => <li key={`b${i}`}>{n}</li>)}
              {spend?.notes.map((n, i) => <li key={`s${i}`}>{n}</li>)}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* Capacidades no disponibles — informativo, NO es un fallo del sistema. */}
      {unavailableDetectors.length > 0 && (
        <Card className="border-slate-800 bg-slate-900/40">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm text-slate-500">
              <MinusCircle className="h-4 w-4" />
              No disponible ({unavailableDetectors.length}) — capacidad ausente, no un fallo
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="mb-3 text-xs text-slate-600">
              Estos detectores están apagados porque la función no existe en esta cuenta o base de
              datos (extensión sin instalar, tabla que nunca se creó, endpoint que requiere plan de
              pago). No hay nada roto que arreglar; si se quiere el dato, abajo está el paso exacto.
            </p>
            <ul className="space-y-2">
              {unavailableDetectors.map((n, i) => (
                <li key={`u${i}`} className="text-xs">
                  <span className="rounded bg-slate-800 px-1.5 py-0.5 font-mono text-[11px] text-slate-400">
                    {n.detector}
                  </span>{' '}
                  <span className="text-slate-500">{n.message}</span>
                  {n.enableWith && (
                    <p className="mt-0.5 pl-1 text-[11px] text-slate-600">→ {n.enableWith}</p>
                  )}
                </li>
              ))}
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
