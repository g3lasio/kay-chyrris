/**
 * LeadPrime Finance — Period Report (week / month / quarter) — Chyrris KAI Admin Panel
 *
 * READ-ONLY. Produces one self-contained, period-accurate financial snapshot the
 * founder can export to HTML/PDF and hand to the team ("para no perder nada").
 *
 * Unlike the live dashboard (which is month-to-date), this report bounds EVERY
 * money query to a chosen window:
 *   - week    → from the most recent Monday 00:00 UTC
 *   - month   → from the 1st of the current month
 *   - quarter → from the first day of the current calendar quarter
 * The same [start, now] bounds drive both Stripe (`created>startUnix`) and SQL
 * (`created_at >= $1`) so the numbers reconcile.
 *
 * Reuses the dashboard's shared primitives (Stripe client, LeadPrime pool, fee
 * constants, the event_type→service map) from `leadprime-finance.ts` — no second
 * DB pool, no duplicated mappings. Every section degrades gracefully with a note.
 *
 * COGS honesty: provider/Neon spend APIs are month-scoped (MTD). For `month` the
 * report uses the live MTD figure as-is; for `week`/`quarter` it prorates the MTD
 * run-rate to the window and flags it as an estimate.
 */

import {
  getStripe,
  getStripeKeySource,
  getLeadPrimePool,
  sumLeadPrimeCharges,
  FEE_PCT,
  FEE_FIXED,
  round,
  isMissingSchema,
  metaFor,
  FREE_CREDIT_TYPES,
  REAL_CAC_TYPES,
  PLAN_PRICE_CENTS_SQL,
  type Category,
} from './leadprime-finance';

export type ReportRange = 'week' | 'month' | 'quarter';

const REAL_CAC_SET = new Set(REAL_CAC_TYPES);

// ── Period bounds (UTC) ──────────────────────────────────────────────────────────

interface Period {
  range: ReportRange;
  label: string;
  start: Date;
  end: Date;
  startUnix: number;
  daysElapsed: number;
  daysTotal: number;
}

function periodFor(range: ReportRange): Period {
  const now = new Date();
  let start: Date;
  let daysTotal: number;
  let label: string;

  if (range === 'week') {
    // Most recent Monday 00:00 UTC (ISO week start).
    const dow = (now.getUTCDay() + 6) % 7; // 0 = Monday
    start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - dow));
    daysTotal = 7;
    label = 'This Week';
  } else if (range === 'quarter') {
    const qStartMonth = Math.floor(now.getUTCMonth() / 3) * 3;
    start = new Date(Date.UTC(now.getUTCFullYear(), qStartMonth, 1));
    const qEnd = new Date(Date.UTC(now.getUTCFullYear(), qStartMonth + 3, 1));
    daysTotal = Math.round((qEnd.getTime() - start.getTime()) / 86400000);
    const q = Math.floor(qStartMonth / 3) + 1;
    label = `Q${q} ${now.getUTCFullYear()}`;
  } else {
    start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    daysTotal = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();
    label = now.toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  }

  const daysElapsed = Math.max(0.5, (now.getTime() - start.getTime()) / 86400000);
  return {
    range,
    label,
    start,
    end: now,
    startUnix: Math.floor(start.getTime() / 1000),
    daysElapsed,
    daysTotal,
  };
}

