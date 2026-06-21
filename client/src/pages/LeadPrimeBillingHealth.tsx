import { trpc } from '@/lib/trpc';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
} from 'lucide-react';

// ── Types (mirror server/services/leadprime-billing-health.ts) ────────────────

interface Detector<T> {
  available: boolean;
  count: number;
  rows: T[];
}

interface NegativeBalance {
  contractorId: string;
  contractorName: string | null;
  contractorEmail: string | null;
  balanceCents: number;
}

interface ReconciledActivityRow {
  eventType: string;
  count: number;
  totalCents: number;
}

interface UnchargedUsageRow {
  eventType: string;
  count: number;
  totalCostCents: number;
}

interface BillingHealth {
  generatedAt: string;
  negativeBalances: Detector<NegativeBalance>;
  reconciledActivity7d: Detector<ReconciledActivityRow> & { totalCents: number };
  unchargedUsage24h: Detector<UnchargedUsageRow> & { totalCostCents: number };
  reconcileFailures: Detector<{ eventType: string; count: number; totalCostCents: number }>;
  retryQueueBacklog: Detector<{ status: string; count: number; totalCents: number }>;
  notes: string[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function money(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function StatusBadge({ ok, label }: { ok: boolean; label?: string }) {
  if (ok) {
    return (
      <Badge className="bg-green-500/20 text-green-400 border-green-500/30">
        <CheckCircle2 className="h-3 w-3 mr-1" />
        {label ?? 'Healthy'}
      </Badge>
    );
  }
  return (
    <Badge className="bg-red-500/20 text-red-400 border-red-500/30">
      <AlertTriangle className="h-3 w-3 mr-1" />
      {label ?? 'Attention'}
    </Badge>
  );
}

function UnavailableBadge() {
  return (
    <Badge variant="outline" className="text-muted-foreground border-muted-foreground/40">
      Unavailable
    </Badge>
  );
}

// ── Page ────────────────────────────────────────────────────────────────────

export default function LeadPrimeBillingHealth() {
  const healthQuery = trpc.leadprime.billingHealth.useQuery(undefined, {
    refetchInterval: 60000,
  });

  const data = healthQuery.data?.data as BillingHealth | null | undefined;
  const apiError = healthQuery.data?.success === false ? healthQuery.data?.error : null;

  const negCount = data?.negativeBalances.count ?? 0;
  const unchargedCount = data?.unchargedUsage24h.count ?? 0;
  const unchargedCents = data?.unchargedUsage24h.totalCostCents ?? 0;
  const reconciledCount = data?.reconciledActivity7d.count ?? 0;
  const reconciledCents = data?.reconciledActivity7d.totalCents ?? 0;
  const failuresCount = data?.reconcileFailures.count ?? 0;
  const retryCount = data?.retryQueueBacklog.count ?? 0;

  const allHealthy =
    !!data &&
    negCount === 0 &&
    unchargedCount === 0 &&
    failuresCount === 0 &&
    retryCount === 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <ShieldCheck className="h-6 w-6 text-primary" />
            Billing Health
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Read-only monitor over the LeadPrime 2-layer billing protection.
            Surfaces money leaks, double-charges, and retry backlog. Never moves money.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => healthQuery.refetch()}
          disabled={healthQuery.isFetching}
        >
          <RefreshCw className={`h-4 w-4 mr-2 ${healthQuery.isFetching ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      {apiError && (
        <Card className="border-red-500/40">
          <CardContent className="pt-6 text-red-400 flex items-center gap-2">
            <AlertTriangle className="h-4 w-4" />
            Failed to load billing health: {apiError}
          </CardContent>
        </Card>
      )}

      {/* Overall status banner */}
      {data && (
        <Card className={allHealthy ? 'border-green-500/40' : 'border-yellow-500/40'}>
          <CardContent className="pt-6 flex items-center justify-between">
            <div className="flex items-center gap-3">
              {allHealthy ? (
                <CheckCircle2 className="h-6 w-6 text-green-400" />
              ) : (
                <AlertTriangle className="h-6 w-6 text-yellow-400" />
              )}
              <div>
                <p className="font-semibold">
                  {allHealthy ? 'All billing checks passing' : 'Billing anomalies detected'}
                </p>
                <p className="text-xs text-muted-foreground">
                  Generated {new Date(data.generatedAt).toLocaleString()}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Summary cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Wallet className="h-4 w-4" /> Negative Balances
            </CardTitle>
            {data ? <StatusBadge ok={negCount === 0} /> : <UnavailableBadge />}
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{negCount}</div>
            <p className="text-xs text-muted-foreground">wallets below $0</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <TrendingDown className="h-4 w-4" /> Uncharged Usage 24h
            </CardTitle>
            {data ? <StatusBadge ok={unchargedCount === 0} /> : <UnavailableBadge />}
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{money(unchargedCents)}</div>
            <p className="text-xs text-muted-foreground">{unchargedCount} events, no charge</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <RotateCcw className="h-4 w-4" /> Reconciled 7d
            </CardTitle>
            {data ? <StatusBadge ok={reconciledCount === 0} label="Layer 2 active" /> : <UnavailableBadge />}
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{money(reconciledCents)}</div>
            <p className="text-xs text-muted-foreground">{reconciledCount} retro charges</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Clock3 className="h-4 w-4" /> Retry Backlog
            </CardTitle>
            {data ? <StatusBadge ok={retryCount === 0} /> : <UnavailableBadge />}
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{retryCount}</div>
            <p className="text-xs text-muted-foreground">pending Layer-1 retries</p>
          </CardContent>
        </Card>
      </div>

      {/* Negative balances detail */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Wallet className="h-4 w-4" /> Negative Wallet Balances
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!data?.negativeBalances.available ? (
            <p className="text-sm text-muted-foreground">Detector unavailable.</p>
          ) : data.negativeBalances.rows.length === 0 ? (
            <p className="text-sm text-green-400 flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4" /> No negative balances. Atomic deduction holding.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-muted-foreground border-b border-border">
                    <th className="py-2 pr-4">Contractor</th>
                    <th className="py-2 pr-4">Email</th>
                    <th className="py-2 pr-4 text-right">Balance</th>
                  </tr>
                </thead>
                <tbody>
                  {data.negativeBalances.rows.map(r => (
                    <tr key={r.contractorId} className="border-b border-border/50">
                      <td className="py-2 pr-4">{r.contractorName ?? r.contractorId}</td>
                      <td className="py-2 pr-4 text-muted-foreground">{r.contractorEmail ?? '—'}</td>
                      <td className="py-2 pr-4 text-right text-red-400 font-mono">
                        {money(r.balanceCents)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Uncharged usage detail */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <TrendingDown className="h-4 w-4" /> Uncharged Usage (last 24h)
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!data?.unchargedUsage24h.available ? (
            <p className="text-sm text-muted-foreground">Detector unavailable.</p>
          ) : data.unchargedUsage24h.rows.length === 0 ? (
            <p className="text-sm text-green-400 flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4" /> Every billable usage event has a matching charge.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-muted-foreground border-b border-border">
                    <th className="py-2 pr-4">Event Type</th>
                    <th className="py-2 pr-4 text-right">Events</th>
                    <th className="py-2 pr-4 text-right">Unbilled Cost</th>
                  </tr>
                </thead>
                <tbody>
                  {data.unchargedUsage24h.rows.map(r => (
                    <tr key={r.eventType} className="border-b border-border/50">
                      <td className="py-2 pr-4 font-mono">{r.eventType}</td>
                      <td className="py-2 pr-4 text-right">{r.count}</td>
                      <td className="py-2 pr-4 text-right text-yellow-400 font-mono">
                        {money(r.totalCostCents)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="text-xs text-muted-foreground mt-3">
            Matched by amount (±2¢, ±5min), type-agnostic — mirrors the reconciliation
            worker. Recent events (&lt;20min) are excluded to avoid false positives while
            Layer 2 catches up.
          </p>
        </CardContent>
      </Card>

      {/* Reconciliation + failures + retry queue */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <RotateCcw className="h-4 w-4" /> Reconciled Charges (7d)
            </CardTitle>
          </CardHeader>
          <CardContent>
            {!data?.reconciledActivity7d.available ? (
              <p className="text-sm text-muted-foreground">Detector unavailable.</p>
            ) : data.reconciledActivity7d.rows.length === 0 ? (
              <p className="text-sm text-muted-foreground">No retroactive charges. Layer 1 is clean.</p>
            ) : (
              <ul className="text-sm space-y-1">
                {data.reconciledActivity7d.rows.map(r => (
                  <li key={r.eventType} className="flex justify-between">
                    <span className="font-mono text-muted-foreground">{r.eventType}</span>
                    <span>
                      {r.count} · <span className="font-mono">{money(r.totalCents)}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Ban className="h-4 w-4" /> Reconcile Failures (30d)
            </CardTitle>
          </CardHeader>
          <CardContent>
            {!data?.reconcileFailures.available ? (
              <p className="text-sm text-muted-foreground">Detector unavailable.</p>
            ) : data.reconcileFailures.rows.length === 0 ? (
              <p className="text-sm text-green-400">None — no usage stuck on insufficient funds.</p>
            ) : (
              <ul className="text-sm space-y-1">
                {data.reconcileFailures.rows.map(r => (
                  <li key={r.eventType} className="flex justify-between">
                    <span className="font-mono text-muted-foreground">{r.eventType}</span>
                    <span>
                      {r.count} · <span className="font-mono">{money(r.totalCostCents)}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Clock3 className="h-4 w-4" /> Retry Queue
            </CardTitle>
          </CardHeader>
          <CardContent>
            {!data?.retryQueueBacklog.available ? (
              <p className="text-sm text-muted-foreground">Queue table not present.</p>
            ) : data.retryQueueBacklog.rows.length === 0 ? (
              <p className="text-sm text-green-400">Empty — no pending retries.</p>
            ) : (
              <ul className="text-sm space-y-1">
                {data.retryQueueBacklog.rows.map(r => (
                  <li key={r.status} className="flex justify-between">
                    <span className="font-mono text-muted-foreground">{r.status}</span>
                    <span>
                      {r.count} · <span className="font-mono">{money(r.totalCents)}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Degradation notes */}
      {data && data.notes.length > 0 && (
        <Card className="border-muted-foreground/30">
          <CardHeader>
            <CardTitle className="text-sm text-muted-foreground">Detector Notes</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="text-xs text-muted-foreground space-y-1 list-disc pl-4">
              {data.notes.map((n, i) => (
                <li key={i}>{n}</li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
