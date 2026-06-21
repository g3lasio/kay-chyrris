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

export function getStripe(): Stripe | null {
  if (financeStripe) return financeStripe;
  const lpKey = process.env.LEADPRIME_STRIPE_SECRET_KEY;
  const sharedKey = process.env.STRIPE_SECRET_KEY;
  const key = lpKey || sharedKey;
  if (!key) return null;
  stripeKeySource = lpKey ? 'leadprime' : 'shared';
  financeStripe = new Stripe(key, { apiVersion: '2025-12-15.clover', typescript: true });
  return financeStripe;
}
export function getStripeKeySource(): 'leadprime' | 'shared' | null {
  return stripeKeySource;
}

// Only LeadPrime-tagged objects. Stripe search query language.
export const LP_FILTER = "metadata['product']:'leadprime'";

// Stripe processing fee estimate (USD). Stripe standard = 2.9% + $0.30.
export const FEE_PCT = Number(process.env.STRIPE_FEE_PCT ?? 2.9) / 100;
export const FEE_FIXED = Number(process.env.STRIPE_FEE_FIXED_CENTS ?? 30) / 100;

// ── DB pool ─────────────────────────────────────────────────────────────────────

let financePool: Pool | null = null;
export function getLeadPrimePool(): Pool {
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
export function isMissingSchema(err: any): boolean {
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
export function round(n: number, d = 2): number {
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
export type Category = 'Messaging' | 'Voice & Phone' | 'AI' | 'Website' | 'Documents' | 'Other';
export interface ServiceMeta {
  label: string;
  color: string;
  category: Category;
  provider: 'anthropic' | 'openai' | 'twilio' | 'elevenlabs' | 'internal';
}
export const SERVICE_META: Record<string, ServiceMeta> = {
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
export function metaFor(eventType: string): ServiceMeta {
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

// ── Phase 3: by user + LTV / breakeven + MRR movements & churn ───────────────────

/**
 * Per-user economics & subscription lifecycle. ALL local (LeadPrime DB) — no
 * Stripe pagination needed: the `subscriptions` table mirrors the lifecycle
 * (status, base_price_cents, created_at, canceled_at, cancel_at_period_end) and
 * `wallet_transactions` records both real-money top-ups and free credits.
 *
 * Money flow → how LTV is derived (no double counting):
 *   - Usage (usage_events.cost) is paid out of the prepaid wallet, NOT new cash.
 *   - Real cash in = subscription license + real-money wallet top-ups.
 *   - lifetimeRevenueUsd (LTV-to-date, cash) = real top-ups + subscription paid.
 *     subscriptionPaidUsd = monthsActive × base price — an APPROXIMATION
 *     (ignores upgrades/proration/refunds; capped at cancellation).
 *   - creditsGrantedUsd (CAC) = free credits given (same set as Phase-1 freeCredits).
 *   - This is revenue-side LTV minus CAC; per-user COGS is NOT separable from
 *     provider totals, so it is NOT subtracted here (documented in `note`).
 */

// Real-money wallet top-ups (cash revenue), distinct from free CAC credits.
const REAL_MONEY_TYPES = new Set([
  'purchase',
  'stripe_purchase',
  'stripe_recharge',
  'subscription_recharge',
  'recharge',
]);

export interface UserSlice {
  contractorId: string;
  name: string;
  email: string;
  tradeType: string | null;
  createdAt: string | null;
  plan: string | null;
  status: string | null;
  monthsActive: number;
  mrrUsd: number; // current flat-license run-rate (active only)
  usageMtdUsd: number; // usage consumed this month
  lifetimeUsageUsd: number; // usage consumed all-time
  cashTopupsUsd: number; // real-money wallet top-ups all-time
  subscriptionPaidUsd: number; // monthsActive × base price (approx)
  lifetimeRevenueUsd: number; // cashTopups + subscriptionPaid (LTV to date)
  creditsGrantedUsd: number; // free credits given all-time (CAC)
  netLifetimeUsd: number; // lifetimeRevenue − credits
  brokeEven: boolean;
}

export interface MrrMovements {
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
  /** MTD logo churn proxy = churned / (active + churned). */
  logoChurnRatePct: number | null;
}

export interface FinanceByUser {
  generatedAt: string;
  available: boolean;
  note?: string;
  users: UserSlice[]; // top users by lifetime revenue (capped)
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

const USER_LIST_CAP = 100;

async function getMrrMovements(pool: Pool, notes: string[]): Promise<MrrMovements> {
  const out: MrrMovements = {
    available: false,
    activeSubscriptions: 0,
    activeMrrUsd: 0,
    newCount: 0,
    newMrrUsd: 0,
    churnedCount: 0,
    churnedMrrUsd: 0,
    netNewMrrUsd: 0,
    atRiskCount: 0,
    atRiskMrrUsd: 0,
    logoChurnRatePct: null,
  };
  try {
    const r = await pool.query(
      `SELECT
         COUNT(*) FILTER (WHERE status IN ('active','trialing'))                                          AS active_count,
         COALESCE(SUM(base_price_cents) FILTER (WHERE status IN ('active','trialing')),0)                 AS active_cents,
         COUNT(*) FILTER (WHERE created_at >= date_trunc('month', now()) AND status IN ('active','trialing')) AS new_count,
         COALESCE(SUM(base_price_cents) FILTER (WHERE created_at >= date_trunc('month', now()) AND status IN ('active','trialing')),0) AS new_cents,
         COUNT(*) FILTER (WHERE canceled_at >= date_trunc('month', now()))                                AS churned_count,
         COALESCE(SUM(base_price_cents) FILTER (WHERE canceled_at >= date_trunc('month', now())),0)       AS churned_cents,
         COUNT(*) FILTER (WHERE cancel_at_period_end = true AND status IN ('active','trialing'))          AS atrisk_count,
         COALESCE(SUM(base_price_cents) FILTER (WHERE cancel_at_period_end = true AND status IN ('active','trialing')),0) AS atrisk_cents
       FROM subscriptions`
    );
    const row = r.rows[0] || {};
    const activeCount = Number(row.active_count || 0);
    const churnedCount = Number(row.churned_count || 0);
    out.available = true;
    out.activeSubscriptions = activeCount;
    out.activeMrrUsd = round(Number(row.active_cents || 0) / 100);
    out.newCount = Number(row.new_count || 0);
    out.newMrrUsd = round(Number(row.new_cents || 0) / 100);
    out.churnedCount = churnedCount;
    out.churnedMrrUsd = round(Number(row.churned_cents || 0) / 100);
    out.netNewMrrUsd = round(out.newMrrUsd - out.churnedMrrUsd);
    out.atRiskCount = Number(row.atrisk_count || 0);
    out.atRiskMrrUsd = round(Number(row.atrisk_cents || 0) / 100);
    const denom = activeCount + churnedCount;
    out.logoChurnRatePct = denom > 0 ? round((churnedCount / denom) * 100, 1) : null;
  } catch (err: any) {
    if (isMissingSchema(err)) out.note = 'subscriptions not available';
    else out.note = err.message;
    notes.push(`movements: ${out.note}`);
  }
  return out;
}

export async function getFinanceByUser(): Promise<FinanceByUser> {
  const notes: string[] = [];
  const pool = getLeadPrimePool();

  const movements = await getMrrMovements(pool, notes);

  const out: FinanceByUser = {
    generatedAt: new Date().toISOString(),
    available: false,
    users: [],
    totalUsers: 0,
    payingUsers: 0,
    brokeEvenUsers: 0,
    avgLtvUsd: 0,
    avgCacUsd: 0,
    ltvCacRatio: null,
    totalLifetimeRevenueUsd: 0,
    totalCreditsGrantedUsd: 0,
    movements,
    notes,
  };

  let rows: any[] = [];
  try {
    const creditList = Array.from(CREDIT_TYPES).map((t) => `'${t}'`).join(',');
    const moneyList = Array.from(REAL_MONEY_TYPES).map((t) => `'${t}'`).join(',');
    const r = await pool.query(
      `WITH sub AS (
         SELECT contractor_id, status, plan_name, base_price_cents, created_at,
                EXTRACT(EPOCH FROM (COALESCE(canceled_at, now()) - created_at)) / 2629800.0 AS months_active
           FROM subscriptions
       ),
       usage_mtd AS (
         SELECT contractor_id, SUM(cost) AS usd FROM usage_events
          WHERE created_at >= date_trunc('month', now()) GROUP BY contractor_id
       ),
       usage_life AS (
         SELECT contractor_id, SUM(cost) AS usd FROM usage_events GROUP BY contractor_id
       ),
       topups AS (
         SELECT contractor_id, SUM(amount_cents) AS cents FROM wallet_transactions
          WHERE amount_cents > 0 AND type IN (${moneyList}) GROUP BY contractor_id
       ),
       credits AS (
         SELECT contractor_id, SUM(amount_cents) AS cents FROM wallet_transactions
          WHERE amount_cents > 0 AND type IN (${creditList}) GROUP BY contractor_id
       )
       SELECT c.id, c.name, c.email, c.trade_type, c.created_at,
              s.status, s.plan_name, s.base_price_cents, s.months_active,
              COALESCE(um.usd,0)  AS usage_mtd,
              COALESCE(ul.usd,0)  AS usage_life,
              COALESCE(t.cents,0) AS topups_cents,
              COALESCE(cr.cents,0) AS credits_cents
         FROM contractors c
         LEFT JOIN sub s         ON s.contractor_id  = c.id
         LEFT JOIN usage_mtd um  ON um.contractor_id = c.id
         LEFT JOIN usage_life ul ON ul.contractor_id = c.id
         LEFT JOIN topups t      ON t.contractor_id  = c.id
         LEFT JOIN credits cr    ON cr.contractor_id = c.id
        WHERE s.contractor_id  IS NOT NULL
           OR ul.contractor_id IS NOT NULL
           OR t.contractor_id  IS NOT NULL
           OR cr.contractor_id IS NOT NULL`
    );
    rows = r.rows;
  } catch (err: any) {
    if (isMissingSchema(err)) out.note = 'contractors/usage_events/wallet not available';
    else out.note = err.message;
    notes.push(`byUser: ${out.note}`);
    return out;
  }

  const users: UserSlice[] = [];
  let totalLifetimeRevenue = 0;
  let totalCredits = 0;
  let paying = 0;
  let brokeEven = 0;
  let cacSum = 0;
  let cacCount = 0;

  for (const row of rows) {
    const basePriceUsd = Number(row.base_price_cents || 0) / 100;
    const status = row.status ? String(row.status) : null;
    const isActive = status === 'active' || status === 'trialing';
    const monthsActive = Math.max(0, round(Number(row.months_active || 0), 1));
    const cyclesPaid = row.status ? Math.max(1, Math.round(monthsActive)) : 0;
    const subscriptionPaidUsd = round(cyclesPaid * basePriceUsd);
    const cashTopupsUsd = round(Number(row.topups_cents || 0) / 100);
    const creditsGrantedUsd = round(Number(row.credits_cents || 0) / 100);
    const lifetimeUsageUsd = round(Number(row.usage_life || 0));
    const usageMtdUsd = round(Number(row.usage_mtd || 0));
    const lifetimeRevenueUsd = round(subscriptionPaidUsd + cashTopupsUsd);
    const netLifetimeUsd = round(lifetimeRevenueUsd - creditsGrantedUsd);

    totalLifetimeRevenue += lifetimeRevenueUsd;
    totalCredits += creditsGrantedUsd;
    if (lifetimeRevenueUsd > 0) paying += 1;
    if (netLifetimeUsd > 0) brokeEven += 1;
    cacSum += creditsGrantedUsd;
    cacCount += 1;

    users.push({
      contractorId: String(row.id),
      name: row.name ? String(row.name) : '—',
      email: row.email ? String(row.email) : '—',
      tradeType: row.trade_type ? String(row.trade_type) : null,
      createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
      plan: row.plan_name ? String(row.plan_name) : null,
      status,
      monthsActive,
      mrrUsd: isActive ? round(basePriceUsd) : 0,
      usageMtdUsd,
      lifetimeUsageUsd,
      cashTopupsUsd,
      subscriptionPaidUsd,
      lifetimeRevenueUsd,
      creditsGrantedUsd,
      netLifetimeUsd,
      brokeEven: netLifetimeUsd > 0,
    });
  }

  users.sort((a, b) => b.lifetimeRevenueUsd - a.lifetimeRevenueUsd);

  out.available = true;
  out.totalUsers = users.length;
  out.payingUsers = paying;
  out.brokeEvenUsers = brokeEven;
  out.totalLifetimeRevenueUsd = round(totalLifetimeRevenue);
  out.totalCreditsGrantedUsd = round(totalCredits);
  out.avgLtvUsd = paying > 0 ? round(totalLifetimeRevenue / paying) : 0;
  out.avgCacUsd = cacCount > 0 ? round(cacSum / cacCount) : 0;
  out.ltvCacRatio = out.avgCacUsd > 0 ? round(out.avgLtvUsd / out.avgCacUsd, 2) : null;
  out.users = users.slice(0, USER_LIST_CAP);
  return out;
}

// ── Phase 4: forecast + anomaly alerts + revenue-at-risk (dunning) ───────────────

/**
 * Forward-looking view. The forecast reuses month-end projections from
 * getFinanceOverview (Stripe captured + COGS) and the local subscription MRR
 * run-rate. Anomalies compare this month's PROJECTED pace against last month's
 * full actual for local series (usage revenue, free credits) — no provider/Stripe
 * history needed. Revenue-at-risk is the dunning + cancel-scheduled book straight
 * from the local subscriptions lifecycle. Read-only; everything degrades.
 */

// Stripe/subscription dunning states (payment failing / not yet collected).
const DUNNING_STATUSES = new Set(['past_due', 'unpaid', 'incomplete']);

export interface ForecastBlock {
  available: boolean;
  note?: string;
  activeMrrUsd: number;
  arrUsd: number;
  netNewMrrUsd: number;
  nextMonthMrrUsd: number; // active + net-new (this month's pace)
  projectedRevenueUsd: number | null; // month-end captured (from overview)
  projectedCogsUsd: number | null;
  projectedOpProfitUsd: number | null;
}

export interface Anomaly {
  metric: string;
  currentProjectedUsd: number;
  priorMonthUsd: number;
  changePct: number | null;
  severity: 'ok' | 'warn' | 'alarm';
  note: string;
}

export interface AtRiskAccount {
  contractorId: string;
  name: string;
  email: string;
  status: string;
  reason: 'dunning' | 'cancel_scheduled';
  mrrUsd: number;
}

export interface RevenueAtRisk {
  available: boolean;
  note?: string;
  dunningMrrUsd: number;
  dunningCount: number;
  cancelScheduledMrrUsd: number;
  cancelScheduledCount: number;
  totalAtRiskMrrUsd: number;
  accounts: AtRiskAccount[];
}

export interface FinanceForecast {
  generatedAt: string;
  forecast: ForecastBlock;
  anomalies: Anomaly[];
  atRisk: RevenueAtRisk;
  notes: string[];
}

/** Month-over-month series: current MTD vs prior full month for one numeric column. */
async function momSeries(
  pool: Pool,
  table: string,
  valueExpr: string,
  whereExtra: string
): Promise<{ cur: number; prev: number } | null> {
  try {
    const r = await pool.query(
      `SELECT
         COALESCE(SUM(${valueExpr}) FILTER (WHERE created_at >= date_trunc('month', now())), 0) AS cur,
         COALESCE(SUM(${valueExpr}) FILTER (
           WHERE created_at >= date_trunc('month', now()) - interval '1 month'
             AND created_at <  date_trunc('month', now())), 0) AS prev
         FROM ${table}
        WHERE created_at >= date_trunc('month', now()) - interval '1 month'${whereExtra}`
    );
    const row = r.rows[0] || {};
    return { cur: Number(row.cur || 0), prev: Number(row.prev || 0) };
  } catch (err: any) {
    if (isMissingSchema(err)) return null;
    throw err;
  }
}

function makeAnomaly(metric: string, curMtd: number, prev: number): Anomaly {
  const projected = round(project(curMtd));
  let changePct: number | null = null;
  let severity: Anomaly['severity'] = 'ok';
  let note = `Projected ${usdNote(projected)} vs ${usdNote(prev)} last month`;
  if (prev > 1) {
    changePct = round(((projected - prev) / prev) * 100, 1);
    const mag = Math.abs(changePct);
    if (mag >= 80) severity = 'alarm';
    else if (mag >= 40) severity = 'warn';
    const dir = changePct >= 0 ? 'up' : 'down';
    note = `${dir === 'up' ? '▲' : '▼'} ${Math.abs(changePct)}% ${dir} — projected ${usdNote(projected)} vs ${usdNote(prev)} last month`;
  } else if (projected > 1) {
    severity = 'warn';
    note = `New this month — projected ${usdNote(projected)} (no prior-month baseline)`;
  }
  return { metric, currentProjectedUsd: projected, priorMonthUsd: round(prev), changePct, severity, note };
}

function usdNote(n: number): string {
  return `$${n.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
}

export async function getFinanceForecast(): Promise<FinanceForecast> {
  const notes: string[] = [];
  const pool = getLeadPrimePool();

  // ── Forecast: local MRR run-rate + month-end projections from the overview ──
  const movements = await getMrrMovements(pool, notes);
  const forecast: ForecastBlock = {
    available: movements.available,
    activeMrrUsd: movements.activeMrrUsd,
    arrUsd: round(movements.activeMrrUsd * 12),
    netNewMrrUsd: movements.netNewMrrUsd,
    nextMonthMrrUsd: round(movements.activeMrrUsd + movements.netNewMrrUsd),
    projectedRevenueUsd: null,
    projectedCogsUsd: null,
    projectedOpProfitUsd: null,
  };
  if (!movements.available) forecast.note = movements.note;
  try {
    const overview = await getFinanceOverview();
    if (overview.captured.available) forecast.projectedRevenueUsd = overview.captured.projectedMonthUsd;
    if (overview.cogs.available) forecast.projectedCogsUsd = overview.cogs.projectedMonthUsd;
    forecast.projectedOpProfitUsd = round(project(overview.pnl.operatingProfitUsd));
    forecast.available = true;
  } catch (err: any) {
    notes.push(`forecast.overview: ${err.message}`);
  }

  // ── Anomalies: month-over-month on local series ─────────────────────────────
  const anomalies: Anomaly[] = [];
  try {
    const usage = await momSeries(pool, 'usage_events', 'cost', '');
    if (usage) anomalies.push(makeAnomaly('Usage revenue', usage.cur, usage.prev));
    else notes.push('anomaly.usage: usage_events not available');
  } catch (err: any) {
    notes.push(`anomaly.usage: ${err.message}`);
  }
  try {
    const creditList = Array.from(CREDIT_TYPES).map((t) => `'${t}'`).join(',');
    const credits = await momSeries(
      pool,
      'wallet_transactions',
      'amount_cents / 100.0',
      ` AND amount_cents > 0 AND type IN (${creditList})`
    );
    if (credits) anomalies.push(makeAnomaly('Free credits (CAC)', credits.cur, credits.prev));
    else notes.push('anomaly.credits: wallet_transactions not available');
  } catch (err: any) {
    notes.push(`anomaly.credits: ${err.message}`);
  }

  // ── Revenue at risk: dunning + cancel-scheduled book (local) ────────────────
  const atRisk: RevenueAtRisk = {
    available: false,
    dunningMrrUsd: 0,
    dunningCount: 0,
    cancelScheduledMrrUsd: 0,
    cancelScheduledCount: 0,
    totalAtRiskMrrUsd: 0,
    accounts: [],
  };
  try {
    const r = await pool.query(
      `SELECT s.contractor_id, s.status, s.base_price_cents, s.cancel_at_period_end,
              c.name, c.email
         FROM subscriptions s
         LEFT JOIN contractors c ON c.id = s.contractor_id
        WHERE s.status IN ('past_due','unpaid','incomplete')
           OR (s.cancel_at_period_end = true AND s.status IN ('active','trialing'))`
    );
    let dunningMrr = 0;
    let cancelMrr = 0;
    for (const row of r.rows) {
      const status = String(row.status);
      const mrrUsd = round(Number(row.base_price_cents || 0) / 100);
      const reason: AtRiskAccount['reason'] = DUNNING_STATUSES.has(status) ? 'dunning' : 'cancel_scheduled';
      if (reason === 'dunning') {
        dunningMrr += mrrUsd;
        atRisk.dunningCount += 1;
      } else {
        cancelMrr += mrrUsd;
        atRisk.cancelScheduledCount += 1;
      }
      atRisk.accounts.push({
        contractorId: String(row.contractor_id),
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

  return {
    generatedAt: new Date().toISOString(),
    forecast,
    anomalies,
    atRisk,
    notes,
  };
}
