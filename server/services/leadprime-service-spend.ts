/**
 * LeadPrime Service Spend & ROI Monitor — Chyrris KAI Admin Panel
 *
 * READ-ONLY. Answers the operator questions:
 *   - How much am I spending on each external provider this month, and where is
 *     it heading (projection)?
 *   - Which provider is close to its plan / credit limit?
 *   - Which provider is failing (suspended / past-due / auth error)?
 *   - How much do I bill my users for that usage (revenue) vs what it actually
 *     costs me (margin / ROI) — i.e. which services actually pay for themselves?
 *
 * Providers covered:
 *   - Anthropic  (Claude tokens)        → Admin Usage & Cost API   (ANTHROPIC_ADMIN_KEY)
 *   - OpenAI     (transcriptions + LLM) → Organization Costs API   (OPENAI_ADMIN_KEY)
 *   - Twilio     (SMS / voice / numbers)→ Usage Records + Balance  (TWILIO_ACCOUNT_SID/AUTH_TOKEN)
 *   - ElevenLabs (AI call voices)       → User Subscription        (ELEVENLABS_API_KEY)
 *
 * "Billed to users" comes from LeadPrime's own `usage_events` table
 * (total_cost_cents = what we charge). Provider "actual spend" comes from each
 * provider's billing API. margin = billed − actual.
 *
 * Every fetcher degrades gracefully: a missing key, a 4xx, or a parse miss
 * returns `available:false` with a human note — it never throws.
 */

import { Pool } from 'pg';
import { splitNotes, type ClassifiedNote } from './detector-availability';

let spendPool: Pool | null = null;

function getLeadPrimePool(): Pool {
  if (!spendPool) {
    const url = process.env.LEADPRIME_DATABASE_URL;
    if (!url) throw new Error('LEADPRIME_DATABASE_URL environment variable is not set');
    spendPool = new Pool({
      connectionString: url,
      ssl: { rejectUnauthorized: false },
      max: 2,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
    });
    console.log('[LeadPrime ServiceSpend] Pool initialized');
  }
  return spendPool;
}

// ── Types ─────────────────────────────────────────────────────────────────────

export type ProviderId = 'anthropic' | 'openai' | 'twilio' | 'elevenlabs';
export type Severity = 'ok' | 'watch' | 'alarm' | 'unknown';

export interface ProviderSpend {
  provider: ProviderId;
  label: string;
  available: boolean;
  note?: string;
  /** Actual provider spend this calendar month (USD). null = provider doesn't expose $. */
  monthSpendUsd: number | null;
  projectedMonthUsd: number | null;
  todaySpendUsd: number | null;
  /** Plan / credit limit signals (where the provider exposes them). */
  planTier?: string | null;
  usagePct?: number | null; // 0..1 of plan/credit consumed
  limitLabel?: string | null; // human "1.2M / 2M chars" or "balance $4.10"
  resetAt?: string | null; // ISO when the allowance resets
  /**
   * Prepaid account balance in USD, when the provider exposes one (Twilio).
   * Numeric on purpose: it used to exist only inside the `limitLabel` string,
   * so nothing downstream could alert on "you have $4 left".
   */
  balanceUsd?: number | null;
  /** Health. */
  accountStatus?: string | null;
  paymentIssue: boolean; // suspended / past-due / 402 (out of credit)
  keyIssue: boolean; // key present but rejected: 401/403 → expired / revoked / wrong scope
  configured: boolean; // env key was set (distinguishes "off" from "broken")
  severity: Severity;
  /** ROI (from usage_events). */
  billedToUsersUsd: number;
  marginUsd: number | null; // billed − actual (null when actual unknown)
  marginPct: number | null;
}

export interface TopConsumer {
  contractorId: string;
  billedUsd: number;
  events: number;
}

export interface ServiceSpend {
  generatedAt: string;
  providers: ProviderSpend[];
  totals: {
    monthSpendUsd: number; // sum over providers that expose $
    billedToUsersUsd: number; // all providers
    marginUsd: number;
    marginPct: number | null;
  };
  topConsumers: TopConsumer[];
  /** Solo problemas reales. Las capacidades ausentes van en `unavailable`. */
  notes: string[];
  /** Detectores apagados por falta de tabla/clave/plan — no son fallos. */
  unavailable: ClassifiedNote[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const MISSING_SCHEMA_CODES = new Set(['42P01', '42703', '42501']);
function isMissingSchema(err: any): boolean {
  return !!err && MISSING_SCHEMA_CODES.has(err.code);
}

function monthStart(): Date {
  const n = new Date();
  return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), 1));
}
function daysElapsedThisMonth(): number {
  const n = new Date();
  // at least 1 to avoid divide-by-zero on the 1st
  return Math.max(1, n.getUTCDate() - 1 + n.getUTCHours() / 24);
}
function daysInThisMonth(): number {
  const n = new Date();
  return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth() + 1, 0)).getUTCDate();
}
function project(monthSoFar: number): number {
  return (monthSoFar / daysElapsedThisMonth()) * daysInThisMonth();
}

