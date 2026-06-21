/**
 * LeadPrime Finance — P&L Overview — Chyrris KAI Admin Panel
 *
 * READ-ONLY. Answers the founder questions:
 *   - What revenue is LeadPrime actually capturing in Stripe this month?
 *   - What is recurring (MRR / ARR) vs one-off / usage?
 *   - What does Stripe skim in processing fees?
 *   - What does it cost me to serve it (COGS = providers + Neon infra)?
 *   - How much free credit am I giving away (CAC)?
 *   - What is left over — gross profit & margin?
 *
 * IMPORTANT — shared Stripe account:
 *   LeadPrime and OwlFenc share ONE Stripe account (the OwlFenc LLC account).
 *   LeadPrime objects are tagged `metadata.product = 'leadprime'` at creation
 *   (see backend stripeService / stripeMeteredService). Every query here filters
 *   on that tag so OwlFenc revenue is never mixed in. The Stripe client prefers a
 *   dedicated LEADPRIME_STRIPE_SECRET_KEY (e.g. a restricted read-only key) and
 *   falls back to the shared STRIPE_SECRET_KEY.
 *
 * Every fetcher degrades gracefully: a missing key, a Stripe error, or a parse
 * miss returns a flagged section with a human note — it never throws.
 */

import Stripe from 'stripe';
import { Pool } from 'pg';

// ── Stripe client (LeadPrime-preferred key, shared-account fallback) ────────────

let financeStripe: Stripe | null = null;
let stripeKeySource: 'leadprime' | 'shared' | null = null;

function getStripe(): Stripe | null {
  if (financeStripe) return financeStripe;
  const lpKey = process.env.LEADPRIME_STRIPE_SECRET_KEY;
  const sharedKey = process.env.STRIPE_SECRET_KEY;
  const key = lpKey || sharedKey;
  if (!key) return null;
  stripeKeySource = lpKey ? 'leadprime' : 'shared';
  financeStripe = new Stripe(key, { apiVersion: '2025-12-15.clover', typescript: true });
  return financeStripe;
}

// Only LeadPrime-tagged objects. Stripe search query language.
const LP_FILTER = "metadata['product']:'leadprime'";

// Stripe processing fee estimate (USD). Stripe standard = 2.9% + $0.30.
const FEE_PCT = Number(process.env.STRIPE_FEE_PCT ?? 2.9) / 100;
const FEE_FIXED = Number(process.env.STRIPE_FEE_FIXED_CENTS ?? 30) / 100;

// ── DB pool ─────────────────────────────────────────────────────────────────────

let financePool: Pool | null = null;
function getLeadPrimePool(): Pool {
  if (!financePool) {
    const url = process.env.LEADPRIME_DATABASE_URL;
    if (!url) throw new Error('LEADPRIME_DATABASE_URL environment variable is not set');
    financePool = new Pool({
      connectionString: url,
      ssl: { rejectUnauthorized: false },
      max: 2,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
    });
    console.log('[LeadPrime Finance] Pool initialized');
  }
  return financePool;
}

const MISSING_SCHEMA_CODES = new Set(['42P01', '42703', '42501']);
function isMissingSchema(err: any): boolean {
  return !!err && MISSING_SCHEMA_CODES.has(err.code);
}

