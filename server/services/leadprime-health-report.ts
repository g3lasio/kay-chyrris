/**
 * LeadPrime System Health — Period Report (week / month / quarter) — KAI Admin
 *
 * READ-ONLY. Bundles the live System Health page's detectors into one exportable
 * (HTML/PDF) snapshot the team can review. It reuses the existing services
 * (infra health, service spend, billing health) — no new DB pool, no new API
 * calls beyond what those already do.
 *
 * Period semantics (honest): most health detectors are point-in-time (live
 * activity, hot queries, worker heartbeats, billing leaks) — they describe the
 * system AS OF NOW. The one genuinely time-ranged signal is Neon compute
 * consumption, which we slice to the chosen window (week / month / quarter,
 * capped at the ~30 days Neon retains). The report states this clearly.
 */

import type { ClassifiedNote } from './detector-availability';

export type ReportRange = 'week' | 'month' | 'quarter';

interface Period {
  range: ReportRange;
  label: string;
  startIso: string; // YYYY-MM-DD
  daysTotal: number;
  daysElapsed: number;
}

function periodFor(range: ReportRange): Period {
  const now = new Date();
  let start: Date;
  let daysTotal: number;
  let label: string;
  if (range === 'week') {
    const dow = (now.getUTCDay() + 6) % 7;
    start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - dow));
    daysTotal = 7;
    label = 'This Week';
  } else if (range === 'quarter') {
    const qm = Math.floor(now.getUTCMonth() / 3) * 3;
    start = new Date(Date.UTC(now.getUTCFullYear(), qm, 1));
    const qEnd = new Date(Date.UTC(now.getUTCFullYear(), qm + 3, 1));
    daysTotal = Math.round((qEnd.getTime() - start.getTime()) / 86400000);
    label = `Q${Math.floor(qm / 3) + 1} ${now.getUTCFullYear()}`;
  } else {
    start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    daysTotal = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();
    label = now.toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  }
  const daysElapsed = Math.max(0.5, (now.getTime() - start.getTime()) / 86400000);
  return { range, label, startIso: start.toISOString().slice(0, 10), daysTotal, daysElapsed };
}

const round = (n: number, d = 2) => {
  const f = 10 ** d;
  return Math.round(n * f) / f;
};

export interface HealthReport {
  generatedAt: string;
  range: ReportRange;
  periodLabel: string;
  periodStart: string;
  daysTotal: number;
  daysElapsed: number;