/**
 * Classify a failed provider HTTP response into the operator-facing alert kind:
 *   - 401/403 → key expired / revoked / wrong scope (keyIssue)
 *   - 402     → out of credit / payment required (paymentIssue)
 *   - 429/5xx → transient (neither flag; just a note)
 * Sets severity 'alarm' for key/payment problems so they bubble to the deck.
 */
function applyHttpError(base: ProviderSpend, status: number, body: string, label: string, notes: string[]): ProviderSpend {
  base.keyIssue = status === 401 || status === 403;
  base.paymentIssue = status === 402;
  if (base.keyIssue) base.note = `${label} API ${status}: key expired/invalid or missing permission`;
  else if (base.paymentIssue) base.note = `${label} API ${status}: payment required — likely out of credit`;
  else base.note = `${label} API ${status}: ${body.slice(0, 120)}`;
  base.severity = base.keyIssue || base.paymentIssue ? 'alarm' : 'unknown';
  notes.push(`${label.toLowerCase()}: ${base.note}`);
  return base;
}

/** Map a usage_events.event_type to the provider that ultimately incurs the cost. */
function providerForEventType(t: string): ProviderId | null {
  switch (t) {
    case 'sms':
    case 'mms':
    case 'voice':
    case 'phone_number':
      return 'twilio';
    // La voz con IA se cobra al usuario por minuto, pero el costo se reparte
    // entre Twilio (minutos) y ElevenLabs (síntesis). Se atribuye a ElevenLabs
    // para que deje de aparecer con $0 facturado y margen sin sentido; el costo
    // real de cada uno vive por separado en provider_costs.
    case 'ai_voice':
      return 'elevenlabs';
    case 'ai':
    case 'global_chat':
    case 'web_search':
    case 'document_gen':
    case 'website_deploy':
    case 'website_modify':
    case 'website_hosting':
      return 'anthropic'; // LLM bucket — actual cost split across Anthropic + OpenAI
    default:
      return null;
  }
}

// ── DB: what we bill users, mapped to provider ──────────────────────────────────

interface BilledRollup {
  byProvider: Record<ProviderId, number>; // USD billed to users this month
  topConsumers: TopConsumer[];
}

async function getBilledRollup(pool: Pool, notes: string[]): Promise<BilledRollup> {
  const byProvider: Record<ProviderId, number> = {
    anthropic: 0,
    openai: 0,
    twilio: 0,
    elevenlabs: 0,
  };
  let topConsumers: TopConsumer[] = [];

  // NOTE: production usage_events bills via the `cost` column (NUMERIC dollars =
  // quantity * unit_cost), NOT total_cost_cents. (A legacy migration defined a
  // total_cost_cents column that never materialized — the live INSERTs in
  // usageTrackingService write `cost`.)
  try {
    const r = await pool.query(
      `SELECT event_type, SUM(cost)::numeric AS usd
         FROM usage_events
        WHERE created_at >= date_trunc('month', now())
        GROUP BY event_type`
    );
    for (const row of r.rows) {
      const p = providerForEventType(String(row.event_type));
      if (!p) continue;
      byProvider[p] += Number(row.usd || 0);
    }
  } catch (err: any) {
    if (isMissingSchema(err)) notes.push('billed: usage_events not available');
    else notes.push(`billed: ${err.message}`);
  }

  try {
    const r = await pool.query(
      `SELECT contractor_id,
              SUM(cost)::numeric AS usd,
              COUNT(*)::int AS n
         FROM usage_events
        WHERE created_at >= date_trunc('month', now())
        GROUP BY contractor_id
        ORDER BY usd DESC
        LIMIT 10`
    );
    topConsumers = r.rows.map((row) => ({
      contractorId: String(row.contractor_id),
      billedUsd: Number(row.usd || 0),
      events: Number(row.n || 0),
    }));
  } catch (err: any) {
    if (!isMissingSchema(err)) notes.push(`topConsumers: ${err.message}`);
  }

  return { byProvider, topConsumers };
}

// ── Provider: Anthropic (Admin Usage & Cost API) ────────────────────────────────

