/**
 * LeadPrime Infra & Cost Health Monitor — Chyrris KAI Admin Panel
 *
 * READ-ONLY diagnostic layer over LeadPrime's database / compute footprint.
 * It NEVER writes to the LeadPrime database and NEVER mutates Neon resources.
 * It only:
 *   - runs SELECTs against system catalogs (pg_stat_activity, pg_stat_statements)
 *     and analytics tables (usage_events, worker_runs), and
 *   - issues GET requests to the Neon billing/consumption API.
 *
 * Why this exists:
 *   With only a handful of active users a Neon project should cost almost
 *   nothing — its compute auto-suspends after ~5 min of inactivity. The classic
 *   failure mode (which already bit us once: ~731 CU-hours/month ≈ $77 from a
 *   cron pinging the DB every 4 min) is a background poller that queries the DB
 *   more often than the auto-suspend window, so the compute NEVER suspends and
 *   bills 24/7. This monitor surfaces that pattern early:
 *
 *   1. Neon compute consumption — daily active-time vs compute (CU) hours, and a
 *      projected monthly $ figure. `alwaysOn` flags days where the endpoint never
 *      suspended.
 *   2. Cost-per-active-user ratio — CU-hours / active users. Auto-scaling signal:
 *      absurd at 3 users with a 24/7 poller, normal at 200 users.
 *   3. Hot queries — pg_stat_statements top callers (a runaway loop), and live
 *      pg_stat_activity (connections + longest-running query).
 *   4. Worker heartbeats — reads the `worker_runs` table (written by the LeadPrime
 *      backend) and flags any worker whose observed interval is shorter than the
 *      Neon auto-suspend window, i.e. workers that keep compute awake.
 *
 * Every detector degrades gracefully: a missing table, missing extension, or
 * absent Neon API key returns `available: false` with a human note, never throws.
 */

import { Pool } from 'pg';

let infraPool: Pool | null = null;

function getLeadPrimePool(): Pool {
  if (!infraPool) {
    const url = process.env.LEADPRIME_DATABASE_URL;
    if (!url) {
      throw new Error('LEADPRIME_DATABASE_URL environment variable is not set');
    }
    infraPool = new Pool({
      connectionString: url,
      ssl: { rejectUnauthorized: false },
      max: 3,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
    });
    console.log('[LeadPrime InfraHealth] Pool initialized');
  }
  return infraPool;
}

/** Neon auto-suspends compute after this idle window by default (5 min). A poller
 *  firing more often than this keeps compute online 24/7 → runaway cost. */
const AUTOSUSPEND_MS = 5 * 60 * 1000;

/** Approx Neon price per compute-unit-hour (CU-hour). Override via env. The Neon
 *  API bills compute_time in CU-seconds; this only turns it into a $ estimate. */
const COST_PER_CU_HOUR = Number(process.env.NEON_COST_PER_CU_HOUR || '0.16');

/** Postgres error codes treated as "feature not present" → degrade silently. */
const MISSING_SCHEMA_CODES = new Set(['42P01', '42703', '42501']); // table, column, privilege

