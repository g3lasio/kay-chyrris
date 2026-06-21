import { useState } from 'react';
import { trpc } from '@/lib/trpc';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ReportExporter } from '@/components/ReportExporter';
import { buildFinanceReportHtml, type FinanceReportData } from '@/lib/financeReportHtml';
import {
  RefreshCw,
  AlertTriangle,
  TrendingUp,
  TrendingDown,
  Wallet,
  CreditCard,
  Coins,
  Receipt,
  Server,
  Landmark,
  Gift,
  KeyRound,
  Lightbulb,
  Layers,
  PlugZap,
  PieChart as PieIcon,
  Users,
  Repeat,
  UserMinus,
  ArrowUpRight,
  Telescope,
  Siren,
  ShieldAlert,
} from 'lucide-react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RTooltip,
  PieChart,
  Pie,
} from 'recharts';

// ── Types (mirror server/services/leadprime-finance.ts) ───────────────────────

interface Recurring {
  available: boolean;
  note?: string;
  mrrUsd: number;
  arrUsd: number;
  activeSubscriptions: number;
  byPlan: { plan: string; mrrUsd: number; subscriptions: number }[];
}
interface CapturedRevenue {
  available: boolean;
  note?: string;
  grossUsd: number;
  refundedUsd: number;
  netOfRefundsUsd: number;
  charges: number;
  projectedMonthUsd: number;
  estFeesUsd: number;
}
interface FreeCredits {
  available: boolean;
  note?: string;
  totalUsd: number;
  byType: { type: string; usd: number }[];
}
interface Cogs {
  available: boolean;
  note?: string;
  providersUsd: number;
  infraUsd: number;
  totalUsd: number;
  projectedMonthUsd: number;
}
interface FinanceOverview {
  generatedAt: string;
  stripeKeySource: 'leadprime' | 'shared' | null;
  recurring: Recurring;
  captured: CapturedRevenue;
  freeCredits: FreeCredits;
  cogs: Cogs;
  pnl: {
    grossRevenueUsd: number;
    stripeFeesUsd: number;
    netRevenueUsd: number;
    cogsUsd: number;
    grossProfitUsd: number;
    grossMarginPct: number | null;
    freeCreditsUsd: number;
    operatingProfitUsd: number;
    operatingMarginPct: number | null;
  };
  waterfall: { label: string; deltaUsd: number; kind: 'in' | 'out' | 'total' }[];
  notes: string[];
}

type Category = 'Messaging' | 'Voice & Phone' | 'AI' | 'Website' | 'Documents' | 'Other';
interface ProductSlice {
  eventType: string;
  label: string;
  color: string;
  category: Category;
  provider: 'anthropic' | 'openai' | 'twilio' | 'elevenlabs' | 'internal';
  billedUsd: number;
  events: number;
  contractors: number;
  quantity: number;
  sharePct: number;
}
interface CategorySlice {
  category: Category;
  billedUsd: number;
  sharePct: number;
}
interface ProviderRevenueSlice {
  provider: string;
  label: string;
  available: boolean;
  billedUsd: number;
  actualUsd: number | null;
  marginUsd: number | null;
}
interface FinanceBreakdown {
  generatedAt: string;
  totalBilledUsd: number;
  byProduct: ProductSlice[];
  byCategory: CategorySlice[];
  byProvider: ProviderRevenueSlice[];
  notes: string[];
}

interface UserSlice {
  contractorId: string;
  name: string;
  email: string;
  tradeType: string | null;
  createdAt: string | null;
  plan: string | null;
  status: string | null;
  monthsActive: number;
  mrrUsd: number;
  usageMtdUsd: number;
  lifetimeUsageUsd: number;
  cashTopupsUsd: number;
  subscriptionPaidUsd: number;
  lifetimeRevenueUsd: number;
  creditsGrantedUsd: number;
  netLifetimeUsd: number;
  brokeEven: boolean;
}
interface MrrMovements {
  available: boolean;
  note?: string;
  activeSubscriptions: number;
  activeMrrUsd: number;
  newCount: number;
  newMrrUsd: number;
  churnedCount: number;
  churnedMrrUsd: number;
  netNewMrrUsd: number;
  atRiskCount: number;
  atRiskMrrUsd: number;
  logoChurnRatePct: number | null;
}
interface FinanceByUser {
  generatedAt: string;
  available: boolean;
  note?: string;
  users: UserSlice[];
  totalUsers: number;
  payingUsers: number;
  brokeEvenUsers: number;
  avgLtvUsd: number;
  avgCacUsd: number;
  ltvCacRatio: number | null;
  totalLifetimeRevenueUsd: number;
  totalCreditsGrantedUsd: number;
  movements: MrrMovements;
  notes: string[];
}