async function getAnthropicSpend(billedUsd: number, notes: string[]): Promise<ProviderSpend> {
  const base: ProviderSpend = {
    provider: 'anthropic',
    label: 'Anthropic (Claude)',
    available: false,
    monthSpendUsd: null,
    projectedMonthUsd: null,
    todaySpendUsd: null,
    paymentIssue: false,
    keyIssue: false,
    configured: false,
    severity: 'unknown',
    billedToUsersUsd: billedUsd,
    marginUsd: null,
    marginPct: null,
  };
  const key = process.env.ANTHROPIC_ADMIN_KEY;
  if (!key) {
    base.note = 'ANTHROPIC_ADMIN_KEY not set — Claude spend disabled';
    notes.push(`anthropic: ${base.note}`);
    return base;
  }
  base.configured = true;
  const startingAt = monthStart().toISOString();
  const endingAt = new Date().toISOString();
  try {
    let month = 0;
    let today = 0;
    const todayKey = new Date().toISOString().slice(0, 10);
    let page: string | undefined;
    // Anthropic paginates daily buckets (has_more / next_page). Walk every page
    // so a full month is not truncated to the default page size.
    for (let i = 0; i < 40; i++) {
      const params = new URLSearchParams({
        starting_at: startingAt,
        ending_at: endingAt,
        bucket_width: '1d',
        limit: '31',
      });
      if (page) params.set('page', page);
      const resp = await fetch(
        `https://api.anthropic.com/v1/organizations/cost_report?${params}`,
        {
          headers: {
            'x-api-key': key,
            'anthropic-version': '2023-06-01',
            Accept: 'application/json',
          },
          signal: AbortSignal.timeout(12000),
        }
      );
      if (!resp.ok) {
        const body = await resp.text().catch(() => '');
        return applyHttpError(base, resp.status, body, 'Anthropic', notes);
      }
      const json: any = await resp.json();
      const buckets: any[] = Array.isArray(json?.data) ? json.data : [];
      for (const b of buckets) {
        const results: any[] = Array.isArray(b?.results) ? b.results : [];
        // CRITICAL: Anthropic's `amount` is a decimal STRING in the LOWEST
        // currency unit (cents) — "123.45" USD == $1.2345. Divide by 100 to get
        // dollars. (It was summed as dollars → 100× overstatement, e.g. real
        // ~$55/mo was shown as ~$5535/mo, which also blew up COGS & margins.)
        const bucketTotal = results.reduce((s, r) => s + (Number(r?.amount) || 0) / 100, 0);
        month += bucketTotal;
        if (String(b?.starting_at ?? '').slice(0, 10) === todayKey) today += bucketTotal;
      }
      if (json?.has_more && json?.next_page) page = String(json.next_page);
      else break;
    }
    base.available = true;
    base.monthSpendUsd = month;
    base.todaySpendUsd = today;
    base.projectedMonthUsd = project(month);
    // La API de costos no expone el estado de la cuenta: decir 'active' era
    // inventar salud. Si la petición respondió, lo único cierto es que la key
    // sirve; el estado real queda como 'reachable'.
    base.accountStatus = 'reachable';
    base.marginUsd = billedUsd - month;
    base.marginPct = month > 0 ? (billedUsd - month) / month : null;
    base.severity = month > 0 && billedUsd < month ? 'watch' : 'ok';
  } catch (err: any) {
    base.note = `Anthropic fetch failed: ${err.message}`;
    notes.push(`anthropic: ${base.note}`);
  }
  return base;
}

// ── Provider: OpenAI (Organization Costs API) ──────────────────────────────────

