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

// ── Free-credit classification ──────────────────────────────────────────────────
//
// Not every positive wallet_transaction is customer-acquisition cost. `admin_grant`
// is an INTERNAL grant (manual top-ups to our own / test / comped accounts) and
// must not be counted as CAC — it was inflating the give-away line to >$1k and
// dragging operating profit deep negative. Only genuine acquisition give-aways
// (welcome / promo / referral) are real CAC. Stripe top-ups (purchase/recharge)
// are real cash and excluded from both buckets.
export const REAL_CAC_TYPES = ['welcome_credit', 'promo_credit', 'referral_credit'];
export const INTERNAL_GRANT_TYPES = ['admin_grant'];
export const FREE_CREDIT_TYPES = [...REAL_CAC_TYPES, ...INTERNAL_GRANT_TYPES];

// ── LeadPrime customer resolution (charges don't inherit subscription metadata) ──
//
// Stripe does NOT copy a subscription's metadata onto the invoices/charges it
// generates, so `charges.search` filtered by metadata['product']:'leadprime'
// matched nothing — silently understating captured revenue to $0. Customers ARE
// tagged at creation, so we resolve the LeadPrime customer IDs once (cached) and
// sum their succeeded charges directly.
let lpCustomerCache: { ids: string[]; at: number } | null = null;
const LP_CUSTOMER_TTL_MS = 10 * 60 * 1000;

export async function getLeadPrimeCustomerIds(stripe: Stripe): Promise<string[]> {
  if (lpCustomerCache && Date.now() - lpCustomerCache.at < LP_CUSTOMER_TTL_MS) {
    return lpCustomerCache.ids;
  }
  const ids: string[] = [];
  const search = stripe.customers.search({ query: LP_FILTER, limit: 100 });
  for await (const c of search) ids.push(c.id);
  lpCustomerCache = { ids, at: Date.now() };
  return ids;
}

export interface ChargeSum {
  gross: number;
  refunded: number;
  count: number;
  customers: number;
  /** Comisiones REALES cobradas por Stripe (balance_transaction.fee), en USD. */
  actualFees: number;
  /** Cuántos cargos traían balance_transaction — si es 0 se usa la estimación. */
  feesFromCharges: number;
}

/** Sum succeeded charges (net of refunds) created since `sinceUnix` for every
 *  LeadPrime customer. Per-customer listing because charges can't be filtered by
 *  metadata. Returns the customer count so callers can distinguish "no charges"
 *  from "no tagged customers found". */
export async function sumLeadPrimeCharges(stripe: Stripe, sinceUnix: number): Promise<ChargeSum> {
  const ids = await getLeadPrimeCustomerIds(stripe);
  let gross = 0;
  let refunded = 0;
  let count = 0;
  let actualFees = 0;
  let feesFromCharges = 0;
  for (const customer of ids) {
    // expand balance_transaction: trae la comisión REAL que cobró Stripe por
    // cada cargo. Sin esto el P&L usaba 2.9% + 30¢ estimados, que ignoran
    // tarifas de tarjetas internacionales, disputas y conversión de divisa.
    const list = stripe.charges.list({
      customer,
      created: { gte: sinceUnix },
      limit: 100,
      expand: ['data.balance_transaction'],
    });
    for await (const ch of list) {
      if (ch.status !== 'succeeded') continue;
      gross += (ch.amount ?? 0) / 100;
      refunded += (ch.amount_refunded ?? 0) / 100;
      count += 1;
      const bt: any = ch.balance_transaction;
      if (bt && typeof bt === 'object' && typeof bt.fee === 'number') {
        actualFees += bt.fee / 100;
        feesFromCharges += 1;
      }
    }
  }
  return { gross, refunded, count, customers: ids.length, actualFees, feesFromCharges };
}