function isMissingSchema(err: any): boolean {
  return !!err && MISSING_SCHEMA_CODES.has(err.code);
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface Detector<T> {
  available: boolean;
  rows: T[];
}

export interface NeonDayRow {
  date: string; // YYYY-MM-DD
  activeHours: number; // wall-clock hours the endpoint was active
  computeHours: number; // CU-hours (compute_time)
  storageGb: number;
  dataTransferGb: number;
  alwaysOn: boolean; // active >= 20h/day → basically never suspended
}

export interface NeonConsumption {
  available: boolean;
  note?: string;
  days: NeonDayRow[];
  // Rollups for the current calendar month (read straight from `days`):
  monthComputeHours: number;
  monthCostUsd: number;
  projectedMonthCostUsd: number;
  alwaysOnDays: number;
  costPerCuHour: number;
}

export interface CostPerUser {
  available: boolean;
  note?: string;
  totalUsers: number;
  activeUsers30d: number;
  monthComputeHours: number;
  cuHoursPerActiveUser: number;
  /** 'ok' | 'watch' | 'alarm' — scales with user count, not raw volume. */
  severity: 'ok' | 'watch' | 'alarm' | 'unknown';
}

export interface HotQueryRow {
  query: string;
  calls: number;
  totalExecMs: number;
  meanExecMs: number;
  rows: number;
  /** calls per minute since stats reset — high value = a hammering loop. */
  callsPerMin: number | null;
}

export interface LiveActivity {
  available: boolean;
  note?: string;
  totalConnections: number;
  activeConnections: number;
  idleInTransaction: number;
  longestActiveSeconds: number | null;
  longestActiveQuery: string | null;
}

export interface WorkerRunRow {
  workerName: string;
  lastRunAt: string | null;
  lastDurationMs: number | null;
  observedIntervalMs: number | null;
  configuredIntervalMs: number | null;
  totalRuns: number;
  lastError: string | null;
  /** true when this worker polls more often than the auto-suspend window. */
  keepsComputeAwake: boolean;
}

export interface InfraHealth {
  generatedAt: string;
  autosuspendMinutes: number;
  neon: NeonConsumption;
  costPerUser: CostPerUser;
  hotQueries: Detector<HotQueryRow> & { statsResetAt: string | null };
  liveActivity: LiveActivity;
  workers: Detector<WorkerRunRow>;
  notes: string[];
}

// ── Neon consumption (external API) ─────────────────────────────────────────────

const NEON_API_BASE = 'https://console.neon.tech/api/v2';

/**
 * Pull daily consumption for the configured Neon project. Read-only GET.
 * Requires NEON_API_KEY and NEON_PROJECT_ID. NEON_ORG_ID optional (org keys).
 * Parses defensively because the response nests consumption under billing periods.
 */
async function getNeonConsumption(notes: string[]): Promise<NeonConsumption> {
  const empty = (note: string): NeonConsumption => {
    notes.push(`neon: ${note}`);
    return {
      available: false,
      note,
      days: [],
      monthComputeHours: 0,
      monthCostUsd: 0,
      projectedMonthCostUsd: 0,
      alwaysOnDays: 0,
      costPerCuHour: COST_PER_CU_HOUR,
    };
  };

  const apiKey = process.env.NEON_API_KEY;
  const projectId = process.env.NEON_PROJECT_ID;
  if (!apiKey) return empty('NEON_API_KEY not set — compute metrics disabled');
  if (!projectId) return empty('NEON_PROJECT_ID not set — compute metrics disabled');

  // Last 30 days, daily granularity.
  const to = new Date();
  const from = new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);
  const params = new URLSearchParams({
    from: from.toISOString(),
    to: to.toISOString(),
    granularity: 'daily',
    'project_ids[]': projectId,
  });
  if (process.env.NEON_ORG_ID) params.set('org_id', process.env.NEON_ORG_ID);

  let json: any;
  try {
    const resp = await fetch(`${NEON_API_BASE}/consumption_history/projects?${params}`, {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(12000),
    });
    if (!resp.ok) {
      const body = await resp.text().catch(() => '');
      return empty(`Neon API ${resp.status}: ${body.slice(0, 140)}`);
    }
    json = await resp.json();
  } catch (err: any) {
    return empty(`Neon API request failed: ${err?.message || err}`);
  }

  // Defensive flatten: projects[].periods[].consumption[] (entries carry timeframe + metrics).
  const project = Array.isArray(json?.projects) ? json.projects[0] : json?.projects;
  const entries: any[] = [];
  const collect = (arr: any) => Array.isArray(arr) && arr.forEach((e) => entries.push(e));
  if (project?.periods) project.periods.forEach((p: any) => collect(p?.consumption));
  collect(project?.consumption);
  collect(json?.consumption);

  if (entries.length === 0) {
    return empty('Neon API returned no consumption entries (check project id / org id)');
  }

  const days: NeonDayRow[] = entries
    .map((e) => {
      const start = e.timeframe_start || e.timeframe_start_inclusive || e.period_start;
      const activeSec = Number(e.active_time_seconds || 0);
      const computeSec = Number(e.compute_time_seconds || 0);
      const storageBytes = Number(e.synthetic_storage_size_bytes || 0);
      const transferBytes = Number(e.data_transfer_bytes || 0);
      const activeHours = activeSec / 3600;
      return {
        date: start ? String(start).slice(0, 10) : 'unknown',
        activeHours: round(activeHours, 2),
        computeHours: round(computeSec / 3600, 3),
        storageGb: round(storageBytes / 1e9, 3),
        dataTransferGb: round(transferBytes / 1e9, 4),
        alwaysOn: activeHours >= 20,
      };
    })
    .sort((a, b) => a.date.localeCompare(b.date));

  // Current calendar month rollups.
  const monthPrefix = to.toISOString().slice(0, 7);
  const monthDays = days.filter((d) => d.date.startsWith(monthPrefix));
  const monthComputeHours = round(sum(monthDays.map((d) => d.computeHours)), 3);
  const monthCostUsd = round(monthComputeHours * COST_PER_CU_HOUR, 2);
  const elapsedDays = Math.max(1, to.getUTCDate());
  const daysInMonth = new Date(to.getUTCFullYear(), to.getUTCMonth() + 1, 0).getUTCDate();
  const projectedMonthCostUsd = round((monthCostUsd / elapsedDays) * daysInMonth, 2);

  return {
    available: true,
    days,
    monthComputeHours,
    monthCostUsd,
    projectedMonthCostUsd,
    alwaysOnDays: days.filter((d) => d.alwaysOn).length,
    costPerCuHour: COST_PER_CU_HOUR,
  };
}