function projectTo(period: Period, soFar: number): number {
  return round((soFar / period.daysElapsed) * period.daysTotal);
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ReportLine {
  key: string;
  label: string;
  category: Category;
  provider: string;
  billedUsd: number;
  events: number;
  contractors: number;
  sharePct: number;
}

export interface FinanceReport {
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
    byProduct: ReportLine[];
    byCategory: { category: Category; billedUsd: number; sharePct: number }[];
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
    estimate: boolean; // true when prorated (week/quarter); false = actual MTD (month)
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

// ── Sections ────────────────────────────────────────────────────────────────────

async function capturedRevenue(period: Period, notes: string[]): Promise<FinanceReport['captured']> {
  const out: FinanceReport['captured'] = {
    available: false,
    grossUsd: 0,
    refundedUsd: 0,
    netUsd: 0,
    charges: 0,
    customers: 0,
    estFeesUsd: 0,
    projectedPeriodUsd: 0,
  };
  const stripe = getStripe();
  if (!stripe) {
    out.note = 'No Stripe key (LEADPRIME_STRIPE_SECRET_KEY / STRIPE_SECRET_KEY)';
    notes.push(`captured: ${out.note}`);
    return out;
  }
  try {
    // Charges don't inherit subscription metadata, so resolve LeadPrime customers
    // and sum their succeeded charges in the window (see leadprime-finance.ts).
    const { gross, refunded, count, customers } = await sumLeadPrimeCharges(stripe, period.startUnix);
    const net = gross - refunded;
    out.available = true;
    out.charges = count;
    out.customers = customers;
    out.grossUsd = round(gross);
    out.refundedUsd = round(refunded);
    out.netUsd = round(net);
    out.estFeesUsd = round(gross * FEE_PCT + count * FEE_FIXED);
    out.projectedPeriodUsd = projectTo(period, net);
    if (customers === 0) {
      out.note = 'No Stripe customers tagged metadata.product=leadprime were found';
      notes.push(`captured: ${out.note}`);
    }
  } catch (err: any) {
    out.note = `Stripe charge sum failed: ${err.message}`;
    notes.push(`captured: ${out.note}`);
  }
  return out;
}

async function usageRevenue(period: Period, notes: string[]): Promise<FinanceReport['usage']> {
  const out: FinanceReport['usage'] = {
    available: false,
    totalBilledUsd: 0,
    byProduct: [],
    byCategory: [],
  };
  const pool = getLeadPrimePool();
  try {
    const r = await pool.query(
      `SELECT event_type,
              SUM(cost)::numeric AS usd,
              COUNT(*)::int AS events,
              COUNT(DISTINCT contractor_id)::int AS contractors
         FROM usage_events
        WHERE created_at >= $1
        GROUP BY event_type`,
      [period.start.toISOString()]
    );
    let total = 0;
    const lines: ReportLine[] = [];
    for (const row of r.rows) {
      const eventType = String(row.event_type);
      const meta = metaFor(eventType);
      const billedUsd = round(Number(row.usd || 0));
      total += billedUsd;
      lines.push({
        key: eventType,
        label: meta.label,
        category: meta.category,
        provider: meta.provider,
        billedUsd,
        events: Number(row.events || 0),
        contractors: Number(row.contractors || 0),
        sharePct: 0,
      });
    }
    total = round(total);
    for (const l of lines) l.sharePct = total > 0 ? round((l.billedUsd / total) * 100, 1) : 0;
    lines.sort((a, b) => b.billedUsd - a.billedUsd);

    const catMap = new Map<Category, number>();
    for (const l of lines) catMap.set(l.category, (catMap.get(l.category) || 0) + l.billedUsd);
    const byCategory = Array.from(catMap.entries())
      .map(([category, usd]) => ({
        category,
        billedUsd: round(usd),
        sharePct: total > 0 ? round((usd / total) * 100, 1) : 0,
      }))
      .sort((a, b) => b.billedUsd - a.billedUsd);

    out.available = true;
    out.totalBilledUsd = total;
    out.byProduct = lines;
    out.byCategory = byCategory;
  } catch (err: any) {
    if (isMissingSchema(err)) out.note = 'usage_events not available';
    else out.note = err.message;
    notes.push(`usage: ${out.note}`);
  }
  return out;
}

async function freeCredits(period: Period, notes: string[]): Promise<FinanceReport['freeCredits']> {
  const out: FinanceReport['freeCredits'] = { available: false, cacUsd: 0, internalUsd: 0, totalUsd: 0, byType: [] };
  const pool = getLeadPrimePool();
  try {
    const list = FREE_CREDIT_TYPES.map((t) => `'${t}'`).join(',');
    const r = await pool.query(
      `SELECT type, SUM(amount_cents)::bigint AS cents
         FROM wallet_transactions
        WHERE amount_cents > 0
          AND created_at >= $1
          AND type IN (${list})
        GROUP BY type
        ORDER BY cents DESC`,
      [period.start.toISOString()]
    );
    let cac = 0;
    let internal = 0;
    const byType: { type: string; usd: number; cac: boolean }[] = [];
    for (const row of r.rows) {
      const type = String(row.type);
      const usd = Number(row.cents || 0) / 100;
      const isCac = REAL_CAC_SET.has(type);
      if (isCac) cac += usd;
      else internal += usd;
      byType.push({ type, usd: round(usd), cac: isCac });
    }
    out.available = true;
    out.cacUsd = round(cac);
    out.internalUsd = round(internal);
    out.totalUsd = round(cac + internal);
    out.byType = byType;
  } catch (err: any) {
    if (isMissingSchema(err)) out.note = 'wallet_transactions not available';
    else out.note = err.message;
    notes.push(`freeCredits: ${out.note}`);
  }
  return out;
}

async function subsAndRisk(
  period: Period,
  notes: string[]
): Promise<{ subscriptions: FinanceReport['subscriptions']; atRisk: FinanceReport['atRisk'] }> {
  const subscriptions: FinanceReport['subscriptions'] = {
    available: false,
    activeCount: 0,
    activeMrrUsd: 0,
    arrUsd: 0,
    newCount: 0,
    newMrrUsd: 0,
    churnedCount: 0,
    churnedMrrUsd: 0,
    netNewMrrUsd: 0,
  };
  const atRisk: FinanceReport['atRisk'] = {
    available: false,
    dunningCount: 0,
    dunningMrrUsd: 0,
    cancelScheduledCount: 0,
    cancelScheduledMrrUsd: 0,
    totalAtRiskMrrUsd: 0,
    accounts: [],
  };
  const pool = getLeadPrimePool();
  const startIso = period.start.toISOString();

  // Snapshot (active now) + new/churned bounded to the period.
  // El precio sale del CATÁLOGO del plan, igual que leadprime-mrr.ts. Sumar
  // subscriptions.base_price_cents (DEFAULT 1500) hacía valer $15/mes a TODA
  // cuenta, incluidas las Pay-As-You-Go que no pagan mensualidad — el reporte
  // exportable habría contradicho a la pantalla ya corregida.
  try {
    const r = await pool.query(
      `WITH priced AS (
         SELECT s.status, s.created_at, s.canceled_at,
                ${PLAN_PRICE_CENTS_SQL} AS price_cents
           FROM subscriptions s
           LEFT JOIN plan_definitions pd ON pd.plan_name = s.plan_name
           LEFT JOIN contractor_subscription_config csc
                  ON csc.contractor_id = s.contractor_id AND csc.enabled = true
       )
       SELECT
         COUNT(*) FILTER (WHERE status IN ('active','trialing'))                                  AS active_count,
         COALESCE(SUM(price_cents) FILTER (WHERE status IN ('active','trialing')),0)              AS active_cents,
         COUNT(*) FILTER (WHERE created_at >= $1 AND status IN ('active','trialing'))             AS new_count,
         COALESCE(SUM(price_cents) FILTER (WHERE created_at >= $1 AND status IN ('active','trialing')),0) AS new_cents,
         COUNT(*) FILTER (WHERE canceled_at >= $1)                                                AS churned_count,
         COALESCE(SUM(price_cents) FILTER (WHERE canceled_at >= $1),0)                            AS churned_cents
       FROM priced`,
      [startIso]
    );
    const row = r.rows[0] || {};
    subscriptions.available = true;
    subscriptions.activeCount = Number(row.active_count || 0);
    subscriptions.activeMrrUsd = round(Number(row.active_cents || 0) / 100);
    subscriptions.arrUsd = round(subscriptions.activeMrrUsd * 12);
    subscriptions.newCount = Number(row.new_count || 0);
    subscriptions.newMrrUsd = round(Number(row.new_cents || 0) / 100);
    subscriptions.churnedCount = Number(row.churned_count || 0);
    subscriptions.churnedMrrUsd = round(Number(row.churned_cents || 0) / 100);
    subscriptions.netNewMrrUsd = round(subscriptions.newMrrUsd - subscriptions.churnedMrrUsd);
  } catch (err: any) {
    if (isMissingSchema(err)) subscriptions.note = 'subscriptions not available';
    else subscriptions.note = err.message;
    notes.push(`subscriptions: ${subscriptions.note}`);
  }

  // At-risk book (snapshot, as of now).
  try {
    const r = await pool.query(
      `SELECT s.status, s.cancel_at_period_end, c.name, c.email,
              ${PLAN_PRICE_CENTS_SQL} AS price_cents
         FROM subscriptions s
         LEFT JOIN contractors c ON c.id = s.contractor_id
         LEFT JOIN plan_definitions pd ON pd.plan_name = s.plan_name
         LEFT JOIN contractor_subscription_config csc
                ON csc.contractor_id = s.contractor_id AND csc.enabled = true
        WHERE s.status IN ('past_due','unpaid','incomplete')
           OR (s.cancel_at_period_end = true AND s.status IN ('active','trialing'))`
    );
    const dunning = new Set(['past_due', 'unpaid', 'incomplete']);
    let dunningMrr = 0;
    let cancelMrr = 0;
    for (const row of r.rows) {
      const status = String(row.status);
      const mrrUsd = round(Number(row.price_cents || 0) / 100);
      const reason = dunning.has(status) ? 'dunning' : 'cancel_scheduled';
      if (reason === 'dunning') {
        dunningMrr += mrrUsd;
        atRisk.dunningCount += 1;
      } else {
        cancelMrr += mrrUsd;
        atRisk.cancelScheduledCount += 1;
      }
      atRisk.accounts.push({
        name: row.name ? String(row.name) : '—',
        email: row.email ? String(row.email) : '—',
        status,
        reason,
        mrrUsd,
      });
    }
    atRisk.dunningMrrUsd = round(dunningMrr);
    atRisk.cancelScheduledMrrUsd = round(cancelMrr);
    atRisk.totalAtRiskMrrUsd = round(dunningMrr + cancelMrr);
    atRisk.accounts.sort((a, b) => b.mrrUsd - a.mrrUsd);
    atRisk.available = true;
  } catch (err: any) {
    if (isMissingSchema(err)) atRisk.note = 'subscriptions not available';
    else atRisk.note = err.message;
    notes.push(`atRisk: ${atRisk.note}`);
  }

  return { subscriptions, atRisk };
}

async function periodCogs(period: Period, notes: string[]): Promise<FinanceReport['cogs']> {
  const out: FinanceReport['cogs'] = {
    available: false,
    estimate: period.range !== 'month',
    providersUsd: 0,
    infraUsd: 0,
    totalUsd: 0,
  };
  let providersMtd = 0;
  let infraMtd = 0;
  let any = false;
  // Provider/Neon APIs report month-to-date; derive a daily run-rate.
  const now = new Date();
  const mtdDays = Math.max(0.5, now.getUTCDate() - 1 + now.getUTCHours() / 24);

  try {
    const { getServiceSpend } = await import('./leadprime-service-spend');
    const spend = await getServiceSpend();
    providersMtd = round(spend.totals.monthSpendUsd);
    any = true;
  } catch (err: any) {
    notes.push(`cogs.providers: ${err.message}`);
  }
  try {
    const { getInfraHealth } = await import('./leadprime-infra-health');
    const infra = await getInfraHealth();
    if (infra.neon.available) {
      infraMtd = round(infra.neon.monthCostUsd);
      any = true;
    }
  } catch (err: any) {
    notes.push(`cogs.infra: ${err.message}`);
  }

  if (period.range === 'month') {
    out.providersUsd = providersMtd;
    out.infraUsd = infraMtd;
  } else {
    // Prorate the MTD run-rate across the report window (clamped to elapsed days).
    const span = Math.min(period.daysElapsed, period.daysTotal);
    out.providersUsd = round((providersMtd / mtdDays) * span);
    out.infraUsd = round((infraMtd / mtdDays) * span);
  }
  out.totalUsd = round(out.providersUsd + out.infraUsd);
  out.available = any;
  if (!any) out.note = 'No COGS sources available (provider keys + Neon key not set)';
  else if (out.estimate) out.note = 'Estimated: provider/Neon spend is month-scoped, prorated to this window';
  return out;
}

// ── Orchestrator ─────────────────────────────────────────────────────────────────

export async function getFinanceReport(rangeInput?: string): Promise<FinanceReport> {
  const range: ReportRange =
    rangeInput === 'week' || rangeInput === 'quarter' ? rangeInput : 'month';
  const period = periodFor(range);
  const notes: string[] = [];
  getStripe(); // prime key-source flag

  const [captured, usage, credits, sr, cogs] = await Promise.all([
    capturedRevenue(period, notes),
    usageRevenue(period, notes),
    freeCredits(period, notes),
    subsAndRisk(period, notes),
    periodCogs(period, notes),
  ]);

  const grossRevenueUsd = captured.netUsd;
  const stripeFeesUsd = captured.estFeesUsd;
  const netRevenueUsd = round(grossRevenueUsd - stripeFeesUsd);
  const cogsUsd = cogs.totalUsd;
  const grossProfitUsd = round(netRevenueUsd - cogsUsd);
  // Operating profit only absorbs real CAC give-aways; internal admin grants are a
  // memo (and consumed credits already surface as COGS — avoid double-counting).
  const freeCreditsUsd = credits.cacUsd;
  const operatingProfitUsd = round(grossProfitUsd - freeCreditsUsd);

  return {
    generatedAt: new Date().toISOString(),
    range,
    periodLabel: period.label,
    periodStart: period.start.toISOString(),
    periodEnd: period.end.toISOString(),
    daysElapsed: round(period.daysElapsed, 1),
    daysTotal: period.daysTotal,
    stripeKeySource: getStripeKeySource(),
    captured,
    usage,
    freeCredits: credits,
    subscriptions: sr.subscriptions,
    atRisk: sr.atRisk,
    cogs,
    pnl: {
      grossRevenueUsd,
      stripeFeesUsd,
      netRevenueUsd,
      cogsUsd,
      grossProfitUsd,
      grossMarginPct: netRevenueUsd > 0 ? round((grossProfitUsd / netRevenueUsd) * 100, 1) : null,
      freeCreditsUsd,
      operatingProfitUsd,
      operatingMarginPct: netRevenueUsd > 0 ? round((operatingProfitUsd / netRevenueUsd) * 100, 1) : null,
    },
    notes,
  };
}