function monthStartUnix(): number {
  const n = new Date();
  return Math.floor(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), 1) / 1000);
}
function daysElapsedThisMonth(): number {
  const n = new Date();
  return Math.max(1, n.getUTCDate() - 1 + n.getUTCHours() / 24);
}
function daysInThisMonth(): number {
  const n = new Date();
  return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth() + 1, 0)).getUTCDate();
}
function project(monthSoFar: number): number {
  return (monthSoFar / daysElapsedThisMonth()) * daysInThisMonth();
}
function round(n: number, d = 2): number {
  const f = 10 ** d;
  return Math.round(n * f) / f;
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface Recurring {
  available: boolean;
  note?: string;
  mrrUsd: number;
  arrUsd: number;
  activeSubscriptions: number;
  /** Recurring revenue split by plan price nickname/id. */
  byPlan: { plan: string; mrrUsd: number; subscriptions: number }[];
}

export interface CapturedRevenue {
  available: boolean;
  note?: string;
  /** Gross succeeded charges this month (USD), before fees, net of refunds. */
  grossUsd: number;
  refundedUsd: number;
  netOfRefundsUsd: number;
  charges: number;
  projectedMonthUsd: number;
  /** Estimated Stripe processing fees this month (USD). */
  estFeesUsd: number;
}

export interface FreeCredits {
  available: boolean;
  note?: string;
  /** Credits granted to users this month (USD) — a customer-acquisition cost. */
  totalUsd: number;
  byType: { type: string; usd: number }[];
}

export interface Cogs {
  available: boolean;
  note?: string;
  providersUsd: number; // Anthropic + OpenAI + Twilio (+ ElevenLabs where $ exposed)
  infraUsd: number; // Neon compute
  totalUsd: number;
  projectedMonthUsd: number;
}

export interface FinanceOverview {
  generatedAt: string;
  stripeKeySource: 'leadprime' | 'shared' | null;
  recurring: Recurring;
  captured: CapturedRevenue;
  freeCredits: FreeCredits;
  cogs: Cogs;
  /** Bottom line for the calendar month-to-date. */
  pnl: {
    grossRevenueUsd: number; // captured net-of-refunds
    stripeFeesUsd: number;
    netRevenueUsd: number; // gross − fees
    cogsUsd: number;
    grossProfitUsd: number; // netRevenue − cogs
    grossMarginPct: number | null;
    freeCreditsUsd: number; // CAC given away
    operatingProfitUsd: number; // grossProfit − freeCredits
    operatingMarginPct: number | null;
  };
  /** Waterfall steps for the UI (gross → fees → cogs → credits → profit). */
  waterfall: { label: string; deltaUsd: number; kind: 'in' | 'out' | 'total' }[];
  notes: string[];
}

// ── Recurring revenue (MRR / ARR) ───────────────────────────────────────────────

async function getRecurring(notes: string[]): Promise<Recurring> {
  const out: Recurring = {
    available: false,
    mrrUsd: 0,
    arrUsd: 0,
    activeSubscriptions: 0,
    byPlan: [],
  };
  const stripe = getStripe();
  if (!stripe) {
    out.note = 'No Stripe key (LEADPRIME_STRIPE_SECRET_KEY / STRIPE_SECRET_KEY)';
    notes.push(`recurring: ${out.note}`);
    return out;
  }
  try {
    const planMap = new Map<string, { mrr: number; subs: number }>();
    let mrr = 0;
    let count = 0;
    const search = stripe.subscriptions.search({
      query: `status:'active' AND ${LP_FILTER}`,
      limit: 100,
      expand: ['data.items.data.price'],
    });
    for await (const sub of search) {
      count += 1;
      let subMrr = 0;
      for (const item of sub.items.data) {
        const price = item.price;
        // Only flat (licensed) recurring counts as MRR; metered usage is variable.
        if (!price?.recurring || price.recurring.usage_type === 'metered') continue;
        const unit = (price.unit_amount ?? 0) / 100;
        const qty = item.quantity ?? 1;
        const interval = price.recurring.interval;
        let monthly = unit * qty;
        if (interval === 'year') monthly = (unit * qty) / 12;
        else if (interval === 'week') monthly = unit * qty * 4.345;
        else if (interval === 'day') monthly = unit * qty * 30.4;
        subMrr += monthly;
      }
      mrr += subMrr;
      const planKey =
        sub.items.data[0]?.price?.nickname ||
        sub.items.data[0]?.price?.id ||
        'unknown';
      const acc = planMap.get(planKey) || { mrr: 0, subs: 0 };
      acc.mrr += subMrr;
      acc.subs += 1;
      planMap.set(planKey, acc);
    }
    out.available = true;
    out.mrrUsd = round(mrr);
    out.arrUsd = round(mrr * 12);
    out.activeSubscriptions = count;
    out.byPlan = Array.from(planMap.entries())
      .map(([plan, v]) => ({ plan, mrrUsd: round(v.mrr), subscriptions: v.subs }))
      .sort((a, b) => b.mrrUsd - a.mrrUsd);
  } catch (err: any) {
    out.note = `Stripe subscriptions.search failed: ${err.message}`;
    notes.push(`recurring: ${out.note}`);
  }
  return out;
}

// ── Captured revenue (succeeded charges this month, net of refunds) ─────────────

async function getCapturedRevenue(notes: string[]): Promise<CapturedRevenue> {
  const out: CapturedRevenue = {
    available: false,
    grossUsd: 0,
    refundedUsd: 0,
    netOfRefundsUsd: 0,
    charges: 0,
    projectedMonthUsd: 0,
    estFeesUsd: 0,
  };
  const stripe = getStripe();
  if (!stripe) {
    out.note = 'No Stripe key (LEADPRIME_STRIPE_SECRET_KEY / STRIPE_SECRET_KEY)';
    notes.push(`captured: ${out.note}`);
    return out;
  }
  try {
    let gross = 0;
    let refunded = 0;
    let count = 0;
    const search = stripe.charges.search({
      query: `status:'succeeded' AND ${LP_FILTER} AND created>${monthStartUnix()}`,
      limit: 100,
    });
    for await (const ch of search) {
      count += 1;
      gross += (ch.amount ?? 0) / 100;
      refunded += (ch.amount_refunded ?? 0) / 100;
    }
    const net = gross - refunded;
    out.available = true;
    out.charges = count;
    out.grossUsd = round(gross);
    out.refundedUsd = round(refunded);
    out.netOfRefundsUsd = round(net);
    out.projectedMonthUsd = round(project(net));
    out.estFeesUsd = round(gross * FEE_PCT + count * FEE_FIXED);
  } catch (err: any) {
    out.note = `Stripe charges.search failed: ${err.message}`;
    notes.push(`captured: ${out.note}`);
  }
  return out;
}

// ── Free credits granted this month (CAC proxy) ─────────────────────────────────

const CREDIT_TYPES = new Set(['admin_grant', 'welcome_credit', 'promo_credit', 'referral_credit']);

async function getFreeCredits(pool: Pool, notes: string[]): Promise<FreeCredits> {
  const out: FreeCredits = { available: false, totalUsd: 0, byType: [] };
  try {
    const r = await pool.query(
      `SELECT type, SUM(amount_cents)::bigint AS cents
         FROM wallet_transactions
        WHERE amount_cents > 0
          AND created_at >= date_trunc('month', now())
        GROUP BY type
        ORDER BY cents DESC`
    );
    let total = 0;
    const byType: { type: string; usd: number }[] = [];
    for (const row of r.rows) {
      const type = String(row.type);
      if (!CREDIT_TYPES.has(type)) continue; // exclude real Stripe top-ups
      const usd = Number(row.cents || 0) / 100;
      total += usd;
      byType.push({ type, usd: round(usd) });
    }
    out.available = true;
    out.totalUsd = round(total);
    out.byType = byType;
  } catch (err: any) {
    if (isMissingSchema(err)) out.note = 'wallet_transactions not available';
    else out.note = err.message;
    notes.push(`freeCredits: ${out.note}`);
  }
  return out;
}

// ── COGS (provider spend + Neon infra) ──────────────────────────────────────────

async function getCogs(notes: string[]): Promise<Cogs> {
  const out: Cogs = {
    available: false,
    providersUsd: 0,
    infraUsd: 0,
    totalUsd: 0,
    projectedMonthUsd: 0,
  };
  let any = false;
  try {
    const { getServiceSpend } = await import('./leadprime-service-spend');
    const spend = await getServiceSpend();
    out.providersUsd = round(spend.totals.monthSpendUsd);
    any = true;
  } catch (err: any) {
    notes.push(`cogs.providers: ${err.message}`);
  }
  try {
    const { getInfraHealth } = await import('./leadprime-infra-health');
    const infra = await getInfraHealth();
    if (infra.neon.available) {
      out.infraUsd = round(infra.neon.monthCostUsd);
      any = true;
    }
  } catch (err: any) {
    notes.push(`cogs.infra: ${err.message}`);
  }
  out.totalUsd = round(out.providersUsd + out.infraUsd);
  out.projectedMonthUsd = round(project(out.totalUsd));
  out.available = any;
  if (!any) out.note = 'No COGS sources available (provider keys + Neon key not set)';
  return out;
}

// ── Orchestrator ────────────────────────────────────────────────────────────────

export async function getFinanceOverview(): Promise<FinanceOverview> {
  const notes: string[] = [];
  getStripe(); // initialize key-source flag
  const pool = getLeadPrimePool();

  const [recurring, captured, freeCredits, cogs] = await Promise.all([
    getRecurring(notes),
    getCapturedRevenue(notes),
    getFreeCredits(pool, notes),
    getCogs(notes),
  ]);

  const grossRevenueUsd = captured.netOfRefundsUsd;
  const stripeFeesUsd = captured.estFeesUsd;
  const netRevenueUsd = round(grossRevenueUsd - stripeFeesUsd);
  const cogsUsd = cogs.totalUsd;
  const grossProfitUsd = round(netRevenueUsd - cogsUsd);
  const freeCreditsUsd = freeCredits.totalUsd;
  const operatingProfitUsd = round(grossProfitUsd - freeCreditsUsd);

  const pnl = {
    grossRevenueUsd,
    stripeFeesUsd,
    netRevenueUsd,
    cogsUsd,
    grossProfitUsd,
    grossMarginPct: netRevenueUsd > 0 ? round((grossProfitUsd / netRevenueUsd) * 100, 1) : null,
    freeCreditsUsd,
    operatingProfitUsd,
    operatingMarginPct: netRevenueUsd > 0 ? round((operatingProfitUsd / netRevenueUsd) * 100, 1) : null,
  };

  const waterfall: FinanceOverview['waterfall'] = [
    { label: 'Gross revenue', deltaUsd: grossRevenueUsd, kind: 'in' },
    { label: 'Stripe fees', deltaUsd: -stripeFeesUsd, kind: 'out' },
    { label: 'Provider + infra COGS', deltaUsd: -cogsUsd, kind: 'out' },
    { label: 'Free credits (CAC)', deltaUsd: -freeCreditsUsd, kind: 'out' },
    { label: 'Operating profit', deltaUsd: operatingProfitUsd, kind: 'total' },
  ];

  return {
    generatedAt: new Date().toISOString(),
    stripeKeySource,
    recurring,
    captured,
    freeCredits,
    cogs,
    pnl,
    waterfall,
    notes,
  };
}

// ── Phase 2: revenue by product/feature & by provider ───────────────────────────

/**
 * Per-feature metadata mirrors LeadPrime's own SERVICE_DISPLAY_CONFIG
 * (backend usageTrackingService) so the admin labels/colors match the product.
 * `category` groups features for the higher-level slice; `provider` is the
 * external service that ultimately incurs cost (for the by-provider ROI view).
 */
type Category = 'Messaging' | 'Voice & Phone' | 'AI' | 'Website' | 'Documents' | 'Other';
interface ServiceMeta {
  label: string;
  color: string;
  category: Category;
  provider: 'anthropic' | 'openai' | 'twilio' | 'elevenlabs' | 'internal';
}
const SERVICE_META: Record<string, ServiceMeta> = {
  sms: { label: 'SMS', color: '#3B82F6', category: 'Messaging', provider: 'twilio' },
  mms: { label: 'MMS', color: '#F472B6', category: 'Messaging', provider: 'twilio' },
  emails: { label: 'Emails', color: '#10B981', category: 'Messaging', provider: 'internal' },
  voice: { label: 'Human Voice', color: '#8B5CF6', category: 'Voice & Phone', provider: 'twilio' },
  ai_voice: { label: 'AI Voice Agent', color: '#7C3AED', category: 'Voice & Phone', provider: 'twilio' },
  phones: { label: 'Phone Numbers', color: '#22C55E', category: 'Voice & Phone', provider: 'twilio' },
  phone_number: { label: 'Phone Numbers', color: '#22C55E', category: 'Voice & Phone', provider: 'twilio' },
  ai: { label: 'AI Requests', color: '#F97316', category: 'AI', provider: 'anthropic' },
  global_chat: { label: 'AI Agent (Chat)', color: '#A78BFA', category: 'AI', provider: 'anthropic' },
  web_search: { label: 'Web Search', color: '#FBBF24', category: 'AI', provider: 'anthropic' },
  document_gen: { label: 'Documents (AI)', color: '#818CF8', category: 'AI', provider: 'anthropic' },
  website_deploy: { label: 'Website Deploy', color: '#34D399', category: 'Website', provider: 'anthropic' },
  website_modify: { label: 'Website Edits', color: '#6EE7B7', category: 'Website', provider: 'anthropic' },
  website_hosting: { label: 'Website Hosting', color: '#5EEAD4', category: 'Website', provider: 'internal' },
  website: { label: 'Website', color: '#34D399', category: 'Website', provider: 'internal' },
  leadsign: { label: 'LeadSign', color: '#06B6D4', category: 'Documents', provider: 'internal' },
  leads: { label: 'Leads', color: '#EAB308', category: 'Other', provider: 'internal' },
  storage: { label: 'Storage', color: '#6B7280', category: 'Other', provider: 'internal' },
  users: { label: 'Users', color: '#EC4899', category: 'Other', provider: 'internal' },
  pm_units: { label: 'PM Units', color: '#94A3B8', category: 'Other', provider: 'internal' },
  pm_unit: { label: 'PM Units', color: '#94A3B8', category: 'Other', provider: 'internal' },
};
function metaFor(eventType: string): ServiceMeta {
  return (
    SERVICE_META[eventType] || {
      label: eventType,
      color: '#64748B',
      category: 'Other',
      provider: 'internal',
    }
  );
}

export interface ProductSlice {
  eventType: string;
  label: string;
  color: string;
  category: Category;
  provider: ServiceMeta['provider'];
  billedUsd: number;
  events: number;
  contractors: number;
  quantity: number;
  sharePct: number; // % of total billed usage revenue
}
export interface CategorySlice {
  category: Category;
  billedUsd: number;
  sharePct: number;
}
export interface ProviderRevenueSlice {
  provider: string;
  label: string;
  available: boolean;
  billedUsd: number; // what we charge users for usage mapped to this provider
  actualUsd: number | null; // what the provider actually costs (null = unknown)
  marginUsd: number | null;
}
export interface FinanceBreakdown {
  generatedAt: string;
  totalBilledUsd: number; // sum of usage_events.cost this month
  byProduct: ProductSlice[];
  byCategory: CategorySlice[];
  byProvider: ProviderRevenueSlice[];
  notes: string[];
}

export async function getFinanceBreakdown(): Promise<FinanceBreakdown> {
  const notes: string[] = [];
  const pool = getLeadPrimePool();

  const byProduct: ProductSlice[] = [];
  let totalBilledUsd = 0;

  try {
    const r = await pool.query(
      `SELECT event_type,
              SUM(cost)::numeric        AS usd,
              SUM(quantity)::numeric    AS qty,
              COUNT(*)::int             AS events,
              COUNT(DISTINCT contractor_id)::int AS contractors
         FROM usage_events
        WHERE created_at >= date_trunc('month', now())
        GROUP BY event_type`
    );
    for (const row of r.rows) {
      const eventType = String(row.event_type);
      const meta = metaFor(eventType);
      const billedUsd = round(Number(row.usd || 0));
      totalBilledUsd += billedUsd;
      byProduct.push({
        eventType,
        label: meta.label,
        color: meta.color,
        category: meta.category,
        provider: meta.provider,
        billedUsd,
        events: Number(row.events || 0),
        contractors: Number(row.contractors || 0),
        quantity: round(Number(row.qty || 0), 2),
        sharePct: 0,
      });
    }
  } catch (err: any) {
    if (isMissingSchema(err)) notes.push('byProduct: usage_events not available');
    else notes.push(`byProduct: ${err.message}`);
  }

  totalBilledUsd = round(totalBilledUsd);
  for (const p of byProduct) {
    p.sharePct = totalBilledUsd > 0 ? round((p.billedUsd / totalBilledUsd) * 100, 1) : 0;
  }
  byProduct.sort((a, b) => b.billedUsd - a.billedUsd);

  // Category rollup
  const catMap = new Map<Category, number>();
  for (const p of byProduct) catMap.set(p.category, (catMap.get(p.category) || 0) + p.billedUsd);
  const byCategory: CategorySlice[] = Array.from(catMap.entries())
    .map(([category, usd]) => ({
      category,
      billedUsd: round(usd),
      sharePct: totalBilledUsd > 0 ? round((usd / totalBilledUsd) * 100, 1) : 0,
    }))
    .sort((a, b) => b.billedUsd - a.billedUsd);

  // Provider revenue + ROI (reuse the corrected service-spend billed/actual).
  let byProvider: ProviderRevenueSlice[] = [];
  try {
    const { getServiceSpend } = await import('./leadprime-service-spend');
    const spend = await getServiceSpend();
    byProvider = spend.providers.map((p) => ({
      provider: p.provider,
      label: p.label,
      available: p.available,
      billedUsd: round(p.billedToUsersUsd),
      actualUsd: p.monthSpendUsd != null ? round(p.monthSpendUsd) : null,
      marginUsd: p.marginUsd != null ? round(p.marginUsd) : null,
    }));
  } catch (err: any) {
    notes.push(`byProvider: ${err.message}`);
  }

  return {
    generatedAt: new Date().toISOString(),
    totalBilledUsd,
    byProduct,
    byCategory,
    byProvider,
    notes,
  };
}