async function getOpenAiSpend(billedUsd: number, notes: string[]): Promise<ProviderSpend> {
  const base: ProviderSpend = {
    provider: 'openai',
    label: 'OpenAI (transcription + LLM)',
    available: false,
    monthSpendUsd: null,
    projectedMonthUsd: null,
    todaySpendUsd: null,
    paymentIssue: false,
    keyIssue: false,
    configured: false,
    severity: 'unknown',
    billedToUsersUsd: billedUsd,
    marginUsd: null,
    marginPct: null,
  };
  const key = process.env.OPENAI_ADMIN_KEY;
  if (!key) {
    base.note = 'OPENAI_ADMIN_KEY not set — OpenAI spend disabled';
    notes.push(`openai: ${base.note}`);
    return base;
  }
  base.configured = true;
  const params = new URLSearchParams({
    start_time: String(Math.floor(monthStart().getTime() / 1000)),
    bucket_width: '1d',
    limit: '180',
  });
  try {
    const resp = await fetch(`https://api.openai.com/v1/organization/costs?${params}`, {
      headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(12000),
    });
    if (!resp.ok) {
      const body = await resp.text().catch(() => '');
      return applyHttpError(base, resp.status, body, 'OpenAI', notes);
    }
    const json: any = await resp.json();
    const buckets: any[] = Array.isArray(json?.data) ? json.data : [];
    let month = 0;
    let today = 0;
    const todayStart = Math.floor(new Date().setUTCHours(0, 0, 0, 0) / 1000);
    for (const b of buckets) {
      const results: any[] = Array.isArray(b?.results) ? b.results : [];
      const bucketTotal = results.reduce((s, r) => s + Number(r?.amount?.value ?? 0), 0);
      month += bucketTotal;
      if (Number(b?.start_time ?? 0) >= todayStart) today += bucketTotal;
    }
    base.available = true;
    base.monthSpendUsd = month;
    base.todaySpendUsd = today;
    base.projectedMonthUsd = project(month);
    // La API de costos no expone el estado de la cuenta: decir 'active' era
    // inventar salud. Si la petición respondió, lo único cierto es que la key
    // sirve; el estado real queda como 'reachable'.
    base.accountStatus = 'reachable';
    base.marginUsd = billedUsd - month;
    base.marginPct = month > 0 ? (billedUsd - month) / month : null;
    base.severity = month > 0 && billedUsd < month ? 'watch' : 'ok';
  } catch (err: any) {
    base.note = `OpenAI fetch failed: ${err.message}`;
    notes.push(`openai: ${base.note}`);
  }
  return base;
}

// ── Provider: Twilio (Usage Records + Balance + Account status) ─────────────────

async function getTwilioSpend(billedUsd: number, notes: string[]): Promise<ProviderSpend> {
  const base: ProviderSpend = {
    provider: 'twilio',
    label: 'Twilio (SMS / voice)',
    available: false,
    monthSpendUsd: null,
    projectedMonthUsd: null,
    todaySpendUsd: null,
    paymentIssue: false,
    keyIssue: false,
    configured: false,
    severity: 'unknown',
    billedToUsersUsd: billedUsd,
    marginUsd: null,
    marginPct: null,
  };
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !token) {
    base.note = 'TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN not set — Twilio spend disabled';
    notes.push(`twilio: ${base.note}`);
    return base;
  }
  base.configured = true;
  const auth = 'Basic ' + Buffer.from(`${sid}:${token}`).toString('base64');
  const headers = { Authorization: auth, Accept: 'application/json' };
  const root = `https://api.twilio.com/2010-04-01/Accounts/${sid}`;

  try {
    // Spend this month (category=totalprice rolls up everything).
    const usageResp = await fetch(
      `${root}/Usage/Records/ThisMonth.json?Category=totalprice`,
      { headers, signal: AbortSignal.timeout(12000) }
    );
    if (!usageResp.ok) {
      const body = await usageResp.text().catch(() => '');
      return applyHttpError(base, usageResp.status, body, 'Twilio', notes);
    }
    const usageJson: any = await usageResp.json();
    const recs: any[] = Array.isArray(usageJson?.usage_records) ? usageJson.usage_records : [];
    const month = recs.reduce((s, r) => s + Number(r?.price ?? 0), 0);
    base.available = true;
    base.monthSpendUsd = month;
    base.projectedMonthUsd = project(month);
    base.marginUsd = billedUsd - month;
    base.marginPct = month > 0 ? (billedUsd - month) / month : null;

    // Account status (suspended / closed → payment / compliance issue).
    try {
      const acctResp = await fetch(`${root}.json`, { headers, signal: AbortSignal.timeout(8000) });
      if (acctResp.ok) {
        const acct: any = await acctResp.json();
        base.accountStatus = acct?.status ?? null; // active | suspended | closed
        base.planTier = acct?.type ?? null; // Trial | Full
        if (base.accountStatus && base.accountStatus !== 'active') base.paymentIssue = true;
      }
    } catch {
      /* status optional */
    }

    // Prepaid balance — Twilio's real "limit" is running out of balance.
    try {
      const balResp = await fetch(`${root}/Balance.json`, { headers, signal: AbortSignal.timeout(8000) });
      if (balResp.ok) {
        const bal: any = await balResp.json();
        const balance = Number(bal?.balance ?? NaN);
        if (Number.isFinite(balance)) {
          // Numérico Y formateado: el número alimenta las alertas de saldo bajo
          // (antes solo existía el texto y nada podía reaccionar a él).
          base.balanceUsd = balance;
          base.limitLabel = `balance $${balance.toFixed(2)}`;
          // % of balance the projected month would consume.
          base.usagePct = balance > 0 ? Math.min(1, base.projectedMonthUsd! / (balance + month)) : 1;
        }
      }
    } catch {
      /* balance optional */
    }

    base.severity = base.paymentIssue
      ? 'alarm'
      : base.usagePct != null && base.usagePct >= 0.9
        ? 'watch'
        : 'ok';
  } catch (err: any) {
    base.note = `Twilio fetch failed: ${err.message}`;
    notes.push(`twilio: ${base.note}`);
  }
  return base;
}