/**
 * Precio mensual REAL de una suscripción, en centavos, como expresión SQL.
 *
 * Requiere que la consulta traiga los alias `s` (subscriptions), `pd`
 * (plan_definitions) y `csc` (contractor_subscription_config).
 *
 * POR QUÉ NO `subscriptions.base_price_cents`: esa columna tiene DEFAULT 1500,
 * así que TODA cuenta nacía valiendo $15/mes — incluidas las Pay-As-You-Go que
 * no pagan mensualidad, la cuenta demo y los duplicados. De ahí salía el MRR
 * inflado de $549. El precio bueno es el del catálogo del plan.
 *
 * El caso `external_zelle` es el cobro MANUAL por transferencia: cuenta como
 * MRR igual que cualquier otro (decisión del dueño) y usa el precio ACORDADO,
 * que puede diferir del catálogo porque esos planes se negocian.
 *
 * Vive aquí, exportado, porque tres consultas distintas lo necesitan idéntico:
 * si una sola discrepa, dos pantallas del panel muestran MRR distinto — que es
 * exactamente el bug que esto vino a cerrar.
 */
export const PLAN_PRICE_CENTS_SQL = `COALESCE(
  CASE WHEN csc.billing_mode = 'external_zelle' AND csc.status = 'applied'
       THEN COALESCE(NULLIF(csc.monthly_price_cents, 0), pd.monthly_price_cents)
       ELSE pd.monthly_price_cents END, 0)`;

// ── Types ─────────────────────────────────────────────────────────────────────

export interface Recurring {
  available: boolean;
  note?: string;
  mrrUsd: number;
  arrUsd: number;
  activeSubscriptions: number;
  /** Recurring revenue split by plan price nickname/id. */
  byPlan: { plan: string; mrrUsd: number; subscriptions: number }[];
  /**
   * Parte del MRR cobrada FUERA de Stripe (Zelle/transferencia). Es ingreso
   * real y cuenta completo — decisión del dueño: el contratista no pudo pagar
   * por el portal ACH y paga por transferencia mientras se migra a cobro
   * automático. Se expone solo para etiquetarlo en la UI ("Manual / Zelle") y
   * que no parezca un bug del sistema. NUNCA se resta de ningún cálculo.
   */
  manualMrrUsd: number;
  manualSubscriptions: number;
  /**
   * Cuentas descartadas del conteo y por qué. Los duplicados que aparecen aquí
   * son SIEMPRE cuentas sin plan de pago (aportan $0): la regla nunca excluye
   * ingreso. Nada se borra ni se fusiona — eso lo decide el dueño.
   */
  excluded: Array<{ contractorId: string; reason: string; email: string | null }>;
  duplicates: number;
  /** Cuentas activas totales, incluidas las que no pagan mensualidad. */
  activeAccounts: number;
  // ── Origen del dinero: ni un dólar del MRR sin procedencia identificable ──
  /** MRR con suscripción activa CONFIRMADA en Stripe. */
  stripeMrrUsd: number;
  stripeSubscriptions: number;
  /** MRR SIN contraparte en Stripe → se cobra a mano. */
  unverifiedMrrUsd: number;
  unverifiedSubscriptions: number;
  stripeCheck: { available: boolean; note?: string; activeSubscriptions: number };
  /** En Stripe pero sin contraparte local (otro producto, o sin vincular). */
  stripeOrphans: Array<{ subscriptionId: string; email: string | null; monthlyUsd: number; product: string | null }>;
  /** MRR por método de cobro: stripe / ach / zelle. Cortesía va aparte. */
  byMethod: Record<string, { mrrUsd: number; subscriptions: number }>;
  /** Valor mensual regalado. Se muestra, NO suma al MRR ni al ARR. */
  courtesyUsd: number;
  courtesySubscriptions: number;
  courtesyLines: Array<{ contractorId: string; email: string | null; planName: string; monthlyUsd: number }>;
  /** Detalle por cuenta para el bloque de diagnóstico. */
  lines: Array<{
    /** Método de cobro: stripe / ach / zelle / courtesy / unknown. */
    method: string;
    email: string | null;
    planName: string;
    monthlyUsd: number;
    billingSource: 'stripe' | 'manual' | 'unknown';
    isManual: boolean;
    /** true = suscripción activa SIN método registrado; cuenta, pero hay que etiquetarla. */
    needsReview: boolean;
    stripeMonthlyUsd: number | null;
  }>;
}

