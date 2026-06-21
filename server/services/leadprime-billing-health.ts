/**
 * LeadPrime Billing Health Monitor — Chyrris KAI Admin Panel
 *
 * READ-ONLY diagnostic layer over the LeadPrime billing system. This module
 * NEVER moves money, NEVER writes to wallets / wallet_transactions /
 * usage_events, and NEVER mutates any LeadPrime row. It only runs SELECTs to
 * surface failure patterns in the 2-layer billing protection:
 *
 *   Layer 1 — atomic deduction at point of use (billingGuard / billingEnforcer)
 *   Layer 2 — billingReconciliationWorker (retroactively charges escaped usage)
 *
 * Detectors (all best-effort, degrade gracefully if a table/column is absent):
 *   1. Negative wallet balances — should be impossible with atomic deduction.
 *   2. Reconciliation activity — how many charges Layer 2 had to apply
 *      retroactively (description LIKE '[Reconciled]%'). High counts mean
 *      Layer 1 is leaking.
 *   3. Uncharged usage (last 24h) — usage_events with cost > 0 that have NO
 *      matching wallet_transaction within ±5min / ±2¢ (amount-match, the same
 *      robust join the worker uses). These are potential money leaks.
 *   4. Reconcile failures — usage_events marked reconcile_failed (insufficient
 *      funds) that never got billed.
 *   5. billing_retry_queue backlog — Layer 1 post-action deduction failures
 *      waiting to be drained.
 *
 * Schema note: wallet_transactions.type for the SAME action is inconsistent vs
 * usage_events.event_type (e.g. campaign SMS tracks 'sms' but deducts
 * 'sms_campaign'), so matching is done by AMOUNT, not by type string.
 * usage_events.cost (dollars) equals the billed amount.
 */

import { Pool } from 'pg';

let leadprimePool: Pool | null = null;

function getLeadPrimePool(): Pool {
  if (!leadprimePool) {
    const url = process.env.LEADPRIME_DATABASE_URL;
    if (!url) {
      throw new Error('LEADPRIME_DATABASE_URL environment variable is not set');
    }
    leadprimePool = new Pool({
      connectionString: url,
      ssl: { rejectUnauthorized: false },
      max: 3,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
    });
    console.log('[LeadPrime BillingHealth] Pool initialized');
  }
  return leadprimePool;
}

/** Postgres error codes we treat as "feature not present" → degrade silently. */
const MISSING_SCHEMA_CODES = new Set(['42P01', '42703']); // undefined_table, undefined_column

function isMissingSchema(err: any): boolean {
  return !!err && MISSING_SCHEMA_CODES.has(err.code);
}

export interface NegativeBalance {
  contractorId: string;
  contractorName: string | null;
  contractorEmail: string | null;
  balanceCents: number;
}

export interface UnchargedUsageRow {
  eventType: string;
  count: number;
  totalCostCents: number;
}

export interface ReconciledActivityRow {
  eventType: string;
  count: number;
  totalCents: number;
}

export interface BillingHealthDetector<T> {
  available: boolean; // false when the underlying table/column is missing
  count: number;
  rows: T[];
}

export interface BillingHealth {
  generatedAt: string;
  /** Wallets with a balance below zero (atomic deduction should prevent this). */
  negativeBalances: BillingHealthDetector<NegativeBalance>;
  /** Retroactive charges applied by the reconciliation worker (last 7 days). */
  reconciledActivity7d: BillingHealthDetector<ReconciledActivityRow> & {
    totalCents: number;
  };
  /** Usage with cost>0 and no matching wallet charge in last 24h (amount-match). */
  unchargedUsage24h: BillingHealthDetector<UnchargedUsageRow> & {
    totalCostCents: number;
  };
  /** Usage events flagged reconcile_failed (insufficient funds, never billed). */
  reconcileFailures: BillingHealthDetector<{ eventType: string; count: number; totalCostCents: number }>;
  /** Pending entries in the Layer-1 retry queue. */
  retryQueueBacklog: BillingHealthDetector<{ status: string; count: number; totalCents: number }>;
  /** Non-fatal notes (e.g. which detectors degraded). */
  notes: string[];
}