// ── Cost per active user ────────────────────────────────────────────────────────

async function getCostPerUser(
  pool: Pool,
  neon: NeonConsumption,
  notes: string[],
): Promise<CostPerUser> {
  const base: CostPerUser = {
    available: false,
    totalUsers: 0,
    activeUsers30d: 0,
    monthComputeHours: neon.monthComputeHours,
    cuHoursPerActiveUser: 0,
    severity: 'unknown',
  };

  let totalUsers = 0;
  let activeUsers30d = 0;
  try {
    const totals = await pool.query(`SELECT COUNT(*)::int AS n FROM contractors`);
    totalUsers = totals.rows[0]?.n ?? 0;
  } catch (err: any) {
    if (!isMissingSchema(err)) throw err;
    notes.push('costPerUser: contractors table unavailable');
  }
  try {
    const active = await pool.query(
      `SELECT COUNT(DISTINCT contractor_id)::int AS n
       FROM usage_events
       WHERE created_at >= NOW() - INTERVAL '30 days'`,
    );
    activeUsers30d = active.rows[0]?.n ?? 0;
  } catch (err: any) {
    if (!isMissingSchema(err)) throw err;
    notes.push('costPerUser: usage_events table unavailable');
  }

  if (!neon.available) {
    return { ...base, totalUsers, activeUsers30d, note: 'compute hours unknown (Neon API disabled)' };
  }

  const denom = Math.max(1, activeUsers30d);
  const cuHoursPerActiveUser = round(neon.monthComputeHours / denom, 2);

  // Scaling-aware severity: per-user compute should be small. With near-zero users
  // a 24/7 poller makes this explode; with hundreds of users it normalizes.
  let severity: CostPerUser['severity'] = 'ok';
  if (cuHoursPerActiveUser >= 80) severity = 'alarm';
  else if (cuHoursPerActiveUser >= 30) severity = 'watch';
  // Hard signal independent of user count: any always-on day with few users.
  if (neon.alwaysOnDays > 0 && activeUsers30d <= 10) severity = 'alarm';

  return {
    available: true,
    totalUsers,
    activeUsers30d,
    monthComputeHours: neon.monthComputeHours,
    cuHoursPerActiveUser,
    severity,
  };
}

// ── Hot queries (pg_stat_statements) ────────────────────────────────────────────

async function getHotQueries(
  pool: Pool,
  notes: string[],
): Promise<Detector<HotQueryRow> & { statsResetAt: string | null }> {
  let statsResetAt: string | null = null;
  try {
    const reset = await pool.query(`SELECT stats_reset FROM pg_stat_statements_info`);
    statsResetAt = reset.rows[0]?.stats_reset ? new Date(reset.rows[0].stats_reset).toISOString() : null;
  } catch {
    /* pg_stat_statements_info may not exist on older versions — non-fatal */
  }

  try {
    const result = await pool.query(`
      SELECT query, calls, total_exec_time, mean_exec_time, rows
      FROM pg_stat_statements
      WHERE query NOT ILIKE '%pg_stat_statements%'
      ORDER BY calls DESC
      LIMIT 15
    `);
    const minutesSinceReset = statsResetAt
      ? Math.max(1, (Date.now() - new Date(statsResetAt).getTime()) / 60000)
      : null;
    const rows: HotQueryRow[] = result.rows.map((r) => ({
      query: normalizeQuery(r.query),
      calls: Number(r.calls) || 0,
      totalExecMs: round(Number(r.total_exec_time) || 0, 1),
      meanExecMs: round(Number(r.mean_exec_time) || 0, 2),
      rows: Number(r.rows) || 0,
      callsPerMin: minutesSinceReset ? round((Number(r.calls) || 0) / minutesSinceReset, 2) : null,
    }));
    return { available: true, rows, statsResetAt };
  } catch (err: any) {
    if (isMissingSchema(err)) {
      notes.push('hotQueries: pg_stat_statements extension not enabled');
      return { available: false, rows: [], statsResetAt };
    }
    throw err;
  }
}

// ── Live activity (pg_stat_activity) ────────────────────────────────────────────

