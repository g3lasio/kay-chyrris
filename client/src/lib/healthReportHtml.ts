// Mirrors server/services/leadprime-health-report.ts → HealthReport.
// Builds a self-contained, print-friendly HTML document for the System Health page.

export type ReportRange = 'week' | 'month' | 'quarter';

export interface HealthReportData {
  generatedAt: string;
  range: ReportRange;
  periodLabel: string;
  periodStart: string;
  daysTotal: number;
  daysElapsed: number;
  neon: {
    available: boolean;
    note?: string;
    capped: boolean;
    daysCovered: number;
    computeHours: number;
    costUsd: number;
    costPerCuHour: number;
    alwaysOnDays: number;
    monthCostUsd: number;
    projectedMonthCostUsd: number;
    days: { date: string; activeHours: number; computeHours: number; alwaysOn: boolean }[];
    riskVerdict?: { level: 'low' | 'elevated' | 'high' | 'unknown'; reason: string };
  };
  costPerUser: {
    available: boolean;
    note?: string;
    totalUsers: number;
    activeUsers30d: number;
    cuHoursPerActiveUser: number;
    severity: string;
  };
  pollers: {
    available: boolean;
    autosuspendMinutes: number;
    keepingComputeAwake: number;
    workers: {
      workerName: string;
      observedIntervalMs: number | null;
      configuredIntervalMs: number | null;
      lastRunAt: string | null;
      totalRuns: number;
      keepsComputeAwake: boolean;
      observedReliable: boolean;
      lastError: string | null;
    }[];
  };
  liveActivity: {
    available: boolean;
    note?: string;
    totalConnections: number;
    activeConnections: number;
    idleInTransaction: number;
    longestActiveSeconds: number | null;
  };
  hotQueries: {
    available: boolean;
    statsResetAt: string | null;
    rows: { query: string; calls: number; meanExecMs: number; callsPerMin: number | null }[];
  };
  serviceSpend: {
    available: boolean;
    monthSpendUsd: number;
    billedToUsersUsd: number;
    marginUsd: number;
    marginPct: number | null;
    providers: {
      provider: string;
      label: string;
      available: boolean;
      monthSpendUsd: number | null;
      billedToUsersUsd: number;
      marginUsd: number | null;
      severity: string;
      paymentIssue: boolean;
      keyIssue: boolean;
      note?: string;
    }[];
  };
  billing: {
    available: boolean;
    negativeBalances: number;
    unchargedUsage24h: number;
    unchargedUsdApprox: number;
    reconcileFailures: number;
    retryQueueBacklog: number;
    reconciled7dUsd: number;
    leaksDetected: number;
  };
  notes: string[];
}

const esc = (s: unknown) =>
  String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string)
  );
const usd = (n: number) =>
  (n < 0 ? '-$' : '$') + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const ms = (n: number | null) => (n == null ? '—' : n >= 1000 ? `${(n / 1000).toFixed(1)}s` : `${Math.round(n)}ms`);

function fmtDateTime(iso: string) {
  try {
    return new Date(iso).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
  } catch {
    return iso;
  }
}

function kpiCard(label: string, value: string, sub?: string, tone?: 'pos' | 'neg' | 'warn') {
  const color = tone === 'pos' ? '#047857' : tone === 'neg' ? '#b91c1c' : tone === 'warn' ? '#b45309' : '#0f172a';
  return `<div class="kpi"><div class="kpi-label">${esc(label)}</div><div class="kpi-value" style="color:${color}">${esc(value)}</div>${sub ? `<div class="kpi-sub">${esc(sub)}</div>` : ''}</div>`;
}