  neon: {
    available: boolean;
    note?: string;
    capped: boolean; // true when the window exceeds Neon's ~30-day retention
    daysCovered: number;
    computeHours: number;
    costUsd: number;
    costPerCuHour: number;
    alwaysOnDays: number;
    monthCostUsd: number; // current month-to-date (from live detector)
    projectedMonthCostUsd: number;
    days: { date: string; activeHours: number; computeHours: number; alwaysOn: boolean }[];
    // When the consumption API is unavailable (plan-gated 403), we can't read $,
    // but worker cadence still tells us whether compute is likely pinned 24/7.
    // Honest verdict only — no fabricated dollar figure.
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

  /** Problemas reales detectados. */
  notes: string[];
  /** Detectores apagados por capacidad ausente — informativo, no un fallo. */
  unavailable: ClassifiedNote[];
}

export async function getHealthReport(rangeInput?: string): Promise<HealthReport> {
  const range: ReportRange =
    rangeInput === 'week' || rangeInput === 'quarter' ? rangeInput : 'month';
  const period = periodFor(range);
  const notes: string[] = [];

  const [infra, spend, billing] = await Promise.all([
    import('./leadprime-infra-health').then((m) => m.getInfraHealth()).catch((e) => {
      notes.push(`infra: ${e.message}`);
      return null;
    }),
    import('./leadprime-service-spend').then((m) => m.getServiceSpend()).catch((e) => {
      notes.push(`serviceSpend: ${e.message}`);
      return null;
    }),
    import('./leadprime-billing-health').then((m) => m.getBillingHealth()).catch((e) => {
      notes.push(`billing: ${e.message}`);
      return null;
    }),
  ]);

  // ── Neon consumption sliced to the period window ──
  const neonOut: HealthReport['neon'] = {
    available: false,
    capped: false,
    daysCovered: 0,
    computeHours: 0,
    costUsd: 0,
    costPerCuHour: 0,
    alwaysOnDays: 0,
    monthCostUsd: 0,
    projectedMonthCostUsd: 0,
    days: [],
  };
  if (infra?.neon) {
    const n = infra.neon;
    neonOut.available = n.available;
    neonOut.note = n.note;
    neonOut.costPerCuHour = n.costPerCuHour;
    neonOut.monthCostUsd = round(n.monthCostUsd);
    neonOut.projectedMonthCostUsd = round(n.projectedMonthCostUsd);
    const windowDays = (n.days || []).filter((d) => d.date >= period.startIso);
    // Neon retains ~30 days; a quarter window is necessarily truncated.
    const earliest = (n.days || [])[0]?.date;
    if (earliest && earliest > period.startIso) neonOut.capped = true;
    let compute = 0;
    let alwaysOn = 0;
    for (const d of windowDays) {
      compute += d.computeHours;
      if (d.alwaysOn) alwaysOn += 1;
    }
    neonOut.daysCovered = windowDays.length;
    neonOut.computeHours = round(compute);
    neonOut.costUsd = round(compute * n.costPerCuHour);
    neonOut.alwaysOnDays = alwaysOn;
    neonOut.days = windowDays.map((d) => ({
      date: d.date,
      activeHours: round(d.activeHours),
      computeHours: round(d.computeHours, 3),
      alwaysOn: d.alwaysOn,
    }));
  }

  const costPerUser: HealthReport['costPerUser'] = infra?.costPerUser
    ? {
        available: infra.costPerUser.available,
        note: infra.costPerUser.note,
        totalUsers: infra.costPerUser.totalUsers,
        activeUsers30d: infra.costPerUser.activeUsers30d,
        cuHoursPerActiveUser: round(infra.costPerUser.cuHoursPerActiveUser, 3),
        severity: infra.costPerUser.severity,
      }
    : { available: false, totalUsers: 0, activeUsers30d: 0, cuHoursPerActiveUser: 0, severity: 'unknown' };

  const pollers: HealthReport['pollers'] = {
    available: !!infra?.workers?.available,
    autosuspendMinutes: infra?.autosuspendMinutes ?? 5,
    keepingComputeAwake: 0,
    workers: [],
  };
  if (infra?.workers?.rows) {
    pollers.workers = infra.workers.rows.map((w) => ({
      workerName: w.workerName,
      observedIntervalMs: w.observedIntervalMs,
      configuredIntervalMs: w.configuredIntervalMs,
      lastRunAt: w.lastRunAt,
      totalRuns: w.totalRuns,
      keepsComputeAwake: w.keepsComputeAwake,
      observedReliable: w.observedReliable,
      lastError: w.lastError,
    }));
    pollers.keepingComputeAwake = pollers.workers.filter((w) => w.keepsComputeAwake).length;
  }

  // When the Neon consumption API is plan-gated, fall back to an honest risk
  // verdict from worker cadence (no fabricated dollar figure).
  if (!neonOut.available) {
    const mins = pollers.autosuspendMinutes;
    if (!pollers.available) {
      neonOut.riskVerdict = {
        level: 'unknown',
        reason: 'Neon consumption API unavailable and no worker heartbeats — compute cost cannot be assessed.',
      };
    } else if (pollers.keepingComputeAwake > 0) {
      neonOut.riskVerdict = {
        level: 'high',
        reason: `${pollers.keepingComputeAwake} worker(s) poll faster than the ${mins}-min auto-suspend window — compute is likely pinned 24/7. Widen those intervals, or enable the Neon Scale consumption API for exact $.`,
      };
    } else {
      neonOut.riskVerdict = {
        level: 'low',
        reason: `No worker polls faster than the ${mins}-min suspend window, so compute should idle-suspend between bursts. Exact $ needs the Neon Scale consumption API.`,
      };
    }
  }

  const liveActivity: HealthReport['liveActivity'] = infra?.liveActivity
    ? {
        available: infra.liveActivity.available,
        note: infra.liveActivity.note,
        totalConnections: infra.liveActivity.totalConnections,
        activeConnections: infra.liveActivity.activeConnections,
        idleInTransaction: infra.liveActivity.idleInTransaction,
        longestActiveSeconds: infra.liveActivity.longestActiveSeconds,
      }
    : { available: false, totalConnections: 0, activeConnections: 0, idleInTransaction: 0, longestActiveSeconds: null };

  const hotQueries: HealthReport['hotQueries'] = {
    available: !!infra?.hotQueries?.available,
    statsResetAt: infra?.hotQueries?.statsResetAt ?? null,
    rows: (infra?.hotQueries?.rows || []).slice(0, 10).map((q) => ({
      query: q.query.length > 160 ? q.query.slice(0, 160) + '…' : q.query,
      calls: q.calls,
      meanExecMs: round(q.meanExecMs, 2),
      callsPerMin: q.callsPerMin,
    })),
  };

  const serviceSpend: HealthReport['serviceSpend'] = spend
    ? {
        available: true,
        monthSpendUsd: round(spend.totals.monthSpendUsd),
        billedToUsersUsd: round(spend.totals.billedToUsersUsd),
        marginUsd: round(spend.totals.marginUsd),
        marginPct: spend.totals.marginPct != null ? round(spend.totals.marginPct * 100, 1) : null,
        providers: spend.providers.map((p) => ({
          provider: p.provider,
          label: p.label,
          available: p.available,
          monthSpendUsd: p.monthSpendUsd != null ? round(p.monthSpendUsd) : null,
          billedToUsersUsd: round(p.billedToUsersUsd),
          marginUsd: p.marginUsd != null ? round(p.marginUsd) : null,
          severity: p.severity,
          paymentIssue: p.paymentIssue,
          keyIssue: p.keyIssue,
          note: p.note,
        })),
      }
    : { available: false, monthSpendUsd: 0, billedToUsersUsd: 0, marginUsd: 0, marginPct: null, providers: [] };

  const billingOut: HealthReport['billing'] = billing
    ? {
        available: true,
        negativeBalances: billing.negativeBalances.count,
        unchargedUsage24h: billing.unchargedUsage24h.count,
        unchargedUsdApprox: round(billing.unchargedUsage24h.totalCostCents / 100),
        reconcileFailures: billing.reconcileFailures.count,
        retryQueueBacklog: billing.retryQueueBacklog.count,
        reconciled7dUsd: round(billing.reconciledActivity7d.totalCents / 100),
        leaksDetected:
          billing.negativeBalances.count +
          billing.unchargedUsage24h.count +
          billing.reconcileFailures.count,
      }
    : {
        available: false,
        negativeBalances: 0,
        unchargedUsage24h: 0,
        unchargedUsdApprox: 0,
        reconcileFailures: 0,
        retryQueueBacklog: 0,
        reconciled7dUsd: 0,
        leaksDetected: 0,
      };

  if (infra?.notes) notes.push(...infra.notes);
  if (spend?.notes) notes.push(...spend.notes);
  if (billing?.notes) notes.push(...billing.notes);

  // Capacidades ausentes (extensión no instalada, tabla inexistente, endpoint
  // que pide plan Scale). No son fallos y no deben ensuciar `notes`.
  const unavailable: ClassifiedNote[] = [
    ...(infra?.unavailable ?? []),
    ...(spend?.unavailable ?? []),
    ...(billing?.unavailable ?? []),
  ];

  return {
    generatedAt: new Date().toISOString(),
    range,
    periodLabel: period.label,
    periodStart: period.startIso,
    daysTotal: period.daysTotal,
    daysElapsed: round(period.daysElapsed, 1),
    neon: neonOut,
    costPerUser,
    pollers,
    liveActivity,
    hotQueries,
    serviceSpend,
    billing: billingOut,
    notes: Array.from(new Set(notes)),
    unavailable,
  };
}