export interface CapturedRevenue {
  available: boolean;
  note?: string;
  /** Gross succeeded charges this month (USD), before fees, net of refunds. */
  grossUsd: number;
  refundedUsd: number;
  netOfRefundsUsd: number;
  charges: number;
  /** Number of LeadPrime-tagged Stripe customers scanned (0 ⇒ tagging issue). */
  customers: number;
  projectedMonthUsd: number;
  /** Stripe processing fees this month (USD) — reales cuando feesAreActual. */
  estFeesUsd: number;
  /** true = comisiones leídas de balance_transaction; false = estimadas 2.9%+30¢. */
  feesAreActual?: boolean;
}

export interface FreeCredits {
  available: boolean;
  note?: string;
  /** Real customer-acquisition give-aways this month (welcome/promo/referral). */
  cacUsd: number;
  /** Internal admin grants (test/comped) — excluded from P&L, shown for honesty. */
  internalUsd: number;
  /** All free credits granted (cacUsd + internalUsd). */
  totalUsd: number;
  byType: { type: string; usd: number; cac: boolean }[];
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
  // FUENTE ÚNICA (leadprime-mrr.ts): antes esta pantalla leía Stripe y la de
  // "By User & Churn" sumaba subscriptions.base_price_cents (DEFAULT 1500), así
  // que las dos mostraban MRR distinto y ambas estaban mal. Ahora las dos leen
  // de aquí, con el precio real del catálogo de cada plan.
  const out: Recurring = {
    available: false,
    mrrUsd: 0,
    arrUsd: 0,
    activeSubscriptions: 0,
    byPlan: [],
    manualMrrUsd: 0,
    manualSubscriptions: 0,
    excluded: [],
    duplicates: 0,
    activeAccounts: 0,
    stripeMrrUsd: 0,
    stripeSubscriptions: 0,
    unverifiedMrrUsd: 0,
    unverifiedSubscriptions: 0,
    stripeCheck: { available: false, activeSubscriptions: 0 },
    stripeOrphans: [],
    byMethod: {},
    courtesyUsd: 0,
    courtesySubscriptions: 0,
    courtesyLines: [],
    lines: [],
  };
  try {
    const { getRecurringRevenue } = await import('./leadprime-mrr');
    const rev = await getRecurringRevenue(getLeadPrimePool());
    out.available = rev.available;
    out.mrrUsd = rev.mrrUsd;
    out.arrUsd = rev.arrUsd;
    out.activeSubscriptions = rev.activeSubscriptions;
    out.activeAccounts = rev.activeAccounts;
    out.byPlan = rev.byPlan.map(p => ({ plan: p.plan, mrrUsd: p.mrrUsd, subscriptions: p.subscriptions }));
    out.manualMrrUsd = rev.manualMrrUsd;
    out.manualSubscriptions = rev.manualSubscriptions;
    out.stripeMrrUsd = rev.stripeMrrUsd;
    out.stripeSubscriptions = rev.stripeSubscriptions;
    out.unverifiedMrrUsd = rev.unverifiedMrrUsd;
    out.unverifiedSubscriptions = rev.unverifiedSubscriptions;
    out.stripeCheck = rev.stripeCheck;
    out.stripeOrphans = rev.stripeOrphans;
    out.byMethod = rev.byMethod as any;
    out.courtesyUsd = rev.courtesyUsd;
    out.courtesySubscriptions = rev.courtesySubscriptions;
    out.courtesyLines = rev.courtesyLines;
    out.lines = rev.lines.map(l => ({
      method: l.method,
      email: l.email,
      planName: l.planName,
      monthlyUsd: l.monthlyUsd,
      billingSource: l.billingSource,
      isManual: l.isManual,
      needsReview: l.needsReview,
      stripeMonthlyUsd: l.stripeMonthlyUsd,
    }));
    // Avisos accionables: dinero sin origen confirmado y coincidencias de pago.
    if (rev.unverifiedSubscriptions > 0) {
      notes.push(
        `recurring: $${rev.unverifiedMrrUsd.toFixed(2)} de MRR en ${rev.unverifiedSubscriptions} ` +
        `suscripción(es) SIN contraparte en Stripe — se cobran a mano`
      );
    }
    if (rev.stripeOrphans.length > 0) {
      notes.push(
        `recurring: ${rev.stripeOrphans.length} suscripción(es) activas en Stripe sin contraparte local ` +
        `(no suman al MRR): ${rev.stripeOrphans.map(o => o.email ?? o.subscriptionId).join(', ')}`
      );
    }
    if (rev.courtesySubscriptions > 0) {
      notes.push(
        `recurring: $${rev.courtesyUsd.toFixed(2)}/mes en ${rev.courtesySubscriptions} suscripción(es) de ` +
        `CORTESÍA — valor regalado, NO cuenta como MRR ni ARR`
      );
    }
    out.excluded = rev.excluded;
    out.duplicates = rev.excluded.filter(e => /duplicad/i.test(e.reason)).length;
    if (rev.note) out.note = rev.note;
    if (rev.manualSubscriptions > 0) {
      notes.push(
        `recurring: $${rev.manualMrrUsd.toFixed(2)} de ${rev.manualSubscriptions} suscripción(es) cobradas ` +
        `MANUALMENTE (Zelle/transferencia) — ingreso real, pendiente de migrar a cobro automático`
      );
    }
    if (rev.excluded.length > 0) {
      // El texto decía "duplicadas" mucho después de que esa regla se retirara.
      // Se arma con los motivos REALES, contados de la propia lista.
      const porMotivo = new Map<string, number>();
      for (const e of rev.excluded) {
        const clave = /cortes/i.test(e.reason) ? 'cortesía'
          : /sin mensualidad/i.test(e.reason) ? 'sin mensualidad'
          : /demo/i.test(e.reason) ? 'cuenta demo'
          : 'otro motivo';
        porMotivo.set(clave, (porMotivo.get(clave) ?? 0) + 1);
      }
      const detalle = Array.from(porMotivo.entries()).map(([k, n]) => `${n} ${k}`).join(', ');
      notes.push(`recurring: ${rev.excluded.length} cuenta(s) fuera del MRR (${detalle})`);
    }
  } catch (err: any) {
    out.note = `MRR no disponible: ${err.message}`;
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
    customers: 0,
    projectedMonthUsd: 0,
    estFeesUsd: 0,
    feesAreActual: false,
  };
  const stripe = getStripe();
  if (!stripe) {
    out.note = 'No Stripe key (LEADPRIME_STRIPE_SECRET_KEY / STRIPE_SECRET_KEY)';
    notes.push(`captured: ${out.note}`);
    return out;
  }
  try {
    const { gross, refunded, count, customers, actualFees, feesFromCharges } = await sumLeadPrimeCharges(stripe, monthStartUnix());
    const net = gross - refunded;
    out.available = true;
    out.charges = count;
    out.customers = customers;
    out.grossUsd = round(gross);
    out.refundedUsd = round(refunded);
    out.netOfRefundsUsd = round(net);
    out.projectedMonthUsd = round(project(net));
    // Comisión real cuando Stripe la reportó; la estimación solo cubre los
    // cargos que no traían balance_transaction (así el total nunca queda corto).
    const estimatedForMissing = (count - feesFromCharges) * FEE_FIXED + (feesFromCharges === count ? 0 : gross * FEE_PCT * ((count - feesFromCharges) / Math.max(count, 1)));
    out.estFeesUsd = feesFromCharges > 0
      ? round(actualFees + Math.max(0, estimatedForMissing))
      : round(gross * FEE_PCT + count * FEE_FIXED);
    out.feesAreActual = feesFromCharges === count && count > 0;
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

// ── Free credits granted this month (CAC + internal grants) ─────────────────────

const FREE_CREDIT_SET = new Set(FREE_CREDIT_TYPES);
const REAL_CAC_SET = new Set(REAL_CAC_TYPES);

async function getFreeCredits(pool: Pool, notes: string[]): Promise<FreeCredits> {
  const out: FreeCredits = { available: false, cacUsd: 0, internalUsd: 0, totalUsd: 0, byType: [] };
  try {
    const r = await pool.query(
      `SELECT type, SUM(amount_cents)::bigint AS cents
         FROM wallet_transactions
        WHERE amount_cents > 0
          AND created_at >= date_trunc('month', now())
        GROUP BY type
        ORDER BY cents DESC`
    );
    let cac = 0;
    let internal = 0;
    const byType: { type: string; usd: number; cac: boolean }[] = [];
    for (const row of r.rows) {
      const type = String(row.type);
      if (!FREE_CREDIT_SET.has(type)) continue; // exclude real Stripe top-ups
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
  // Only real customer-acquisition give-aways hit operating profit. Internal admin
  // grants are excluded (and when any free credit is *consumed* its cost already
  // shows up in COGS, so subtracting the full grant would double-count).
  const freeCreditsUsd = freeCredits.cacUsd;
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
    { label: 'Real CAC credits', deltaUsd: -freeCreditsUsd, kind: 'out' },
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
  /** Suscripciones que aportan dinero. NO es lo mismo que cuentas activas. */
  activeSubscriptions: number;
  /**
   * Cuentas con suscripción activa, incluidas las que no pagan mensualidad.
   * El rótulo "21 subscriptions" contaba ESTO y lo llamaba suscripciones, al
   * lado de un MRR que solo incluía las 5 de pago.
   */
  activeAccounts: number;
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
    activeAccounts: 0,
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
    // MISMA FUENTE que el P&L. Antes esta función tenía su propia consulta sin
    // las exclusiones (demo, duplicados, planes sin mensualidad) y contaba FILAS
    // en vez de suscripciones de pago: por eso "By User & Churn" mostraba
    // $1,594 / 21 mientras el P&L mostraba $1,345 / 5. Mientras existan dos
    // consultas para el mismo número, tarde o temprano vuelven a divergir.
    const { getRecurringRevenue } = await import('./leadprime-mrr');
    const rev = await getRecurringRevenue(pool);
    if (!rev.available) throw new Error(rev.note || 'MRR no disponible');

    out.available = true;
    out.activeSubscriptions = rev.activeSubscriptions;
    out.activeAccounts = rev.activeAccounts;
    out.activeMrrUsd = rev.mrrUsd;
    out.newCount = rev.movements.newCount;
    out.newMrrUsd = rev.movements.newMrrUsd;
    out.churnedCount = rev.movements.churnedCount;
    out.churnedMrrUsd = rev.movements.churnedMrrUsd;
    out.netNewMrrUsd = rev.movements.netNewMrrUsd;
    out.atRiskCount = rev.movements.atRiskCount;
    out.atRiskMrrUsd = rev.movements.atRiskMrrUsd;
    out.logoChurnRatePct = rev.movements.logoChurnRatePct;
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
    const creditList = FREE_CREDIT_TYPES.map((t) => `'${t}'`).join(',');
    const moneyList = Array.from(REAL_MONEY_TYPES).map((t) => `'${t}'`).join(',');
    const r = await pool.query(
      `WITH sub AS (
         -- Precio REAL del catálogo (o el acordado si el cobro es manual/Zelle).
         -- base_price_cents tiene DEFAULT 1500, así que usarlo hacía valer $15
         -- a toda cuenta — incluidas las gratis — e inflaba LTV y LTV:CAC.
         SELECT s.contractor_id, s.status, s.plan_name, s.created_at,
                ${PLAN_PRICE_CENTS_SQL} AS base_price_cents,
                EXTRACT(EPOCH FROM (COALESCE(s.canceled_at, now()) - s.created_at)) / 2629800.0 AS months_active
           FROM subscriptions s
           LEFT JOIN plan_definitions pd ON pd.plan_name = s.plan_name
           LEFT JOIN contractor_subscription_config csc
                  ON csc.contractor_id = s.contractor_id AND csc.enabled = true
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
    const creditList = FREE_CREDIT_TYPES.map((t) => `'${t}'`).join(',');
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
      `SELECT s.contractor_id, s.status, s.cancel_at_period_end,
              c.name, c.email,
              -- Precio real del catálogo, no base_price_cents (DEFAULT 1500).
              ${PLAN_PRICE_CENTS_SQL} AS base_price_cents
         FROM subscriptions s
         LEFT JOIN contractors c        ON c.id = s.contractor_id
         LEFT JOIN plan_definitions pd  ON pd.plan_name = s.plan_name
         LEFT JOIN contractor_subscription_config csc
                ON csc.contractor_id = s.contractor_id AND csc.enabled = true
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
