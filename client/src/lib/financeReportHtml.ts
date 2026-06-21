// Mirrors server/services/leadprime-finance-report.ts → FinanceReport.
// Builds a self-contained, print-friendly HTML document (no external assets) the
// founder can hand to the dev/finance team or "Save as PDF".

export type ReportRange = 'week' | 'month' | 'quarter';

export interface FinanceReportData {
  generatedAt: string;
  range: ReportRange;
  periodLabel: string;
  periodStart: string;
  periodEnd: string;
  daysElapsed: number;
  daysTotal: number;
  stripeKeySource: 'leadprime' | 'shared' | null;
  captured: {
    available: boolean;
    note?: string;
    grossUsd: number;
    refundedUsd: number;
    netUsd: number;
    charges: number;
    customers: number;
    estFeesUsd: number;
    projectedPeriodUsd: number;
  };
  usage: {
    available: boolean;
    note?: string;
    totalBilledUsd: number;
    byProduct: {
      key: string;
      label: string;
      category: string;
      provider: string;
      billedUsd: number;
      events: number;
      contractors: number;
      sharePct: number;
    }[];
    byCategory: { category: string; billedUsd: number; sharePct: number }[];
  };
  freeCredits: {
    available: boolean;
    note?: string;
    cacUsd: number;
    internalUsd: number;
    totalUsd: number;
    byType: { type: string; usd: number; cac: boolean }[];
  };
  subscriptions: {
    available: boolean;
    note?: string;
    activeCount: number;
    activeMrrUsd: number;
    arrUsd: number;
    newCount: number;
    newMrrUsd: number;
    churnedCount: number;
    churnedMrrUsd: number;
    netNewMrrUsd: number;
  };
  atRisk: {
    available: boolean;
    note?: string;
    dunningCount: number;
    dunningMrrUsd: number;
    cancelScheduledCount: number;
    cancelScheduledMrrUsd: number;
    totalAtRiskMrrUsd: number;
    accounts: { name: string; email: string; status: string; reason: string; mrrUsd: number }[];
  };
  cogs: {
    available: boolean;
    note?: string;
    estimate: boolean;
    providersUsd: number;
    infraUsd: number;
    totalUsd: number;
  };
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
  notes: string[];
}

const esc = (s: unknown) =>
  String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string)
  );
const usd = (n: number) =>
  (n < 0 ? '-$' : '$') + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const usd0 = (n: number) =>
  (n < 0 ? '-$' : '$') + Math.abs(n).toLocaleString('en-US', { maximumFractionDigits: 0 });
const pct = (n: number | null) => (n == null ? '—' : `${n}%`);

function fmtDateTime(iso: string) {
  try {
    return new Date(iso).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
  } catch {
    return iso;
  }
}
function fmtDate(iso: string) {
  try {
    return new Date(iso).toLocaleDateString('en-US', { dateStyle: 'medium' });
  } catch {
    return iso;
  }
}

function kpiCard(label: string, value: string, sub?: string, tone?: 'pos' | 'neg' | 'warn') {
  const color = tone === 'pos' ? '#047857' : tone === 'neg' ? '#b91c1c' : tone === 'warn' ? '#b45309' : '#0f172a';
  return `<div class="kpi">
    <div class="kpi-label">${esc(label)}</div>
    <div class="kpi-value" style="color:${color}">${esc(value)}</div>
    ${sub ? `<div class="kpi-sub">${esc(sub)}</div>` : ''}
  </div>`;
}