async function getLiveActivity(pool: Pool, notes: string[]): Promise<LiveActivity> {
  try {
    const result = await pool.query(`
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE state = 'active')::int AS active,
        COUNT(*) FILTER (WHERE state = 'idle in transaction')::int AS idle_in_tx,
        MAX(EXTRACT(EPOCH FROM (NOW() - query_start)))
          FILTER (WHERE state = 'active' AND query NOT ILIKE '%pg_stat_activity%') AS longest_active_sec
      FROM pg_stat_activity
      WHERE datname = current_database()
    `);
    const r = result.rows[0] || {};
    let longestQuery: string | null = null;
    if (r.longest_active_sec != null && Number(r.longest_active_sec) >= 5) {
      const lq = await pool.query(`
        SELECT query FROM pg_stat_activity
        WHERE datname = current_database() AND state = 'active'
          AND query NOT ILIKE '%pg_stat_activity%'
        ORDER BY query_start ASC LIMIT 1
      `);
      longestQuery = lq.rows[0]?.query ? normalizeQuery(lq.rows[0].query) : null;
    }
    return {
      available: true,
      totalConnections: r.total ?? 0,
      activeConnections: r.active ?? 0,
      idleInTransaction: r.idle_in_tx ?? 0,
      longestActiveSeconds: r.longest_active_sec != null ? round(Number(r.longest_active_sec), 1) : null,
      longestActiveQuery: longestQuery,
    };
  } catch (err: any) {
    if (isMissingSchema(err)) {
      notes.push('liveActivity: pg_stat_activity not accessible');
      return {
        available: false,
        totalConnections: 0,
        activeConnections: 0,
        idleInTransaction: 0,
        longestActiveSeconds: null,
        longestActiveQuery: null,
      };
    }
    throw err;
  }
}

// ── Worker heartbeats (worker_runs, written by the LeadPrime backend) ────────────

async function getWorkerHeartbeats(pool: Pool, notes: string[]): Promise<Detector<WorkerRunRow>> {
  try {
    const result = await pool.query(`
      SELECT worker_name, last_run_started_at, last_duration_ms,
             observed_interval_ms, configured_interval_ms, total_runs, last_error
      FROM worker_runs
      ORDER BY worker_name ASC
    `);
    const rows: WorkerRunRow[] = result.rows.map((r) => {
      const observed = r.observed_interval_ms != null ? Number(r.observed_interval_ms) : null;
      const configured = r.configured_interval_ms != null ? Number(r.configured_interval_ms) : null;
      const effective = observed ?? configured;
      return {
        workerName: r.worker_name,
        lastRunAt: r.last_run_started_at ? new Date(r.last_run_started_at).toISOString() : null,
        lastDurationMs: r.last_duration_ms != null ? Number(r.last_duration_ms) : null,
        observedIntervalMs: observed,
        configuredIntervalMs: configured,
        totalRuns: Number(r.total_runs) || 0,
        lastError: r.last_error ?? null,
        keepsComputeAwake: effective != null && effective < AUTOSUSPEND_MS,
      };
    });
    return { available: true, rows };
  } catch (err: any) {
    if (isMissingSchema(err)) {
      notes.push('workers: worker_runs table not present (deploy the LeadPrime heartbeat migration)');
      return { available: false, rows: [] };
    }
    throw err;
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────────────

function round(n: number, dp: number): number {
  const f = Math.pow(10, dp);
  return Math.round(n * f) / f;
}
function sum(arr: number[]): number {
  return arr.reduce((s, n) => s + n, 0);
}
/** Collapse whitespace and truncate long SQL for safe display. */
function normalizeQuery(q: string): string {
  const flat = String(q).replace(/\s+/g, ' ').trim();
  return flat.length > 200 ? flat.slice(0, 200) + '…' : flat;
}

// ── Entry point ─────────────────────────────────────────────────────────────────

export async function getInfraHealth(): Promise<InfraHealth> {
  const pool = getLeadPrimePool();
  const notes: string[] = [];

  // Neon first (cost-per-user needs its compute hours).
  const neon = await getNeonConsumption(notes);

  const [costPerUser, hotQueries, liveActivity, workers] = await Promise.all([
    getCostPerUser(pool, neon, notes),
    getHotQueries(pool, notes),
    getLiveActivity(pool, notes),
    getWorkerHeartbeats(pool, notes),
  ]);

  return {
    generatedAt: new Date().toISOString(),
    autosuspendMinutes: AUTOSUSPEND_MS / 60000,
    neon,
    costPerUser,
    hotQueries,
    liveActivity,
    workers,
    notes,
  };
}