export function buildHealthReportHtml(r: HealthReportData): string {
  const rangeWord = r.range === 'week' ? 'Weekly' : r.range === 'quarter' ? 'Quarterly' : 'Monthly';
  const leaksTone = r.billing.leaksDetected > 0 ? 'neg' : 'pos';
  const pollersTone = r.pollers.keepingComputeAwake > 0 ? 'warn' : 'pos';
  const neonRisk = r.neon.riskVerdict?.level;
  const neonTone: 'pos' | 'neg' | 'warn' = r.neon.available
    ? 'warn'
    : neonRisk === 'high'
      ? 'neg'
      : neonRisk === 'low'
        ? 'pos'
        : 'warn';
  const cpuSev = r.costPerUser.severity;
  const cpuTone = cpuSev === 'alarm' ? 'neg' : cpuSev === 'watch' ? 'warn' : 'pos';

  const neonRows = r.neon.days
    .map(
      (d) => `<tr>
        <td>${esc(d.date)}</td>
        <td class="num">${d.activeHours}h</td>
        <td class="num">${d.computeHours}</td>
        <td>${d.alwaysOn ? '<span class="tag warn">always-on</span>' : '<span class="tag ok">suspends</span>'}</td>
      </tr>`
    )
    .join('');

  const workerRows = r.pollers.workers
    .map(
      (w) => `<tr>
        <td>${esc(w.workerName)}</td>
        <td class="num">${w.observedIntervalMs != null ? Math.round(w.observedIntervalMs / 1000) + 's' + (w.observedReliable ? '' : ' <span class="tag gray">burst</span>') : '—'}</td>
        <td class="num">${w.configuredIntervalMs != null ? Math.round(w.configuredIntervalMs / 1000) + 's' : '—'}</td>
        <td class="num">${w.totalRuns.toLocaleString('en-US')}</td>
        <td>${w.keepsComputeAwake ? '<span class="tag warn">keeps awake</span>' : '<span class="tag ok">ok</span>'}</td>
        <td>${w.lastError ? `<span class="tag neg">${esc(w.lastError.slice(0, 40))}</span>` : '—'}</td>
      </tr>`
    )
    .join('');

  const providerRows = r.serviceSpend.providers
    .map((p) => {
      const belowCost = p.available && p.marginUsd != null && p.marginUsd < 0;
      const status = p.keyIssue
        ? '<span class="tag neg">key rejected</span>'
        : p.paymentIssue
          ? '<span class="tag neg">payment issue</span>'
          : belowCost
            ? '<span class="tag warn">below cost</span>'
            : p.available
              ? '<span class="tag ok">ok</span>'
              : '<span class="tag gray">off</span>';
      return `<tr>
        <td>${esc(p.label)}</td>
        <td class="num">${p.monthSpendUsd != null ? usd(p.monthSpendUsd) : '—'}</td>
        <td class="num">${usd(p.billedToUsersUsd)}</td>
        <td class="num">${p.marginUsd != null ? usd(p.marginUsd) : '—'}</td>
        <td>${status}</td>
      </tr>`;
    })
    .join('');

  const hotRows = r.hotQueries.rows
    .map(
      (q) => `<tr>
        <td><code>${esc(q.query)}</code></td>
        <td class="num">${q.calls.toLocaleString('en-US')}</td>
        <td class="num">${ms(q.meanExecMs)}</td>
        <td class="num">${q.callsPerMin != null ? q.callsPerMin.toFixed(1) : '—'}</td>
      </tr>`
    )
    .join('');

  const notesBlock = r.notes.length
    ? `<div class="notes"><strong>Detector notes</strong><ul>${r.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul></div>`
    : '';

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>LeadPrime ${rangeWord} System Health Report — ${esc(r.periodLabel)}</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
    color: #0f172a; background: #f8fafc; margin: 0; padding: 32px; line-height: 1.45; }
  .wrap { max-width: 960px; margin: 0 auto; }
  header { border-bottom: 3px solid #6366f1; padding-bottom: 16px; margin-bottom: 24px; }
  h1 { font-size: 22px; margin: 0 0 4px; }
  h2 { font-size: 15px; text-transform: uppercase; letter-spacing: .04em; color: #334155;
    margin: 28px 0 10px; border-bottom: 1px solid #e2e8f0; padding-bottom: 6px; }
  .muted { color: #64748b; font-size: 13px; }
  .meta { display: flex; flex-wrap: wrap; gap: 6px 18px; margin-top: 8px; font-size: 12px; color: #475569; }
  .badge { display: inline-block; background: #eef2ff; color: #4338ca; border: 1px solid #c7d2fe;
    border-radius: 999px; padding: 2px 10px; font-size: 11px; font-weight: 600; }
  .kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin: 8px 0 4px; }
  .kpi { background: #fff; border: 1px solid #e2e8f0; border-radius: 10px; padding: 12px 14px; }
  .kpi-label { font-size: 11px; text-transform: uppercase; letter-spacing: .03em; color: #64748b; }
  .kpi-value { font-size: 20px; font-weight: 700; margin-top: 4px; }
  .kpi-sub { font-size: 11px; color: #94a3b8; margin-top: 2px; }
  table { width: 100%; border-collapse: collapse; background: #fff; border: 1px solid #e2e8f0;
    border-radius: 10px; overflow: hidden; font-size: 13px; }
  th, td { text-align: left; padding: 8px 12px; border-bottom: 1px solid #f1f5f9; vertical-align: top; }
  th { background: #f8fafc; font-size: 11px; text-transform: uppercase; letter-spacing: .03em; color: #64748b; }
  td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
  tr:last-child td { border-bottom: none; }
  code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px; color: #334155; }
  .tag { display: inline-block; border-radius: 6px; padding: 1px 7px; font-size: 11px; font-weight: 600; }
  .tag.ok { background: #ecfdf5; color: #047857; }
  .tag.warn { background: #fffbeb; color: #b45309; }
  .tag.neg { background: #fef2f2; color: #b91c1c; }
  .tag.gray { background: #f1f5f9; color: #64748b; }
  .notes { margin-top: 24px; background: #fffbeb; border: 1px solid #fde68a; border-radius: 10px;
    padding: 12px 16px; font-size: 12px; color: #92400e; }
  .notes ul { margin: 6px 0 0; padding-left: 18px; }
  .est { color: #b45309; font-size: 11px; }
  footer { margin-top: 32px; padding-top: 12px; border-top: 1px solid #e2e8f0; font-size: 11px; color: #94a3b8; }
  @media print { body { padding: 0; background: #fff; } .kpi, table { break-inside: avoid; } h2 { break-after: avoid; } }
</style></head>
<body><div class="wrap">
  <header>
    <h1>LeadPrime — ${rangeWord} System Health Report</h1>
    <div class="muted">${esc(r.periodLabel)} · since ${esc(r.periodStart)}</div>
    <div class="meta">
      <span><span class="badge">${esc(r.daysElapsed)} of ${esc(r.daysTotal)} days</span></span>
      <span>Generated ${fmtDateTime(r.generatedAt)}</span>
    </div>
  </header>

  <h2>Health at a glance</h2>
  <div class="kpis">
    ${kpiCard('Neon compute cost', r.neon.available ? usd(r.neon.costUsd) : neonRisk ? `risk: ${neonRisk}` : 'n/a', r.neon.available ? `${r.neon.daysCovered} days · ${r.neon.computeHours} CU-h` : neonRisk ? 'API plan-gated' : r.neon.note, neonTone)}
    ${kpiCard('Billing leaks', String(r.billing.leaksDetected), r.billing.available ? 'detected' : 'detector off', leaksTone)}
    ${kpiCard('Pollers 24/7', String(r.pollers.keepingComputeAwake), `of ${r.pollers.workers.length} workers`, pollersTone)}
    ${kpiCard('Service margin', r.serviceSpend.available ? usd(r.serviceSpend.marginUsd) : 'n/a', r.serviceSpend.marginPct != null ? `${r.serviceSpend.marginPct}%` : undefined, r.serviceSpend.marginUsd >= 0 ? 'pos' : 'neg')}
  </div>

  <h2>Neon compute consumption (${esc(r.periodLabel)})</h2>
  ${
    r.neon.available
      ? `<div class="kpis">
          ${kpiCard('Compute', `${r.neon.computeHours} CU-h`, `@ $${r.neon.costPerCuHour}/CU-h`)}
          ${kpiCard('Period cost', usd(r.neon.costUsd))}
          ${kpiCard('Always-on days', String(r.neon.alwaysOnDays), 'never suspended', r.neon.alwaysOnDays > 0 ? 'warn' : 'pos')}
          ${kpiCard('Month-to-date', usd(r.neon.monthCostUsd), `proj ${usd(r.neon.projectedMonthCostUsd)}`)}
        </div>
        ${r.neon.capped ? '<p class="est">Window truncated to Neon&#39;s ~30-day retention.</p>' : ''}
        ${r.neon.days.length ? `<table style="margin-top:12px"><thead><tr><th>Date</th><th class="num">Active</th><th class="num">CU-hours</th><th>Suspend?</th></tr></thead><tbody>${neonRows}</tbody></table>` : ''}`
      : `<p class="muted">Consumption API unavailable — ${esc(r.neon.note || 'set NEON_API_KEY + NEON_PROJECT_ID')}</p>
        ${
          r.neon.riskVerdict
            ? `<div class="kpis"><div class="kpi"><div class="kpi-label">Runaway-cost risk (from worker cadence)</div><div class="kpi-value" style="color:${neonTone === 'neg' ? '#b91c1c' : neonTone === 'pos' ? '#047857' : '#b45309'}">${esc(r.neon.riskVerdict.level)}</div><div class="kpi-sub">${esc(r.neon.riskVerdict.reason)}</div></div></div>`
            : ''
        }`
  }

  <h2>Cost per active user</h2>
  ${
    r.costPerUser.available
      ? `<div class="kpis">
          ${kpiCard('Total users', String(r.costPerUser.totalUsers))}
          ${kpiCard('Active (30d)', String(r.costPerUser.activeUsers30d))}
          ${kpiCard('CU-h / active user', String(r.costPerUser.cuHoursPerActiveUser), undefined, cpuTone)}
          ${kpiCard('Severity', cpuSev, undefined, cpuTone)}
        </div>`
      : `<p class="muted">Unavailable — ${esc(r.costPerUser.note || 'no data')}</p>`
  }

  <h2>Workers / pollers (snapshot · auto-suspend ${esc(r.pollers.autosuspendMinutes)} min)</h2>
  ${
    r.pollers.available && r.pollers.workers.length
      ? `<table><thead><tr><th>Worker</th><th class="num">Observed</th><th class="num">Configured</th><th class="num">Runs</th><th>Compute</th><th>Last error</th></tr></thead><tbody>${workerRows}</tbody></table>`
      : `<p class="muted">No worker heartbeats — the LeadPrime backend writes <code>worker_runs</code>; deploy PR with heartbeats to populate.</p>`
  }

  <h2>Live database activity (snapshot)</h2>
  ${
    r.liveActivity.available
      ? `<div class="kpis">
          ${kpiCard('Connections', String(r.liveActivity.totalConnections))}
          ${kpiCard('Active', String(r.liveActivity.activeConnections))}
          ${kpiCard('Idle in txn', String(r.liveActivity.idleInTransaction), undefined, r.liveActivity.idleInTransaction > 0 ? 'warn' : 'pos')}
          ${kpiCard('Longest query', r.liveActivity.longestActiveSeconds != null ? `${r.liveActivity.longestActiveSeconds}s` : '—')}
        </div>`
      : `<p class="muted">Unavailable — ${esc(r.liveActivity.note || 'no data')}</p>`
  }

  ${
    r.hotQueries.available && r.hotQueries.rows.length
      ? `<h2>Hot queries (pg_stat_statements)</h2><table><thead><tr><th>Query</th><th class="num">Calls</th><th class="num">Mean</th><th class="num">Calls/min</th></tr></thead><tbody>${hotRows}</tbody></table>`
      : ''
  }

  <h2>Provider spend &amp; margins</h2>
  ${
    r.serviceSpend.available
      ? `<table><thead><tr><th>Provider</th><th class="num">Month spend</th><th class="num">Billed to users</th><th class="num">Margin</th><th>Status</th></tr></thead><tbody>${providerRows}
          <tr class="pnl-total"><td><strong>Total</strong></td><td class="num"><strong>${usd(r.serviceSpend.monthSpendUsd)}</strong></td><td class="num"><strong>${usd(r.serviceSpend.billedToUsersUsd)}</strong></td><td class="num"><strong>${usd(r.serviceSpend.marginUsd)}</strong></td><td>${r.serviceSpend.marginPct != null ? r.serviceSpend.marginPct + '%' : ''}</td></tr>
        </tbody></table>`
      : `<p class="muted">Unavailable — set provider keys (ANTHROPIC_ADMIN_KEY, OPENAI_ADMIN_KEY, TWILIO_*, ELEVENLABS_API_KEY).</p>`
  }

  <h2>Billing leak detectors (snapshot)</h2>
  ${
    r.billing.available
      ? `<div class="kpis">
          ${kpiCard('Negative balances', String(r.billing.negativeBalances), undefined, r.billing.negativeBalances > 0 ? 'neg' : 'pos')}
          ${kpiCard('Uncharged 24h', String(r.billing.unchargedUsage24h), `~${usd(r.billing.unchargedUsdApprox)}`, r.billing.unchargedUsage24h > 0 ? 'warn' : 'pos')}
          ${kpiCard('Reconcile failures', String(r.billing.reconcileFailures), undefined, r.billing.reconcileFailures > 0 ? 'neg' : 'pos')}
          ${kpiCard('Retry backlog', String(r.billing.retryQueueBacklog), `reconciled 7d ${usd(r.billing.reconciled7dUsd)}`, r.billing.retryQueueBacklog > 0 ? 'warn' : 'pos')}
        </div>`
      : `<p class="muted">Unavailable — billing tables not reachable.</p>`
  }

  ${notesBlock}

  <footer>
    LeadPrime System Health — read-only report. Neon consumption is period-bounded (capped at ~30-day retention);
    all other detectors (pollers, live activity, hot queries, billing leaks) are point-in-time as of ${fmtDateTime(r.generatedAt)}.
  </footer>
</div></body></html>`;
}