export function buildFinanceReportHtml(r: FinanceReportData): string {
  const rangeWord = r.range === 'week' ? 'Weekly' : r.range === 'quarter' ? 'Quarterly' : 'Monthly';
  const opTone = r.pnl.operatingProfitUsd > 0 ? 'pos' : r.pnl.operatingProfitUsd < 0 ? 'neg' : 'warn';

  const productRows = r.usage.byProduct
    .map(
      (p) => `<tr>
        <td>${esc(p.label)}</td>
        <td>${esc(p.category)}</td>
        <td>${esc(p.provider)}</td>
        <td class="num">${usd(p.billedUsd)}</td>
        <td class="num">${p.events.toLocaleString('en-US')}</td>
        <td class="num">${p.contractors}</td>
        <td class="num">${p.sharePct}%</td>
      </tr>`
    )
    .join('');

  const categoryRows = r.usage.byCategory
    .map(
      (c) => `<tr><td>${esc(c.category)}</td><td class="num">${usd(c.billedUsd)}</td><td class="num">${c.sharePct}%</td></tr>`
    )
    .join('');

  const cacCreditRows = r.freeCredits.byType
    .filter((c) => c.cac)
    .map((c) => `<tr><td>${esc(c.type)}</td><td class="num">${usd(c.usd)}</td></tr>`)
    .join('');
  const internalCreditRows = r.freeCredits.byType
    .filter((c) => !c.cac)
    .map((c) => `<tr><td>${esc(c.type)}</td><td class="num">${usd(c.usd)}</td></tr>`)
    .join('');

  const riskRows = r.atRisk.accounts
    .map(
      (a) => `<tr>
        <td>${esc(a.name)}</td>
        <td>${esc(a.email)}</td>
        <td>${esc(a.status)}</td>
        <td>${a.reason === 'dunning' ? 'Payment failing' : 'Cancel scheduled'}</td>
        <td class="num">${usd(a.mrrUsd)}</td>
      </tr>`
    )
    .join('');

  const pnlRows = [
    ['Gross revenue (captured, net of refunds)', r.pnl.grossRevenueUsd, 'in'],
    ['Stripe processing fees (est.)', -r.pnl.stripeFeesUsd, 'out'],
    ['Net revenue', r.pnl.netRevenueUsd, 'sub'],
    [`COGS — providers + infra${r.cogs.estimate ? ' (est.)' : ''}`, -r.pnl.cogsUsd, 'out'],
    ['Gross profit', r.pnl.grossProfitUsd, 'sub'],
    ['Real CAC credits (welcome/promo/referral)', -r.pnl.freeCreditsUsd, 'out'],
    ['Operating profit', r.pnl.operatingProfitUsd, 'total'],
  ]
    .map(([label, val, kind]) => {
      const v = val as number;
      const k = kind as string;
      const cls = k === 'total' ? 'pnl-total' : k === 'sub' ? 'pnl-sub' : '';
      const color = v < 0 ? '#b91c1c' : k === 'total' ? (v >= 0 ? '#047857' : '#b91c1c') : '#0f172a';
      return `<tr class="${cls}"><td>${esc(label)}</td><td class="num" style="color:${color}">${usd(v)}</td></tr>`;
    })
    .join('');

  const notesBlock = r.notes.length
    ? `<div class="notes"><strong>Data notes</strong><ul>${r.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul></div>`
    : '';

  const keyLabel =
    r.stripeKeySource === 'leadprime'
      ? 'Dedicated LeadPrime Stripe key'
      : r.stripeKeySource === 'shared'
        ? 'Shared Stripe key (filtered to metadata.product=leadprime)'
        : 'No Stripe key configured';

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>LeadPrime ${rangeWord} Finance Report — ${esc(r.periodLabel)}</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
    color: #0f172a; background: #f8fafc; margin: 0; padding: 32px; line-height: 1.45; }
  .wrap { max-width: 960px; margin: 0 auto; }
  header { border-bottom: 3px solid #10b981; padding-bottom: 16px; margin-bottom: 24px; }
  h1 { font-size: 22px; margin: 0 0 4px; }
  h2 { font-size: 15px; text-transform: uppercase; letter-spacing: .04em; color: #334155;
    margin: 28px 0 10px; border-bottom: 1px solid #e2e8f0; padding-bottom: 6px; }
  .muted { color: #64748b; font-size: 13px; }
  .meta { display: flex; flex-wrap: wrap; gap: 6px 18px; margin-top: 8px; font-size: 12px; color: #475569; }
  .badge { display: inline-block; background: #ecfdf5; color: #047857; border: 1px solid #a7f3d0;
    border-radius: 999px; padding: 2px 10px; font-size: 11px; font-weight: 600; }
  .badge.gray { background: #f1f5f9; color: #475569; border-color: #cbd5e1; }
  .kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin: 8px 0 4px; }
  .kpi { background: #fff; border: 1px solid #e2e8f0; border-radius: 10px; padding: 12px 14px; }
  .kpi-label { font-size: 11px; text-transform: uppercase; letter-spacing: .03em; color: #64748b; }
  .kpi-value { font-size: 20px; font-weight: 700; margin-top: 4px; }
  .kpi-sub { font-size: 11px; color: #94a3b8; margin-top: 2px; }
  table { width: 100%; border-collapse: collapse; background: #fff; border: 1px solid #e2e8f0;
    border-radius: 10px; overflow: hidden; font-size: 13px; }
  th, td { text-align: left; padding: 8px 12px; border-bottom: 1px solid #f1f5f9; }
  th { background: #f8fafc; font-size: 11px; text-transform: uppercase; letter-spacing: .03em; color: #64748b; }
  td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
  tr:last-child td { border-bottom: none; }
  .pnl-total td { font-weight: 700; font-size: 14px; border-top: 2px solid #cbd5e1; background: #f8fafc; }
  .pnl-sub td { font-weight: 600; background: #fafafa; }
  .notes { margin-top: 24px; background: #fffbeb; border: 1px solid #fde68a; border-radius: 10px;
    padding: 12px 16px; font-size: 12px; color: #92400e; }
  .notes ul { margin: 6px 0 0; padding-left: 18px; }
  .est { color: #b45309; font-size: 11px; }
  footer { margin-top: 32px; padding-top: 12px; border-top: 1px solid #e2e8f0; font-size: 11px; color: #94a3b8; }
  @media print {
    body { padding: 0; background: #fff; }
    .kpi, table { break-inside: avoid; }
    h2 { break-after: avoid; }
  }
</style></head>
<body><div class="wrap">
  <header>
    <h1>LeadPrime — ${rangeWord} Finance Report</h1>
    <div class="muted">${esc(r.periodLabel)} · ${fmtDate(r.periodStart)} → ${fmtDate(r.periodEnd)}</div>
    <div class="meta">
      <span><span class="badge">${esc(r.daysElapsed)} of ${esc(r.daysTotal)} days elapsed</span></span>
      <span><span class="badge gray">${esc(keyLabel)}</span></span>
      <span>Generated ${fmtDateTime(r.generatedAt)}</span>
    </div>
  </header>

  <h2>Bottom line</h2>
  <div class="kpis">
    ${kpiCard('Operating profit', usd(r.pnl.operatingProfitUsd), `Margin ${pct(r.pnl.operatingMarginPct)}`, opTone)}
    ${kpiCard('Gross revenue', usd(r.pnl.grossRevenueUsd), `${r.captured.charges} charges`, 'pos')}
    ${kpiCard('Active MRR', usd(r.subscriptions.activeMrrUsd), `ARR ${usd0(r.subscriptions.arrUsd)}`)}
    ${kpiCard('Cost to serve', usd(r.pnl.cogsUsd), r.cogs.estimate ? 'estimated' : 'actual MTD', 'warn')}
  </div>

  <h2>Profit &amp; loss — ${esc(r.periodLabel)}</h2>
  <table><tbody>${pnlRows}</tbody></table>
  ${r.cogs.estimate ? '<p class="est">COGS is prorated from month-to-date provider/Neon spend (those APIs are month-scoped).</p>' : ''}

  <h2>Captured revenue (Stripe)</h2>
  ${
    r.captured.available
      ? `<div class="kpis">
          ${kpiCard('Gross', usd(r.captured.grossUsd))}
          ${kpiCard('Refunded', usd(r.captured.refundedUsd), undefined, r.captured.refundedUsd > 0 ? 'neg' : undefined)}
          ${kpiCard('Net captured', usd(r.captured.netUsd), `${r.captured.charges} charges · ${r.captured.customers} customers`, 'pos')}
          ${kpiCard('Projected ' + r.range, usd(r.captured.projectedPeriodUsd))}
        </div>
        <p class="est">Resolved by customer: Stripe charges don&#39;t inherit subscription metadata, so this sums succeeded charges of the ${r.captured.customers} customers tagged <code>metadata.product=leadprime</code>.</p>
        ${r.captured.customers === 0 ? '<p class="est">⚠ No tagged customers found — verify customers carry metadata.product=leadprime, or the period had no LeadPrime customers.</p>' : ''}`
      : `<p class="muted">Unavailable — ${esc(r.captured.note || 'no data')}</p>`
  }

  <h2>Usage revenue by product</h2>
  ${
    r.usage.available && r.usage.byProduct.length
      ? `<table><thead><tr><th>Product</th><th>Category</th><th>Provider</th><th class="num">Billed</th><th class="num">Events</th><th class="num">Users</th><th class="num">Share</th></tr></thead><tbody>${productRows}</tbody></table>`
      : `<p class="muted">${r.usage.available ? 'No usage in this period.' : 'Unavailable — ' + esc(r.usage.note || 'no data')}</p>`
  }

  ${
    r.usage.byCategory.length
      ? `<h2>Usage revenue by category</h2><table><thead><tr><th>Category</th><th class="num">Billed</th><th class="num">Share</th></tr></thead><tbody>${categoryRows}</tbody></table>`
      : ''
  }

  <h2>Subscription movements</h2>
  ${
    r.subscriptions.available
      ? `<div class="kpis">
          ${kpiCard('Active subs', String(r.subscriptions.activeCount), usd(r.subscriptions.activeMrrUsd) + ' MRR')}
          ${kpiCard('New this ' + r.range, '+' + r.subscriptions.newCount, '+' + usd(r.subscriptions.newMrrUsd) + ' MRR', 'pos')}
          ${kpiCard('Churned', '-' + r.subscriptions.churnedCount, '-' + usd(r.subscriptions.churnedMrrUsd) + ' MRR', r.subscriptions.churnedCount > 0 ? 'neg' : undefined)}
          ${kpiCard('Net new MRR', usd(r.subscriptions.netNewMrrUsd), undefined, r.subscriptions.netNewMrrUsd >= 0 ? 'pos' : 'neg')}
        </div>`
      : `<p class="muted">Unavailable — ${esc(r.subscriptions.note || 'no data')}</p>`
  }

  <h2>Free credits given</h2>
  ${
    r.freeCredits.available
      ? r.freeCredits.byType.length
        ? `<div class="kpis">
            ${kpiCard('Real CAC', usd(r.freeCredits.cacUsd), 'in operating profit', r.freeCredits.cacUsd > 0 ? 'warn' : 'pos')}
            ${kpiCard('Internal grants', usd(r.freeCredits.internalUsd), 'excluded from P&L')}
            ${kpiCard('Total given', usd(r.freeCredits.totalUsd))}
          </div>
          ${cacCreditRows ? `<table style="margin-top:12px"><thead><tr><th>Real CAC (welcome/promo/referral)</th><th class="num">USD</th></tr></thead><tbody>${cacCreditRows}<tr class="pnl-total"><td>CAC subtotal</td><td class="num">${usd(r.freeCredits.cacUsd)}</td></tr></tbody></table>` : ''}
          ${internalCreditRows ? `<table style="margin-top:12px"><thead><tr><th>Internal grants (admin — not CAC)</th><th class="num">USD</th></tr></thead><tbody>${internalCreditRows}<tr class="pnl-total"><td>Internal subtotal</td><td class="num">${usd(r.freeCredits.internalUsd)}</td></tr></tbody></table>` : ''}
          <p class="est">Only real CAC reduces operating profit. Internal admin grants are manual top-ups to our own / comped accounts; when any free credit is consumed its provider cost already appears under COGS, so the grant is not subtracted again.</p>`
        : `<p class="muted">No free credits granted in this period.</p>`
      : `<p class="muted">Unavailable — ${esc(r.freeCredits.note || 'no data')}</p>`
  }

  <h2>Revenue at risk (as of now)</h2>
  ${
    r.atRisk.available
      ? `<div class="kpis">
          ${kpiCard('Payment failing', usd(r.atRisk.dunningMrrUsd), r.atRisk.dunningCount + ' accounts', r.atRisk.dunningMrrUsd > 0 ? 'neg' : undefined)}
          ${kpiCard('Cancel scheduled', usd(r.atRisk.cancelScheduledMrrUsd), r.atRisk.cancelScheduledCount + ' accounts', 'warn')}
          ${kpiCard('Total at risk', usd(r.atRisk.totalAtRiskMrrUsd), 'MRR', r.atRisk.totalAtRiskMrrUsd > 0 ? 'neg' : 'pos')}
          ${kpiCard('Accounts', String(r.atRisk.accounts.length))}
        </div>
        ${riskRows ? `<table style="margin-top:12px"><thead><tr><th>Account</th><th>Email</th><th>Status</th><th>Reason</th><th class="num">MRR</th></tr></thead><tbody>${riskRows}</tbody></table>` : '<p class="muted">No at-risk accounts. 🎉</p>'}`
      : `<p class="muted">Unavailable — ${esc(r.atRisk.note || 'no data')}</p>`
  }

  ${notesBlock}

  <footer>
    LeadPrime Finance — read-only report. All figures filtered to <code>metadata.product=leadprime</code> in the shared Stripe account.
    Snapshot metrics (MRR, at-risk) are as-of generation time; period metrics cover ${fmtDate(r.periodStart)} → ${fmtDate(r.periodEnd)}.
  </footer>
</div></body></html>`;
}