/** Event types that carry a real cost and should always have a matching charge. */
const BILLABLE_EVENT_TYPES = [
  'sms', 'voice', 'ai_voice', 'emails', 'ai', 'phone_number', 'mms',
  'global_chat', 'web_search', 'document_gen',
  'website_deploy', 'website_modify', 'website_hosting',
];

async function detectNegativeBalances(
  pool: Pool,
  notes: string[],
): Promise<BillingHealthDetector<NegativeBalance>> {
  try {
    const result = await pool.query(`
      SELECT w.contractor_id, w.balance_cents, c.name, c.email
      FROM wallets w
      LEFT JOIN contractors c ON c.id = w.contractor_id
      WHERE w.balance_cents < 0
      ORDER BY w.balance_cents ASC
      LIMIT 100
    `);
    return {
      available: true,
      count: result.rows.length,
      rows: result.rows.map(r => ({
        contractorId: r.contractor_id,
        contractorName: r.name ?? null,
        contractorEmail: r.email ?? null,
        balanceCents: parseInt(r.balance_cents) || 0,
      })),
    };
  } catch (err: any) {
    if (isMissingSchema(err)) {
      notes.push('negativeBalances: wallets table/column unavailable');
      return { available: false, count: 0, rows: [] };
    }
    throw err;
  }
}

async function detectReconciledActivity(
  pool: Pool,
  notes: string[],
): Promise<BillingHealthDetector<ReconciledActivityRow> & { totalCents: number }> {
  try {
    const result = await pool.query(`
      SELECT
        COALESCE(type, 'unknown') AS event_type,
        COUNT(*) AS cnt,
        COALESCE(SUM(ABS(amount_cents)), 0) AS total_cents
      FROM wallet_transactions
      WHERE description LIKE '[Reconciled]%'
        AND created_at >= NOW() - INTERVAL '7 days'
        AND amount_cents < 0
      GROUP BY 1
      ORDER BY total_cents DESC
    `);
    const rows = result.rows.map(r => ({
      eventType: r.event_type,
      count: parseInt(r.cnt) || 0,
      totalCents: parseInt(r.total_cents) || 0,
    }));
    return {
      available: true,
      count: rows.reduce((s, r) => s + r.count, 0),
      totalCents: rows.reduce((s, r) => s + r.totalCents, 0),
      rows,
    };
  } catch (err: any) {
    if (isMissingSchema(err)) {
      notes.push('reconciledActivity7d: wallet_transactions table/column unavailable');
      return { available: false, count: 0, totalCents: 0, rows: [] };
    }
    throw err;
  }
}

async function detectUnchargedUsage(
  pool: Pool,
  notes: string[],
): Promise<BillingHealthDetector<UnchargedUsageRow> & { totalCostCents: number }> {
  try {
    // Mirror the reconciliation worker's amount-match join, type-agnostic.
    const result = await pool.query(
      `
      SELECT
        ue.event_type,
        COUNT(*) AS cnt,
        COALESCE(SUM(ROUND(ue.cost * 100)), 0) AS total_cost_cents
      FROM usage_events ue
      WHERE ue.created_at >= NOW() - INTERVAL '24 hours'
        AND ue.created_at <= NOW() - INTERVAL '20 minutes'
        AND ue.event_type = ANY($1::text[])
        AND COALESCE(ue.cost, 0) > 0
        AND (ue.stripe_usage_record_id IS NULL
             OR ue.stripe_usage_record_id NOT LIKE 'reconcile_failed%')
        AND NOT EXISTS (
          SELECT 1 FROM wallet_transactions wt
          WHERE wt.contractor_id = ue.contractor_id
            AND wt.amount_cents < 0
            AND wt.created_at >= ue.created_at - INTERVAL '5 minutes'
            AND wt.created_at <= ue.created_at + INTERVAL '5 minutes'
            AND ABS(wt.amount_cents) BETWEEN (ROUND(ue.cost * 100) - 2) AND (ROUND(ue.cost * 100) + 2)
        )
      GROUP BY ue.event_type
      ORDER BY total_cost_cents DESC
      `,
      [BILLABLE_EVENT_TYPES],
    );
    const rows = result.rows.map(r => ({
      eventType: r.event_type,
      count: parseInt(r.cnt) || 0,
      totalCostCents: parseInt(r.total_cost_cents) || 0,
    }));
    return {
      available: true,
      count: rows.reduce((s, r) => s + r.count, 0),
      totalCostCents: rows.reduce((s, r) => s + r.totalCostCents, 0),
      rows,
    };
  } catch (err: any) {
    if (isMissingSchema(err)) {
      notes.push('unchargedUsage24h: usage_events table/column unavailable');
      return { available: false, count: 0, totalCostCents: 0, rows: [] };
    }
    throw err;
  }
}