// ── Provider: ElevenLabs (Subscription = plan limit & status) ───────────────────

async function getElevenLabsSpend(billedUsd: number, notes: string[]): Promise<ProviderSpend> {
  const base: ProviderSpend = {
    provider: 'elevenlabs',
    label: 'ElevenLabs (AI voices)',
    available: false,
    monthSpendUsd: null, // fixed-plan: $ spend not exposed; we track allowance usage
    projectedMonthUsd: null,
    todaySpendUsd: null,
    paymentIssue: false,
    keyIssue: false,
    configured: false,
    severity: 'unknown',
    billedToUsersUsd: billedUsd,
    marginUsd: null,
    marginPct: null,
  };
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) {
    base.note = 'ELEVENLABS_API_KEY not set — ElevenLabs usage disabled';
    notes.push(`elevenlabs: ${base.note}`);
    return base;
  }
  base.configured = true;
  try {
    const resp = await fetch('https://api.elevenlabs.io/v1/user/subscription', {
      headers: { 'xi-api-key': key, Accept: 'application/json' },
      signal: AbortSignal.timeout(12000),
    });
    if (!resp.ok) {
      const body = await resp.text().catch(() => '');
      return applyHttpError(base, resp.status, body, 'ElevenLabs', notes);
    }
    const sub: any = await resp.json();
    const used = Number(sub?.character_count ?? 0);
    const limit = Number(sub?.character_limit ?? 0);
    base.available = true;
    base.planTier = sub?.tier ?? null;
    base.accountStatus = sub?.status ?? null; // active | trialing | past_due | ...
    base.usagePct = limit > 0 ? Math.min(1, used / limit) : null;
    base.limitLabel = limit > 0 ? `${fmtK(used)} / ${fmtK(limit)} chars` : null;
    if (sub?.next_character_count_reset_unix) {
      base.resetAt = new Date(Number(sub.next_character_count_reset_unix) * 1000).toISOString();
    }
    base.paymentIssue = !!base.accountStatus && !['active', 'trialing', 'free'].includes(String(base.accountStatus));
    base.severity = base.paymentIssue
      ? 'alarm'
      : base.usagePct != null && base.usagePct >= 0.9
        ? 'alarm'
        : base.usagePct != null && base.usagePct >= 0.75
          ? 'watch'
          : 'ok';
  } catch (err: any) {
    base.note = `ElevenLabs fetch failed: ${err.message}`;
    notes.push(`elevenlabs: ${base.note}`);
  }
  return base;
}

function fmtK(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}

// ── Orchestrator ────────────────────────────────────────────────────────────────

export async function getServiceSpend(): Promise<ServiceSpend> {
  const notes: string[] = [];
  const pool = getLeadPrimePool();
  const billed = await getBilledRollup(pool, notes);

  const [anthropic, openai, twilio, elevenlabs] = await Promise.all([
    getAnthropicSpend(billed.byProvider.anthropic, notes),
    getOpenAiSpend(billed.byProvider.openai, notes),
    getTwilioSpend(billed.byProvider.twilio, notes),
    getElevenLabsSpend(billed.byProvider.elevenlabs, notes),
  ]);

  const providers = [anthropic, openai, twilio, elevenlabs];
  const monthSpendUsd = providers.reduce((s, p) => s + (p.monthSpendUsd ?? 0), 0);
  const billedToUsersUsd = providers.reduce((s, p) => s + p.billedToUsersUsd, 0);
  const marginUsd = billedToUsersUsd - monthSpendUsd;
  const split = splitNotes(notes);

  return {
    generatedAt: new Date().toISOString(),
    providers,
    totals: {
      monthSpendUsd,
      billedToUsersUsd,
      marginUsd,
      marginPct: monthSpendUsd > 0 ? marginUsd / monthSpendUsd : null,
    },
    topConsumers: billed.topConsumers,
    notes: split.issues,
    unavailable: split.unavailable,
  };
}
