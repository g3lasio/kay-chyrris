import { trpc } from '@/lib/trpc';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
  const financeQ = trpc.leadprime.financeOverview.useQuery(undefined, { refetchInterval: 120000 });
  const fin = financeQ.data?.data as FinanceOverview | null | undefined;
  const finErr = financeQ.data?.success === false ? financeQ.data?.error : null;
  const loading = financeQ.isFetching;

  const pnl = fin?.pnl;
  const opProfit = pnl?.operatingProfitUsd ?? 0;
  const opTone: Tone = !fin ? 'muted' : opProfit > 0 ? 'ok' : opProfit < 0 ? 'alarm' : 'warn';
  const grossTone: Tone = !fin ? 'muted' : (pnl?.grossRevenueUsd ?? 0) > 0 ? 'ok' : 'muted';
  const cogsTone: Tone = !fin?.cogs.available ? 'muted' : 'warn';
  const mrrTone: Tone = !fin?.recurring.available ? 'muted' : (fin.recurring.mrrUsd > 0 ? 'ok' : 'muted');
  const creditsTone: Tone = !fin?.freeCredits.available ? 'muted' : (fin.freeCredits.totalUsd > 0 ? 'warn' : 'ok');

  const noStripe = fin?.stripeKeySource == null;
  const wf = fin ? buildWaterfall(fin.waterfall) : [];

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
          <Button variant="outline" size="sm" onClick={() => financeQ.refetch()} disabled={loading}>
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