async function detectReconcileFailures(
  pool: Pool,
  notes: string[],
): Promise<BillingHealthDetector<{ eventType: string; count: number; totalCostCents: number }>> {
  try {
    const result = await pool.query(`
      SELECT
        event_type,
        COUNT(*) AS cnt,
        COALESCE(SUM(ROUND(cost * 100)), 0) AS total_cost_cents
      FROM usage_events
      WHERE stripe_usage_record_id LIKE 'reconcile_failed%'
        AND created_at >= NOW() - INTERVAL '30 days'
      GROUP BY event_type
      ORDER BY total_cost_cents DESC
    `);
    const rows = result.rows.map(r => ({
      eventType: r.event_type,
      count: parseInt(r.cnt) || 0,
      totalCostCents: parseInt(r.total_cost_cents) || 0,
    }));
    return {
      available: true,
      count: rows.reduce((s, r) => s + r.count, 0),
      rows,
    };
  } catch (err: any) {
    if (isMissingSchema(err)) {
      notes.push('reconcileFailures: usage_events table/column unavailable');
      return { available: false, count: 0, rows: [] };
    }
    throw err;
  }
}

async function detectRetryQueueBacklog(
  pool: Pool,
  notes: string[],
): Promise<BillingHealthDetector<{ status: string; count: number; totalCents: number }>> {
  try {
    const result = await pool.query(`
      SELECT
        COALESCE(status, 'pending') AS status,
        COUNT(*) AS cnt,
        COALESCE(SUM(amount_cents), 0) AS total_cents
      FROM billing_retry_queue
      WHERE COALESCE(status, 'pending') <> 'completed'
      GROUP BY 1
      ORDER BY total_cents DESC
    `);
    const rows = result.rows.map(r => ({
      status: r.status,
      count: parseInt(r.cnt) || 0,
      totalCents: parseInt(r.total_cents) || 0,
    }));
    return {
      available: true,
      count: rows.reduce((s, r) => s + r.count, 0),
      rows,
    };
  } catch (err: any) {
    if (isMissingSchema(err)) {
      notes.push('retryQueueBacklog: billing_retry_queue table not present');
      return { available: false, count: 0, rows: [] };
    }
    throw err;
  }
}

/**
 * Run all read-only billing-health detectors and return a consolidated report.
 * Detectors run independently; one failing/missing does not block the rest.
 */
export async function getBillingHealth(): Promise<BillingHealth> {
  const pool = getLeadPrimePool();
  const notes: string[] = [];

  const [
    negativeBalances,
    reconciledActivity7d,
    unchargedUsage24h,
    reconcileFailures,
    retryQueueBacklog,
  ] = await Promise.all([
    detectNegativeBalances(pool, notes),
    detectReconciledActivity(pool, notes),
    detectUnchargedUsage(pool, notes),
    detectReconcileFailures(pool, notes),
    detectRetryQueueBacklog(pool, notes),
  ]);

  return {
    generatedAt: new Date().toISOString(),
    negativeBalances,
    reconciledActivity7d,
    unchargedUsage24h,
    reconcileFailures,
    retryQueueBacklog,
    notes,
  };
}