interface ForecastBlock {
  available: boolean;
  note?: string;
  activeMrrUsd: number;
  arrUsd: number;
  netNewMrrUsd: number;
  nextMonthMrrUsd: number;
  projectedRevenueUsd: number | null;
  projectedCogsUsd: number | null;
  projectedOpProfitUsd: number | null;
}
interface Anomaly {
  metric: string;
  currentProjectedUsd: number;
  priorMonthUsd: number;
  changePct: number | null;
  severity: 'ok' | 'warn' | 'alarm';
  note: string;
}
interface AtRiskAccount {
  contractorId: string;
  name: string;
  email: string;
  status: string;
  reason: 'dunning' | 'cancel_scheduled';
  mrrUsd: number;
}
interface RevenueAtRisk {
  available: boolean;
  note?: string;
  dunningMrrUsd: number;
  dunningCount: number;
  cancelScheduledMrrUsd: number;
  cancelScheduledCount: number;
  totalAtRiskMrrUsd: number;
  accounts: AtRiskAccount[];
}
interface FinanceForecast {
  generatedAt: string;
  forecast: ForecastBlock;
  anomalies: Anomaly[];
  atRisk: RevenueAtRisk;
  notes: string[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const usd = (n: number | null | undefined) =>
  n == null ? '—' : `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const usd0 = (n: number | null | undefined) =>
  n == null ? '—' : `$${Math.round(n).toLocaleString('en-US')}`;
const pctTxt = (n: number | null | undefined) => (n == null ? '—' : `${n.toFixed(1)}%`);

// ── Futuristic primitives (shared visual language with System Health) ──────────

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

function Row({ label, value, tone = 'muted', strong = false }: { label: string; value: string; tone?: Tone; strong?: boolean }) {
  return (
    <div className={`flex items-center justify-between py-1.5 ${strong ? 'border-t border-slate-700/60 pt-2.5 mt-1' : ''}`}>
      <span className={`text-xs ${strong ? 'font-semibold text-slate-200' : 'text-slate-400'}`}>{label}</span>
      <span className={`font-mono text-sm ${strong ? 'font-bold' : ''} ${toneText[tone]}`}>{value}</span>
    </div>
  );
}

// ── Waterfall chart (gross → fees → COGS → credits → operating profit) ─────────

const WF_COLOR: Record<'in' | 'out' | 'total', string> = {
  in: '#34d399', // emerald
  out: '#fb7185', // rose
  total: '#22d3ee', // cyan
};

const CATEGORY_COLOR: Record<Category, string> = {
  Messaging: '#22d3ee', // cyan
  'Voice & Phone': '#a78bfa', // violet
  AI: '#34d399', // emerald
  Website: '#fbbf24', // amber
  Documents: '#fb7185', // rose
  Other: '#94a3b8', // slate
};

function buildWaterfall(steps: FinanceOverview['waterfall']) {
  let cum = 0;
  return steps.map((s) => {
    let base: number;
    let bar: number;
    if (s.kind === 'in') {
      base = 0;
      bar = s.deltaUsd;
      cum = s.deltaUsd;
    } else if (s.kind === 'total') {
      base = 0;
      bar = s.deltaUsd;
    } else {
      const next = cum + s.deltaUsd; // delta is negative
      base = Math.min(cum, next);
      bar = Math.abs(s.deltaUsd);
      cum = next;
    }
    return { label: s.label, base, bar, kind: s.kind, delta: s.deltaUsd };
  });
}

// ── Page ────────────────────────────────────────────────────────────────────────

export default function LeadPrimeFinance() {
  const [tab, setTab] = useState('overview');
  const utils = trpc.useUtils();
  const financeQ = trpc.leadprime.financeOverview.useQuery(undefined, { refetchInterval: 120000 });
  const breakdownQ = trpc.leadprime.financeBreakdown.useQuery(undefined, { refetchInterval: 120000 });
  const byUserQ = trpc.leadprime.financeByUser.useQuery(undefined, { refetchInterval: 120000 });
  const forecastQ = trpc.leadprime.financeForecast.useQuery(undefined, { refetchInterval: 120000 });
  const fin = financeQ.data?.data as FinanceOverview | null | undefined;
  const bd = breakdownQ.data?.data as FinanceBreakdown | null | undefined;
  const bu = byUserQ.data?.data as FinanceByUser | null | undefined;
  const fc = forecastQ.data?.data as FinanceForecast | null | undefined;
  const finErr = financeQ.data?.success === false ? financeQ.data?.error : null;
  const bdErr = breakdownQ.data?.success === false ? breakdownQ.data?.error : null;
  const buErr = byUserQ.data?.success === false ? byUserQ.data?.error : null;
  const fcErr = forecastQ.data?.success === false ? forecastQ.data?.error : null;
  const loading = financeQ.isFetching || breakdownQ.isFetching || byUserQ.isFetching || forecastQ.isFetching;

  const pnl = fin?.pnl;
  const opProfit = pnl?.operatingProfitUsd ?? 0;
  const opTone: Tone = !fin ? 'muted' : opProfit > 0 ? 'ok' : opProfit < 0 ? 'alarm' : 'warn';
  const grossTone: Tone = !fin ? 'muted' : (pnl?.grossRevenueUsd ?? 0) > 0 ? 'ok' : 'muted';
  const cogsTone: Tone = !fin?.cogs.available ? 'muted' : 'warn';
  const mrrTone: Tone = !fin?.recurring.available ? 'muted' : (fin.recurring.mrrUsd > 0 ? 'ok' : 'muted');
  const creditsTone: Tone = !fin?.freeCredits.available ? 'muted' : (fin.freeCredits.totalUsd > 0 ? 'warn' : 'ok');

  const noStripe = fin?.stripeKeySource == null;
  const wf = fin ? buildWaterfall(fin.waterfall) : [];
  const mv = bu?.movements;
  const fcast = fc?.forecast;
  const atRisk = fc?.atRisk;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-slate-100">
            <TrendingUp className="h-6 w-6 text-emerald-400" />
            Finance
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            Read-only P&amp;L for LeadPrime — revenue Stripe actually captured (only
            <code className="mx-1 rounded bg-slate-800 px-1 text-[11px]">metadata.product=leadprime</code>),
            recurring MRR/ARR, processing fees, cost to serve, and what's left over. Never moves money.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {fin?.stripeKeySource && (
            <Pill tone={fin.stripeKeySource === 'leadprime' ? 'ok' : 'muted'}>
              {fin.stripeKeySource === 'leadprime' ? 'LeadPrime Stripe key' : 'Shared Stripe key'}
            </Pill>
          )}
          <ReportExporter<FinanceReportData>
            fileBase="leadprime-finance"
            fetchReport={async (range) => {
              const res = await utils.leadprime.financeReport.fetch({ range });
              if (!res.success || !res.data) throw new Error(res.error || 'Report unavailable');
              return res.data as FinanceReportData;
            }}
            buildHtml={(data) => buildFinanceReportHtml(data)}
          />
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              financeQ.refetch();
              breakdownQ.refetch();
              byUserQ.refetch();
              forecastQ.refetch();
            }}
            disabled={loading}
          >
            <RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
      </div>

      {finErr && (
        <Card className="border-rose-500/40">
          <CardContent className="flex items-center gap-2 pt-6 text-rose-400">
            <AlertTriangle className="h-4 w-4" />
            <span>Finance: {finErr}</span>
          </CardContent>
        </Card>
      )}

      {noStripe && fin && (
        <Card className="border-amber-500/40">
          <CardContent className="flex items-start gap-2 pt-6 text-amber-300">
            <KeyRound className="mt-0.5 h-4 w-4 shrink-0" />
            <div className="text-sm">
              No Stripe key found. Set <code className="rounded bg-slate-800 px-1">LEADPRIME_STRIPE_SECRET_KEY</code>
              {' '}(a read-only restricted key is ideal) or the shared <code className="rounded bg-slate-800 px-1">STRIPE_SECRET_KEY</code> on the admin service.
              Revenue & MRR stay blank until then.
            </div>
          </CardContent>
        </Card>
      )}

      {bdErr && (
        <Card className="border-rose-500/40">
          <CardContent className="flex items-center gap-2 pt-6 text-rose-400">
            <AlertTriangle className="h-4 w-4" />
            <span>Breakdown: {bdErr}</span>
          </CardContent>
        </Card>
      )}

      {buErr && (
        <Card className="border-rose-500/40">
          <CardContent className="flex items-center gap-2 pt-6 text-rose-400">
            <AlertTriangle className="h-4 w-4" />
            <span>By user: {buErr}</span>
          </CardContent>
        </Card>
      )}

      {fcErr && (
        <Card className="border-rose-500/40">
          <CardContent className="flex items-center gap-2 pt-6 text-rose-400">
            <AlertTriangle className="h-4 w-4" />
            <span>Forecast: {fcErr}</span>
          </CardContent>
        </Card>
      )}

      <Tabs value={tab} onValueChange={setTab} className="space-y-6">
        <TabsList className="bg-slate-900/60">
          <TabsTrigger value="overview">
            <Coins className="mr-1.5 h-3.5 w-3.5" />
            P&amp;L Overview
          </TabsTrigger>
          <TabsTrigger value="breakdown">
            <Layers className="mr-1.5 h-3.5 w-3.5" />
            By Product &amp; Provider
          </TabsTrigger>
          <TabsTrigger value="users">
            <Users className="mr-1.5 h-3.5 w-3.5" />
            By User &amp; Churn
          </TabsTrigger>
          <TabsTrigger value="forecast">
            <Telescope className="mr-1.5 h-3.5 w-3.5" />
            Forecast &amp; Risk
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-6">
      {/* Command deck — P&L KPI tiles */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        <StatTile
          icon={opProfit >= 0 ? TrendingUp : TrendingDown}
          label="Op. profit MTD"
          value={usd(opProfit)}
          sub={pnl?.operatingMarginPct != null ? `${pctTxt(pnl.operatingMarginPct)} margin` : 'after credits'}
          tone={opTone}
        />
        <StatTile
          icon={Wallet}
          label="Gross revenue MTD"
          value={usd(pnl?.grossRevenueUsd)}
          sub={fin?.captured.available ? `${fin.captured.charges} charges · proj ${usd0(fin.captured.projectedMonthUsd)}` : 'Stripe off'}
          tone={grossTone}
        />
        <StatTile
          icon={TrendingUp}
          label="MRR"
          value={usd(fin?.recurring.mrrUsd)}
          sub={fin?.recurring.available ? `ARR ${usd0(fin.recurring.arrUsd)} · ${fin.recurring.activeSubscriptions} subs` : 'Stripe off'}
          tone={mrrTone}
        />
        <StatTile
          icon={Server}
          label="COGS MTD"
          value={usd(fin?.cogs.totalUsd)}
          sub={fin?.cogs.available ? `providers + Neon · proj ${usd0(fin.cogs.projectedMonthUsd)}` : 'keys off'}
          tone={cogsTone}
        />
        <StatTile
          icon={Receipt}
          label="Stripe fees MTD"
          value={usd(pnl?.stripeFeesUsd)}
          sub="est. 2.9% + $0.30"
          tone={fin ? 'warn' : 'muted'}
        />
        <StatTile
          icon={Gift}
          label="Free credits MTD"
          value={usd(fin?.freeCredits.totalUsd)}
          sub="given away (CAC)"
          tone={creditsTone}
        />
      </div>

      {/* Waterfall + P&L breakdown */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className={`lg:col-span-2 bg-slate-950/60 backdrop-blur ${toneRing[opTone]}`}>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-sm font-semibold tracking-wide text-slate-200">
              <Landmark className={`h-4 w-4 ${toneText[opTone]}`} />
              Profit waterfall — month to date
            </CardTitle>
          </CardHeader>
          <CardContent>
            {wf.length > 0 ? (
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={wf} margin={{ top: 10, right: 10, left: 0, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                  <XAxis dataKey="label" tick={{ fill: '#94a3b8', fontSize: 11 }} interval={0} />
                  <YAxis tick={{ fill: '#94a3b8', fontSize: 11 }} tickFormatter={(v) => `$${v}`} />
                  <RTooltip
                    cursor={{ fill: '#1e293b40' }}
                    contentStyle={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 8, fontSize: 12 }}
                    formatter={(_v: any, _n: any, p: any) => [usd(p?.payload?.delta), p?.payload?.label]}
                  />
                  <Bar dataKey="base" stackId="wf" fill="transparent" isAnimationActive={false} />
                  <Bar dataKey="bar" stackId="wf" radius={[3, 3, 0, 0]}>
                    {wf.map((d, i) => (
                      <Cell key={i} fill={WF_COLOR[d.kind]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="py-12 text-center text-sm text-slate-500">No data yet.</div>
            )}
          </CardContent>
        </Card>

        <GlowCard title="P&L statement (MTD)" icon={Coins} tone={opTone}>
          <div className="space-y-0.5">
            <Row label="Gross revenue" value={usd(pnl?.grossRevenueUsd)} tone="ok" />
            <Row label="Stripe fees" value={pnl ? `−${usd(pnl.stripeFeesUsd)}` : '—'} tone="alarm" />
            <Row label="Net revenue" value={usd(pnl?.netRevenueUsd)} tone="muted" />
            <Row label="Provider + infra COGS" value={pnl ? `−${usd(pnl.cogsUsd)}` : '—'} tone="alarm" />
            <Row label="Gross profit" value={usd(pnl?.grossProfitUsd)} tone={(pnl?.grossProfitUsd ?? 0) >= 0 ? 'ok' : 'alarm'} />
            <Row label="Gross margin" value={pctTxt(pnl?.grossMarginPct)} tone="muted" />
            <Row label="Free credits (CAC)" value={pnl ? `−${usd(pnl.freeCreditsUsd)}` : '—'} tone="warn" />
            <Row label="Operating profit" value={usd(pnl?.operatingProfitUsd)} tone={opTone} strong />
            <Row label="Operating margin" value={pctTxt(pnl?.operatingMarginPct)} tone={opTone} />
          </div>
          {pnl && pnl.operatingProfitUsd < 0 && (
            <ActionHint tone="alarm">
              <div>
                Operating at a loss this month. Net revenue {usd(pnl.netRevenueUsd)} doesn't yet cover{' '}
                {usd(pnl.cogsUsd)} cost-to-serve + {usd(pnl.freeCreditsUsd)} in free credits. Levers: raise
                paid conversion / MRR, trim the heaviest provider COGS, or tighten free-credit grants.
              </div>
            </ActionHint>
          )}
        </GlowCard>
      </div>

      {/* Detail cards */}
      <div className="grid gap-4 lg:grid-cols-3">
        {/* Recurring */}
        <GlowCard title="Recurring revenue" icon={TrendingUp} tone={mrrTone}>
          {fin?.recurring.available ? (
            <>
              <div className="grid grid-cols-3 gap-2 text-center">
                <div>
                  <div className="font-mono text-lg font-bold text-emerald-400">{usd(fin.recurring.mrrUsd)}</div>
                  <div className="text-[10px] uppercase tracking-wider text-slate-500">MRR</div>
                </div>
                <div>
                  <div className="font-mono text-lg font-bold text-slate-200">{usd0(fin.recurring.arrUsd)}</div>
                  <div className="text-[10px] uppercase tracking-wider text-slate-500">ARR</div>
                </div>
                <div>
                  <div className="font-mono text-lg font-bold text-slate-200">{fin.recurring.activeSubscriptions}</div>
                  <div className="text-[10px] uppercase tracking-wider text-slate-500">Active subs</div>
                </div>
              </div>
              {fin.recurring.byPlan.length > 0 && (
                <div className="mt-3 space-y-0.5">
                  {fin.recurring.byPlan.map((p) => (
                    <div key={p.plan} className="flex items-center justify-between py-1 text-xs">
                      <span className="truncate text-slate-400">{p.plan}</span>
                      <span className="ml-2 shrink-0 font-mono text-slate-300">
                        {usd(p.mrrUsd)} <span className="text-slate-600">· {p.subscriptions}</span>
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </>
          ) : (
            <div className="text-xs text-slate-500">{fin?.recurring.note ?? 'Loading…'}</div>
          )}
        </GlowCard>

        {/* Captured revenue */}
        <GlowCard title="Captured by Stripe (MTD)" icon={CreditCard} tone={grossTone}>
          {fin?.captured.available ? (
            <div className="space-y-0.5">
              <Row label="Gross charges" value={usd(fin.captured.grossUsd)} tone="ok" />
              <Row label="Refunds" value={`−${usd(fin.captured.refundedUsd)}`} tone={fin.captured.refundedUsd > 0 ? 'alarm' : 'muted'} />
              <Row label="Net of refunds" value={usd(fin.captured.netOfRefundsUsd)} tone="muted" />
              <Row label="# charges" value={String(fin.captured.charges)} tone="muted" />
              <Row label="Est. Stripe fees" value={`−${usd(fin.captured.estFeesUsd)}`} tone="warn" />
              <Row label="Projected month" value={usd(fin.captured.projectedMonthUsd)} tone="ok" strong />
            </div>
          ) : (
            <div className="text-xs text-slate-500">{fin?.captured.note ?? 'Loading…'}</div>
          )}
        </GlowCard>

        {/* COGS + Free credits */}
        <div className="space-y-4">
          <GlowCard title="Cost to serve (COGS)" icon={Server} tone={cogsTone}>
            {fin?.cogs.available ? (
              <div className="space-y-0.5">
                <Row label="Providers (AI / SMS / voice)" value={usd(fin.cogs.providersUsd)} tone="warn" />
                <Row label="Neon compute" value={usd(fin.cogs.infraUsd)} tone="warn" />
                <Row label="Total COGS" value={usd(fin.cogs.totalUsd)} tone="alarm" strong />
                <Row label="Projected month" value={usd(fin.cogs.projectedMonthUsd)} tone="muted" />
              </div>
            ) : (
              <div className="text-xs text-slate-500">{fin?.cogs.note ?? 'Loading…'}</div>
            )}
          </GlowCard>

          <GlowCard title="Free credits given (CAC)" icon={Gift} tone={creditsTone}>
            {fin?.freeCredits.available ? (
              fin.freeCredits.byType.length > 0 ? (
                <div className="space-y-0.5">
                  {fin.freeCredits.byType.map((c) => (
                    <Row key={c.type} label={c.type.replace(/_/g, ' ')} value={usd(c.usd)} tone="warn" />
                  ))}
                  <Row label="Total credits" value={usd(fin.freeCredits.totalUsd)} tone="warn" strong />
                </div>
              ) : (
                <div className="text-xs text-emerald-400">No free credits granted this month.</div>
              )
            ) : (
              <div className="text-xs text-slate-500">{fin?.freeCredits.note ?? 'Loading…'}</div>
            )}
          </GlowCard>
        </div>
      </div>

        </TabsContent>

        <TabsContent value="breakdown" className="space-y-6">
          {/* Top tiles */}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatTile
              icon={Wallet}
              label="Usage revenue MTD"
              value={usd(bd?.totalBilledUsd)}
              sub={bd ? `${bd.byProduct.length} services billed` : '—'}
              tone={bd && bd.totalBilledUsd > 0 ? 'ok' : 'muted'}
            />
            <StatTile
              icon={PieIcon}
              label="Top service"
              value={bd?.byProduct[0] ? bd.byProduct[0].label : '—'}
              sub={bd?.byProduct[0] ? `${usd(bd.byProduct[0].billedUsd)} · ${bd.byProduct[0].sharePct}%` : 'no usage'}
              tone={bd?.byProduct[0] ? 'ok' : 'muted'}
            />
            <StatTile
              icon={Layers}
              label="Top category"
              value={bd?.byCategory[0] ? bd.byCategory[0].category : '—'}
              sub={bd?.byCategory[0] ? `${usd(bd.byCategory[0].billedUsd)} · ${bd.byCategory[0].sharePct}%` : '—'}
              tone={bd?.byCategory[0] ? 'ok' : 'muted'}
            />
            <StatTile
              icon={PlugZap}
              label="Provider ROI"
              value={
                bd
                  ? usd(
                      bd.byProvider.reduce((s, p) => s + (p.marginUsd ?? 0), 0),
                    )
                  : '—'
              }
              sub="billed − provider cost"
              tone={
                !bd
                  ? 'muted'
                  : bd.byProvider.reduce((s, p) => s + (p.marginUsd ?? 0), 0) >= 0
                    ? 'ok'
                    : 'alarm'
              }
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-5">
            {/* By product bar chart */}
            <Card className="lg:col-span-3 bg-slate-950/60 backdrop-blur border-slate-700/60">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-sm font-semibold tracking-wide text-slate-200">
                  <Layers className="h-4 w-4 text-cyan-400" />
                  Revenue by service (MTD)
                </CardTitle>
              </CardHeader>
              <CardContent>
                {bd && bd.byProduct.length > 0 ? (
                  <ResponsiveContainer width="100%" height={Math.max(220, bd.byProduct.length * 34)}>
                    <BarChart data={bd.byProduct} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 4 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" horizontal={false} />
                      <XAxis type="number" tick={{ fill: '#94a3b8', fontSize: 11 }} tickFormatter={(v) => `$${v}`} />
                      <YAxis
                        type="category"
                        dataKey="label"
                        width={110}
                        tick={{ fill: '#94a3b8', fontSize: 11 }}
                      />
                      <RTooltip
                        cursor={{ fill: '#1e293b40' }}
                        contentStyle={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 8, fontSize: 12 }}
                        formatter={(v: any, _n: any, p: any) => [usd(Number(v)), `${p?.payload?.sharePct}% · ${p?.payload?.contractors} users`]}
                      />
                      <Bar dataKey="billedUsd" radius={[0, 3, 3, 0]}>
                        {bd.byProduct.map((d, i) => (
                          <Cell key={i} fill={d.color} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="py-12 text-center text-sm text-slate-500">No usage billed this month.</div>
                )}
              </CardContent>
            </Card>

            {/* By category pie */}
            <GlowCard title="By category" icon={PieIcon} tone="muted">
              {bd && bd.byCategory.length > 0 ? (
                <>
                  <ResponsiveContainer width="100%" height={180}>
                    <PieChart>
                      <Pie
                        data={bd.byCategory}
                        dataKey="billedUsd"
                        nameKey="category"
                        cx="50%"
                        cy="50%"
                        innerRadius={42}
                        outerRadius={70}
                        paddingAngle={2}
                      >
                        {bd.byCategory.map((c, i) => (
                          <Cell key={i} fill={CATEGORY_COLOR[c.category]} />
                        ))}
                      </Pie>
                      <RTooltip
                        contentStyle={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 8, fontSize: 12 }}
                        formatter={(v: any, n: any) => [usd(Number(v)), n]}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="mt-2 space-y-0.5">
                    {bd.byCategory.map((c) => (
                      <div key={c.category} className="flex items-center justify-between py-0.5 text-xs">
                        <span className="flex items-center gap-1.5 text-slate-400">
                          <span className="h-2 w-2 rounded-full" style={{ background: CATEGORY_COLOR[c.category] }} />
                          {c.category}
                        </span>
                        <span className="font-mono text-slate-300">{usd(c.billedUsd)} <span className="text-slate-600">· {c.sharePct}%</span></span>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <div className="py-8 text-center text-sm text-slate-500">No data.</div>
              )}
            </GlowCard>
          </div>

          {/* Per-service table */}
          <Card className="bg-slate-950/60 backdrop-blur border-slate-700/60">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-sm font-semibold tracking-wide text-slate-200">
                <Receipt className="h-4 w-4 text-cyan-400" />
                Service detail
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-slate-700/60 text-left text-slate-500">
                      <th className="py-1.5 pr-3 font-medium">Service</th>
                      <th className="py-1.5 pr-3 font-medium">Category</th>
                      <th className="py-1.5 pr-3 font-medium">Provider</th>
                      <th className="py-1.5 pr-3 text-right font-medium">Revenue</th>
                      <th className="py-1.5 pr-3 text-right font-medium">Share</th>
                      <th className="py-1.5 pr-3 text-right font-medium">Qty</th>
                      <th className="py-1.5 pr-3 text-right font-medium">Events</th>
                      <th className="py-1.5 text-right font-medium">Users</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(bd?.byProduct ?? []).map((p) => (
                      <tr key={p.eventType} className="border-b border-slate-800/40">
                        <td className="py-1.5 pr-3">
                          <span className="flex items-center gap-1.5 text-slate-200">
                            <span className="h-2 w-2 rounded-full" style={{ background: p.color }} />
                            {p.label}
                          </span>
                        </td>
                        <td className="py-1.5 pr-3 text-slate-400">{p.category}</td>
                        <td className="py-1.5 pr-3 text-slate-500">{p.provider}</td>
                        <td className="py-1.5 pr-3 text-right font-mono text-emerald-400">{usd(p.billedUsd)}</td>
                        <td className="py-1.5 pr-3 text-right font-mono text-slate-400">{p.sharePct}%</td>
                        <td className="py-1.5 pr-3 text-right font-mono text-slate-400">{p.quantity}</td>
                        <td className="py-1.5 pr-3 text-right font-mono text-slate-500">{p.events}</td>
                        <td className="py-1.5 text-right font-mono text-slate-500">{p.contractors}</td>
                      </tr>
                    ))}
                    {(!bd || bd.byProduct.length === 0) && (
                      <tr>
                        <td colSpan={8} className="py-6 text-center text-slate-500">No usage billed this month.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          {/* Provider ROI */}
          <GlowCard title="Provider ROI — billed vs actual cost" icon={PlugZap} tone="muted">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-slate-700/60 text-left text-slate-500">
                    <th className="py-1.5 pr-3 font-medium">Provider</th>
                    <th className="py-1.5 pr-3 text-right font-medium">Billed to users</th>
                    <th className="py-1.5 pr-3 text-right font-medium">Actual cost</th>
                    <th className="py-1.5 text-right font-medium">Margin</th>
                  </tr>
                </thead>
                <tbody>
                  {(bd?.byProvider ?? []).map((p) => (
                    <tr key={p.provider} className="border-b border-slate-800/40">
                      <td className="py-1.5 pr-3 text-slate-200">{p.label}</td>
                      <td className="py-1.5 pr-3 text-right font-mono text-slate-300">{usd(p.billedUsd)}</td>
                      <td className="py-1.5 pr-3 text-right font-mono text-slate-400">
                        {p.actualUsd == null ? <span className="text-slate-600">—</span> : usd(p.actualUsd)}
                      </td>
                      <td className={`py-1.5 text-right font-mono ${p.marginUsd == null ? 'text-slate-600' : p.marginUsd >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                        {p.marginUsd == null ? '—' : usd(p.marginUsd)}
                      </td>
                    </tr>
                  ))}
                  {(!bd || bd.byProvider.length === 0) && (
                    <tr>
                      <td colSpan={4} className="py-6 text-center text-slate-500">Provider data unavailable.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-[11px] text-slate-500">
              Actual cost needs provider keys (Anthropic/OpenAI Admin, Twilio, ElevenLabs). Internal-only services
              (emails, website, LeadSign) have no external provider line.
            </p>
          </GlowCard>

          {bd?.notes && bd.notes.length > 0 && (
            <Card className="border-slate-700/60 bg-slate-950/40">
              <CardContent className="pt-5">
                <div className="mb-1 text-[11px] uppercase tracking-widest text-slate-500">Diagnostics</div>
                <ul className="space-y-0.5 text-xs text-slate-500">
                  {bd.notes.map((n, i) => (
                    <li key={i}>· {n}</li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="users" className="space-y-6">
          {/* Movements & LTV command deck */}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatTile
              icon={mv && mv.netNewMrrUsd >= 0 ? ArrowUpRight : TrendingDown}
              label="Net new MRR"
              value={usd(mv?.netNewMrrUsd)}
              sub={mv ? `+${usd0(mv.newMrrUsd)} new · −${usd0(mv.churnedMrrUsd)} churned` : 'this month'}
              tone={!mv?.available ? 'muted' : (mv.netNewMrrUsd ?? 0) >= 0 ? 'ok' : 'alarm'}
            />
            <StatTile
              icon={Repeat}
              label="Active MRR"
              value={usd(mv?.activeMrrUsd)}
              sub={mv ? `${mv.activeSubscriptions} subscriptions` : 'recurring'}
              tone={!mv?.available ? 'muted' : (mv.activeMrrUsd ?? 0) > 0 ? 'ok' : 'muted'}
            />
            <StatTile
              icon={ArrowUpRight}
              label="LTV : CAC"
              value={bu?.ltvCacRatio != null ? `${bu.ltvCacRatio}×` : '—'}
              sub={bu ? `${usd0(bu.avgLtvUsd)} LTV · ${usd0(bu.avgCacUsd)} CAC` : 'lifetime'}
              tone={!bu?.available ? 'muted' : (bu.ltvCacRatio ?? 0) >= 3 ? 'ok' : (bu.ltvCacRatio ?? 0) >= 1 ? 'warn' : 'alarm'}
            />
            <StatTile
              icon={Users}
              label="Broke-even users"
              value={bu ? `${bu.brokeEvenUsers}/${bu.payingUsers || bu.totalUsers}` : '—'}
              sub={bu ? `${bu.totalUsers} with activity` : 'revenue > credits'}
              tone={!bu?.available ? 'muted' : bu.brokeEvenUsers > 0 ? 'ok' : 'warn'}
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            {/* MRR movements & churn */}
            <GlowCard
              title="MRR movements & churn (MTD)"
              icon={Repeat}
              tone={!mv?.available ? 'muted' : (mv.churnedMrrUsd ?? 0) > 0 || (mv.atRiskMrrUsd ?? 0) > 0 ? 'warn' : 'ok'}
            >
              <Row label="New MRR" value={`+${usd(mv?.newMrrUsd)}`} tone="ok" />
              <Row label={`Churned MRR (${mv?.churnedCount ?? 0})`} value={`−${usd(mv?.churnedMrrUsd)}`} tone={(mv?.churnedMrrUsd ?? 0) > 0 ? 'alarm' : 'muted'} />
              <Row label="Net new MRR" value={usd(mv?.netNewMrrUsd)} tone={(mv?.netNewMrrUsd ?? 0) >= 0 ? 'ok' : 'alarm'} strong />
              <Row label={`At risk — cancels at period end (${mv?.atRiskCount ?? 0})`} value={usd(mv?.atRiskMrrUsd)} tone={(mv?.atRiskMrrUsd ?? 0) > 0 ? 'warn' : 'muted'} />
              <Row label="Logo churn (MTD proxy)" value={pctTxt(mv?.logoChurnRatePct)} tone={(mv?.logoChurnRatePct ?? 0) > 0 ? 'warn' : 'muted'} />
              {(mv?.atRiskMrrUsd ?? 0) > 0 && (
                <ActionHint tone="warn">
                  <div>
                    <strong>{usd(mv?.atRiskMrrUsd)}</strong> of MRR is set to cancel at period end. Reach out before the period closes to save it.
                  </div>
                </ActionHint>
              )}
              {!mv?.available && (
                <p className="mt-2 text-[11px] text-slate-500">{mv?.note || 'Subscriptions table unavailable.'}</p>
              )}
              <p className="mt-2 text-[11px] text-slate-500">
                Expansion/contraction (plan changes) needs historical snapshots and is not shown.
              </p>
            </GlowCard>

            {/* LTV / CAC / breakeven */}
            <GlowCard title="Lifetime value & breakeven" icon={Coins} tone={!bu?.available ? 'muted' : 'ok'}>
              <Row label="Avg LTV (to date, cash)" value={usd(bu?.avgLtvUsd)} tone="ok" />
              <Row label="Avg CAC (free credits)" value={usd(bu?.avgCacUsd)} tone={(bu?.avgCacUsd ?? 0) > 0 ? 'warn' : 'muted'} />
              <Row label="LTV : CAC" value={bu?.ltvCacRatio != null ? `${bu.ltvCacRatio}×` : '—'} tone={(bu?.ltvCacRatio ?? 0) >= 3 ? 'ok' : (bu?.ltvCacRatio ?? 0) >= 1 ? 'warn' : 'alarm'} strong />
              <Row label="Paying users" value={String(bu?.payingUsers ?? 0)} />
              <Row label="Broke-even users" value={`${bu?.brokeEvenUsers ?? 0} / ${bu?.totalUsers ?? 0}`} tone={(bu?.brokeEvenUsers ?? 0) > 0 ? 'ok' : 'muted'} />
              <Row label="Total lifetime revenue" value={usd(bu?.totalLifetimeRevenueUsd)} tone="ok" strong />
              <Row label="Total credits given (CAC)" value={usd(bu?.totalCreditsGrantedUsd)} tone={(bu?.totalCreditsGrantedUsd ?? 0) > 0 ? 'warn' : 'muted'} />
              <p className="mt-2 text-[11px] text-slate-500">
                LTV-to-date = subscription license paid (≈ months active × base price) + real-money wallet top-ups.
                Usage is funded by prepaid credits (not added, to avoid double counting). Per-user COGS is not
                separable from provider totals, so it is not subtracted.
              </p>
            </GlowCard>
          </div>

          {/* Per-user table */}
          <Card className="bg-slate-950/60 backdrop-blur border-slate-700/60">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-sm font-semibold tracking-wide text-slate-200">
                <Users className="h-4 w-4 text-cyan-400" />
                Users — revenue vs credits (top {bu?.users.length ?? 0} by lifetime revenue)
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-slate-700/60 text-left text-slate-500">
                      <th className="py-1.5 pr-3 font-medium">User</th>
                      <th className="py-1.5 pr-3 font-medium">Plan</th>
                      <th className="py-1.5 pr-3 font-medium">Status</th>
                      <th className="py-1.5 pr-3 text-right font-medium">MRR</th>
                      <th className="py-1.5 pr-3 text-right font-medium">Usage MTD</th>
                      <th className="py-1.5 pr-3 text-right font-medium">Lifetime rev</th>
                      <th className="py-1.5 pr-3 text-right font-medium">Credits (CAC)</th>
                      <th className="py-1.5 text-right font-medium">Net</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(bu?.users ?? []).map((u) => {
                      const st = u.status;
                      const stTone: Tone =
                        st === 'active' ? 'ok' : st === 'trialing' ? 'warn' : st === 'past_due' || st === 'unpaid' ? 'alarm' : 'muted';
                      return (
                        <tr key={u.contractorId} className="border-b border-slate-800/40">
                          <td className="py-1.5 pr-3">
                            <div className="flex items-center gap-1.5 text-slate-200">
                              {!u.brokeEven && u.creditsGrantedUsd > 0 && <UserMinus className="h-3 w-3 text-amber-400" />}
                              {u.name}
                            </div>
                            <div className="text-[10px] text-slate-500">{u.email}</div>
                          </td>
                          <td className="py-1.5 pr-3 text-slate-400">{u.plan ?? '—'}</td>
                          <td className="py-1.5 pr-3">
                            {st ? <Pill tone={stTone}>{st}</Pill> : <span className="text-slate-600">—</span>}
                          </td>
                          <td className="py-1.5 pr-3 text-right font-mono text-slate-300">{u.mrrUsd > 0 ? usd(u.mrrUsd) : '—'}</td>
                          <td className="py-1.5 pr-3 text-right font-mono text-slate-400">{u.usageMtdUsd > 0 ? usd(u.usageMtdUsd) : '—'}</td>
                          <td className="py-1.5 pr-3 text-right font-mono text-emerald-400">{usd(u.lifetimeRevenueUsd)}</td>
                          <td className="py-1.5 pr-3 text-right font-mono text-amber-400">{u.creditsGrantedUsd > 0 ? usd(u.creditsGrantedUsd) : '—'}</td>
                          <td className={`py-1.5 text-right font-mono ${u.netLifetimeUsd >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>{usd(u.netLifetimeUsd)}</td>
                        </tr>
                      );
                    })}
                    {(!bu || bu.users.length === 0) && (
                      <tr>
                        <td colSpan={8} className="py-6 text-center text-slate-500">
                          {buErr ? 'Failed to load users.' : 'No users with economic activity yet.'}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          {bu?.notes && bu.notes.length > 0 && (
            <Card className="border-slate-700/60 bg-slate-950/40">
              <CardContent className="pt-5">
                <div className="mb-1 text-[11px] uppercase tracking-widest text-slate-500">Diagnostics</div>
                <ul className="space-y-0.5 text-xs text-slate-500">
                  {bu.notes.map((n, i) => (
                    <li key={i}>· {n}</li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="forecast" className="space-y-6">
          {/* Forecast command deck */}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatTile
              icon={Telescope}
              label="Proj. revenue (EOM)"
              value={usd(fcast?.projectedRevenueUsd)}
              sub="month-end captured run-rate"
              tone={!fcast?.projectedRevenueUsd ? 'muted' : 'ok'}
            />
            <StatTile
              icon={(fcast?.projectedOpProfitUsd ?? 0) >= 0 ? TrendingUp : TrendingDown}
              label="Proj. op. profit (EOM)"
              value={usd(fcast?.projectedOpProfitUsd)}
              sub="after fees, COGS & credits"
              tone={fcast?.projectedOpProfitUsd == null ? 'muted' : fcast.projectedOpProfitUsd >= 0 ? 'ok' : 'alarm'}
            />
            <StatTile
              icon={ArrowUpRight}
              label="Next-month MRR"
              value={usd(fcast?.nextMonthMrrUsd)}
              sub={fcast ? `${usd0(fcast.activeMrrUsd)} active ${fcast.netNewMrrUsd >= 0 ? '+' : ''}${usd0(fcast.netNewMrrUsd)} net` : 'active + net-new'}
              tone={!fcast?.available ? 'muted' : (fcast.netNewMrrUsd ?? 0) >= 0 ? 'ok' : 'warn'}
            />
            <StatTile
              icon={ShieldAlert}
              label="Revenue at risk"
              value={usd(atRisk?.totalAtRiskMrrUsd)}
              sub={atRisk ? `${atRisk.dunningCount} dunning · ${atRisk.cancelScheduledCount} cancelling` : 'MRR'}
              tone={!atRisk?.available ? 'muted' : (atRisk.totalAtRiskMrrUsd ?? 0) > 0 ? 'alarm' : 'ok'}
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            {/* Forecast detail */}
            <GlowCard title="Forecast" icon={Telescope} tone={!fcast?.available ? 'muted' : 'ok'}>
              <Row label="Active MRR" value={usd(fcast?.activeMrrUsd)} tone="ok" />
              <Row label="ARR run-rate" value={usd(fcast?.arrUsd)} tone="ok" />
              <Row label="Net-new MRR (this month)" value={usd(fcast?.netNewMrrUsd)} tone={(fcast?.netNewMrrUsd ?? 0) >= 0 ? 'ok' : 'alarm'} />
              <Row label="Next-month MRR (pace)" value={usd(fcast?.nextMonthMrrUsd)} tone="ok" strong />
              <Row label="Projected revenue (EOM)" value={usd(fcast?.projectedRevenueUsd)} />
              <Row label="Projected COGS (EOM)" value={usd(fcast?.projectedCogsUsd)} tone="warn" />
              <Row label="Projected op. profit (EOM)" value={usd(fcast?.projectedOpProfitUsd)} tone={(fcast?.projectedOpProfitUsd ?? 0) >= 0 ? 'ok' : 'alarm'} strong />
              <p className="mt-2 text-[11px] text-slate-500">
                EOM = end-of-month projection from current pace. Next-month MRR extrapolates this month's net movement.
              </p>
            </GlowCard>

            {/* Anomaly alerts */}
            <GlowCard
              title="Anomaly alerts — month over month"
              icon={Siren}
              tone={(fc?.anomalies ?? []).some((a) => a.severity === 'alarm') ? 'alarm' : (fc?.anomalies ?? []).some((a) => a.severity === 'warn') ? 'warn' : 'ok'}
            >
              <div className="space-y-2">
                {(fc?.anomalies ?? []).map((a) => (
                  <div
                    key={a.metric}
                    className={`rounded-lg border px-3 py-2 ${toneRing[a.severity]}`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-slate-200">{a.metric}</span>
                      <span className={`font-mono text-xs ${toneText[a.severity]}`}>
                        {a.changePct == null ? '—' : `${a.changePct >= 0 ? '+' : ''}${a.changePct}%`}
                      </span>
                    </div>
                    <div className="mt-0.5 text-[11px] text-slate-400">{a.note}</div>
                  </div>
                ))}
                {(!fc || fc.anomalies.length === 0) && (
                  <div className="py-4 text-center text-xs text-slate-500">No series available for anomaly detection.</div>
                )}
              </div>
              <p className="mt-2 text-[11px] text-slate-500">
                Compares this month's projected pace vs last month's actual. ▲/▼ ≥40% = watch, ≥80% = alarm.
              </p>
            </GlowCard>
          </div>

          {/* Revenue at risk — dunning book */}
          <Card className="bg-slate-950/60 backdrop-blur border-slate-700/60">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-sm font-semibold tracking-wide text-slate-200">
                <ShieldAlert className="h-4 w-4 text-rose-400" />
                Revenue at risk — dunning &amp; cancellations
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="mb-3 flex flex-wrap gap-4 text-xs">
                <span className="text-slate-400">
                  Failing payment: <span className="font-mono text-rose-400">{usd(atRisk?.dunningMrrUsd)}</span> ({atRisk?.dunningCount ?? 0})
                </span>
                <span className="text-slate-400">
                  Cancel scheduled: <span className="font-mono text-amber-400">{usd(atRisk?.cancelScheduledMrrUsd)}</span> ({atRisk?.cancelScheduledCount ?? 0})
                </span>
                <span className="text-slate-400">
                  Total at risk: <span className="font-mono text-rose-400">{usd(atRisk?.totalAtRiskMrrUsd)}</span>
                </span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-slate-700/60 text-left text-slate-500">
                      <th className="py-1.5 pr-3 font-medium">User</th>
                      <th className="py-1.5 pr-3 font-medium">Reason</th>
                      <th className="py-1.5 pr-3 font-medium">Status</th>
                      <th className="py-1.5 text-right font-medium">MRR at risk</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(atRisk?.accounts ?? []).map((a) => (
                      <tr key={a.contractorId} className="border-b border-slate-800/40">
                        <td className="py-1.5 pr-3">
                          <div className="text-slate-200">{a.name}</div>
                          <div className="text-[10px] text-slate-500">{a.email}</div>
                        </td>
                        <td className="py-1.5 pr-3">
                          <Pill tone={a.reason === 'dunning' ? 'alarm' : 'warn'}>
                            {a.reason === 'dunning' ? 'payment failing' : 'cancelling'}
                          </Pill>
                        </td>
                        <td className="py-1.5 pr-3 text-slate-400">{a.status}</td>
                        <td className={`py-1.5 text-right font-mono ${a.reason === 'dunning' ? 'text-rose-400' : 'text-amber-400'}`}>{usd(a.mrrUsd)}</td>
                      </tr>
                    ))}
                    {(!atRisk || atRisk.accounts.length === 0) && (
                      <tr>
                        <td colSpan={4} className="py-6 text-center text-slate-500">
                          {atRisk?.available === false ? atRisk.note || 'Subscriptions unavailable.' : 'No revenue at risk — clean book.'}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              {(atRisk?.dunningMrrUsd ?? 0) > 0 && (
                <ActionHint tone="alarm">
                  <div>
                    <strong>{usd(atRisk?.dunningMrrUsd)}</strong> of MRR has a failing payment. Trigger dunning / update the
                    card before Stripe auto-cancels the subscription.
                  </div>
                </ActionHint>
              )}
            </CardContent>
          </Card>

          {fc?.notes && fc.notes.length > 0 && (
            <Card className="border-slate-700/60 bg-slate-950/40">
              <CardContent className="pt-5">
                <div className="mb-1 text-[11px] uppercase tracking-widest text-slate-500">Diagnostics</div>
                <ul className="space-y-0.5 text-xs text-slate-500">
                  {fc.notes.map((n, i) => (
                    <li key={i}>· {n}</li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>

      {fin?.notes && fin.notes.length > 0 && (
        <Card className="border-slate-700/60 bg-slate-950/40">
          <CardContent className="pt-5">
            <div className="mb-1 text-[11px] uppercase tracking-widest text-slate-500">Diagnostics</div>
            <ul className="space-y-0.5 text-xs text-slate-500">
              {fin.notes.map((n, i) => (
                <li key={i}>· {n}</li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <div className="text-right text-[11px] text-slate-600">
        {fin ? `Updated ${new Date(fin.generatedAt).toLocaleTimeString()}` : ''}
      </div>
    </div>
  );
}
