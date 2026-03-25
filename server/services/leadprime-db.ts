/**
 * LeadPrime Database Service — Chyrris KAI Admin Panel
 *
 * Connects directly to the LeadPrime PostgreSQL database (Neon) to:
 * - Read user/contractor list with wallet balances
 * - Execute admin credit grants (addCredits to wallets table)
 * - Read wallet transaction history
 * - Read admin grant history from admin_credit_grants table
 *
 * Architecture: Direct DB connection via LEADPRIME_DATABASE_URL env var
 *
 * SCHEMA REFERENCE (LeadPrime):
 * contractors:
 *   id (VARCHAR), name, email, phone, created_at
 *
 * wallets:
 *   contractor_id (PK), balance_cents, welcome_credit_granted,
 *   welcome_credit_expires_at, last_notification_cents, updated_at
 *
 * wallet_transactions:
 *   id (BIGSERIAL), contractor_id, amount_cents, type, description,
 *   metadata (JSONB), created_at
 *
 * admin_credit_grants:
 *   id (BIGSERIAL), granted_by, contractor_id, batch_id,
 *   amount_cents, description, note, applied, applied_at, created_at
 *
 * subscriptions:
 *   contractor_id, status ('active'|'trialing'|'canceled'|...), trial_end
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
      max: 5,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
    });
    console.log('[LeadPrime DB] Pool initialized');
  }
  return leadprimePool;
}

export interface LeadPrimeUser {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  createdAt: Date;
  balanceCents: number;
  balanceDollars: string;
  welcomeCreditGranted: boolean;
  welcomeCreditExpiresAt: Date | null;
  subscriptionStatus: string | null;
  trialEnd: Date | null;
}

export interface LeadPrimeTransaction {
  id: number;
  contractorId: string;
  contractorName: string | null;
  contractorEmail: string | null;
  amountCents: number;
  type: string;
  description: string;
  metadata: Record<string, any>;
  createdAt: Date;
}

export interface LeadPrimeAdminGrant {
  id: number;
  grantedBy: string;
  contractorId: string;
  contractorName: string | null;
  contractorEmail: string | null;
  batchId: string | null;
  amountCents: number;
  description: string;
  note: string | null;
  applied: boolean;
  appliedAt: Date | null;
  createdAt: Date;
}

export interface GrantResult {
  contractorId: string;
  success: boolean;
  newBalanceCents?: number;
  error?: string;
}

/**
 * Get all LeadPrime users with their wallet balances
 */
export async function getLeadPrimeUsers(options: {
  search?: string;
  limit?: number;
  offset?: number;
} = {}): Promise<{ users: LeadPrimeUser[]; total: number }> {
  const pool = getLeadPrimePool();
  const { search, limit = 100, offset = 0 } = options;

  let whereClause = '';
  const params: any[] = [];

  if (search) {
    params.push(`%${search.toLowerCase()}%`);
    whereClause = `WHERE LOWER(c.name) LIKE $1 OR LOWER(c.email) LIKE $1 OR c.phone LIKE $1`;
  }

  const countResult = await pool.query(
    `SELECT COUNT(*) FROM contractors c ${whereClause}`,
    params
  );
  const total = parseInt(countResult.rows[0].count, 10);

  const dataParams = [...params, limit, offset];
  const result = await pool.query(
    `SELECT
       c.id,
       c.name,
       c.email,
       c.phone,
       c.created_at,
       COALESCE(w.balance_cents, 0) AS balance_cents,
       COALESCE(w.welcome_credit_granted, false) AS welcome_credit_granted,
       w.welcome_credit_expires_at,
       s.status AS subscription_status,
       s.trial_end
     FROM contractors c
     LEFT JOIN wallets w ON w.contractor_id = c.id
     LEFT JOIN subscriptions s ON s.contractor_id = c.id
     ${whereClause}
     ORDER BY c.created_at DESC
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    dataParams
  );

  const users: LeadPrimeUser[] = result.rows.map(row => ({
    id: row.id,
    name: row.name || '(no name)',
    email: row.email,
    phone: row.phone,
    createdAt: row.created_at,
    balanceCents: parseFloat(row.balance_cents) || 0,
    balanceDollars: ((parseFloat(row.balance_cents) || 0) / 100).toFixed(2),
    welcomeCreditGranted: row.welcome_credit_granted,
    welcomeCreditExpiresAt: row.welcome_credit_expires_at,
    subscriptionStatus: row.subscription_status,
    trialEnd: row.trial_end,
  }));

  return { users, total };
}

/**
 * Grant credits to a single LeadPrime user
 */
export async function grantCreditsToLeadPrimeUser(
  contractorId: string,
  amountCents: number,
  description: string,
  grantedBy: string,
  note?: string,
  batchId?: string
): Promise<{ newBalanceCents: number }> {
  const pool = getLeadPrimePool();

  // Ensure wallet exists (upsert)
  await pool.query(
    `INSERT INTO wallets (contractor_id, balance_cents, welcome_credit_granted, welcome_credit_expires_at)
     VALUES ($1, 0, false, NULL)
     ON CONFLICT (contractor_id) DO NOTHING`,
    [contractorId]
  );

  // Add credits
  const result = await pool.query(
    `UPDATE wallets
     SET balance_cents = balance_cents + $1, updated_at = NOW()
     WHERE contractor_id = $2
     RETURNING balance_cents`,
    [amountCents, contractorId]
  );

  const newBalanceCents = parseFloat(result.rows[0]?.balance_cents) || 0;

  // Log to wallet_transactions
  await pool.query(
    `INSERT INTO wallet_transactions (contractor_id, amount_cents, type, description, metadata)
     VALUES ($1, $2, 'admin_grant', $3, $4)`,
    [contractorId, amountCents, description, JSON.stringify({ grantedBy, note, batchId })]
  );

  // Log to admin_credit_grants
  await pool.query(
    `INSERT INTO admin_credit_grants (granted_by, contractor_id, batch_id, amount_cents, description, note, applied, applied_at)
     VALUES ($1, $2, $3, $4, $5, $6, true, NOW())`,
    [grantedBy, contractorId, batchId || null, amountCents, description, note || null]
  );

  return { newBalanceCents };
}

/**
 * Grant credits to multiple LeadPrime users (batch)
 */
export async function grantCreditsToLeadPrimeBatch(
  contractorIds: string[],
  amountCents: number,
  description: string,
  grantedBy: string,
  note?: string
): Promise<{ batchId: string; results: GrantResult[]; successCount: number; failCount: number }> {
  const batchId = `batch_kai_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const results: GrantResult[] = [];
  let successCount = 0;

  for (const contractorId of contractorIds) {
    try {
      const { newBalanceCents } = await grantCreditsToLeadPrimeUser(
        contractorId,
        amountCents,
        description,
        grantedBy,
        note,
        batchId
      );
      results.push({ contractorId, success: true, newBalanceCents });
      successCount++;
    } catch (err: any) {
      results.push({ contractorId, success: false, error: err.message });
    }
  }

  return {
    batchId,
    results,
    successCount,
    failCount: contractorIds.length - successCount,
  };
}

/**
 * Get wallet transaction history for LeadPrime
 */
export async function getLeadPrimeTransactions(options: {
  contractorId?: string;
  type?: string;
  limit?: number;
  offset?: number;
} = {}): Promise<LeadPrimeTransaction[]> {
  const pool = getLeadPrimePool();
  const { contractorId, type, limit = 100, offset = 0 } = options;

  let where = 'WHERE 1=1';
  const params: any[] = [];

  if (contractorId) {
    params.push(contractorId);
    where += ` AND wt.contractor_id = $${params.length}`;
  }
  if (type) {
    params.push(type);
    where += ` AND wt.type = $${params.length}`;
  }

  params.push(limit, offset);

  const result = await pool.query(
    `SELECT
       wt.id,
       wt.contractor_id,
       c.name AS contractor_name,
       c.email AS contractor_email,
       wt.amount_cents,
       wt.type,
       wt.description,
       COALESCE(wt.metadata, '{}') AS metadata,
       wt.created_at
     FROM wallet_transactions wt
     LEFT JOIN contractors c ON c.id = wt.contractor_id
     ${where}
     ORDER BY wt.created_at DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );

  return result.rows.map(row => ({
    id: row.id,
    contractorId: row.contractor_id,
    contractorName: row.contractor_name,
    contractorEmail: row.contractor_email,
    amountCents: parseFloat(row.amount_cents) || 0,
    type: row.type,
    description: row.description,
    metadata: row.metadata || {},
    createdAt: row.created_at,
  }));
}

/**
 * Get admin grant history for LeadPrime
 */
export async function getLeadPrimeAdminGrants(options: {
  limit?: number;
  offset?: number;
} = {}): Promise<LeadPrimeAdminGrant[]> {
  const pool = getLeadPrimePool();
  const { limit = 100, offset = 0 } = options;

  const result = await pool.query(
    `SELECT
       ag.id,
       ag.granted_by,
       ag.contractor_id,
       c.name AS contractor_name,
       c.email AS contractor_email,
       ag.batch_id,
       ag.amount_cents,
       ag.description,
       ag.note,
       ag.applied,
       ag.applied_at,
       ag.created_at
     FROM admin_credit_grants ag
     LEFT JOIN contractors c ON c.id = ag.contractor_id
     ORDER BY ag.created_at DESC
     LIMIT $1 OFFSET $2`,
    [limit, offset]
  );

  return result.rows.map(row => ({
    id: row.id,
    grantedBy: row.granted_by,
    contractorId: row.contractor_id,
    contractorName: row.contractor_name,
    contractorEmail: row.contractor_email,
    batchId: row.batch_id,
    amountCents: parseFloat(row.amount_cents) || 0,
    description: row.description,
    note: row.note,
    applied: row.applied,
    appliedAt: row.applied_at,
    createdAt: row.created_at,
  }));
}

/**
 * Get wallet stats for LeadPrime
 */
export async function getLeadPrimeWalletStats(): Promise<{
  totalUsers: number;
  usersWithWallet: number;
  totalBalanceCents: number;
  totalGrantedThisMonth: number;
  activeSubscribers: number;
  trialUsers: number;
}> {
  const pool = getLeadPrimePool();

  const [statsResult, grantsResult, subsResult] = await Promise.all([
    pool.query(`
      SELECT
        COUNT(DISTINCT c.id) AS total_users,
        COUNT(DISTINCT w.contractor_id) AS users_with_wallet,
        COALESCE(SUM(w.balance_cents), 0) AS total_balance_cents
      FROM contractors c
      LEFT JOIN wallets w ON w.contractor_id = c.id
    `),
    pool.query(`
      SELECT COALESCE(SUM(amount_cents), 0) AS total_granted
      FROM admin_credit_grants
      WHERE applied = true
        AND applied_at >= date_trunc('month', NOW())
    `),
    pool.query(`
      SELECT
        COUNT(CASE WHEN status = 'active' THEN 1 END) AS active_subscribers,
        COUNT(CASE WHEN status = 'trialing' THEN 1 END) AS trial_users
      FROM subscriptions
    `),
  ]);

  return {
    totalUsers: parseInt(statsResult.rows[0].total_users, 10),
    usersWithWallet: parseInt(statsResult.rows[0].users_with_wallet, 10),
    totalBalanceCents: parseFloat(statsResult.rows[0].total_balance_cents) || 0,
    totalGrantedThisMonth: parseFloat(grantsResult.rows[0].total_granted) || 0,
    activeSubscribers: parseInt(subsResult.rows[0].active_subscribers, 10),
    trialUsers: parseInt(subsResult.rows[0].trial_users, 10),
  };
}

// ─── SYSTEM ISSUES TELEMETRY ─────────────────────────────────────────────────

export interface SystemIssue {
  id: string;
  contractorId: string;
  toolName: string | null;
  issueType: 'bug' | 'feature_request' | 'config_error';
  title: string;
  description: string;
  errorMessage: string | null;
  status: 'new' | 'reviewing' | 'resolved';
  occurrences: number;
  affectedContractors: string[];
  createdAt: Date;
  updatedAt: Date;
}

export interface SystemIssueStats {
  total: number;
  byStatus: { new: number; reviewing: number; resolved: number };
  byType: { bug: number; feature_request: number; config_error: number };
  topIssues: Array<{ title: string; occurrences: number; issueType: string }>;
}

export async function getSystemIssues(params: {
  status?: string;
  issue_type?: string;
  limit?: number;
  offset?: number;
}): Promise<{ issues: SystemIssue[]; total: number }> {
  const pool = getLeadPrimePool();
  const { status, issue_type, limit = 50, offset = 0 } = params;

  const conditions: string[] = [];
  const values: any[] = [];
  let idx = 1;

  if (status && status !== 'all') {
    conditions.push(`status = $${idx++}`);
    values.push(status);
  }
  if (issue_type && issue_type !== 'all') {
    conditions.push(`issue_type = $${idx++}`);
    values.push(issue_type);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const [issuesResult, countResult] = await Promise.all([
    pool.query(
      `SELECT id, contractor_id, tool_name, issue_type, title, description,
              error_message, status, occurrences, affected_contractors,
              created_at, updated_at
       FROM system_issues
       ${where}
       ORDER BY
         CASE status WHEN 'new' THEN 0 WHEN 'reviewing' THEN 1 ELSE 2 END,
         occurrences DESC,
         created_at DESC
       LIMIT $${idx} OFFSET $${idx + 1}`,
      [...values, limit, offset]
    ),
    pool.query(`SELECT COUNT(*) as total FROM system_issues ${where}`, values),
  ]);

  const issues: SystemIssue[] = issuesResult.rows.map((row: any) => ({
    id: row.id,
    contractorId: row.contractor_id,
    toolName: row.tool_name,
    issueType: row.issue_type,
    title: row.title,
    description: row.description,
    errorMessage: row.error_message,
    status: row.status,
    occurrences: row.occurrences,
    affectedContractors: Array.isArray(row.affected_contractors)
      ? row.affected_contractors.filter((x: any) => typeof x === 'string')
      : [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));

  return {
    issues,
    total: parseInt(countResult.rows[0].total, 10),
  };
}

export async function updateSystemIssueStatus(
  issueId: string,
  status: 'new' | 'reviewing' | 'resolved'
): Promise<SystemIssue | null> {
  const pool = getLeadPrimePool();

  const result = await pool.query(
    `UPDATE system_issues
     SET status = $1, updated_at = NOW()
     WHERE id = $2
     RETURNING id, contractor_id, tool_name, issue_type, title, description,
               error_message, status, occurrences, affected_contractors,
               created_at, updated_at`,
    [status, issueId]
  );

  if (result.rows.length === 0) return null;

  const row = result.rows[0];
  return {
    id: row.id,
    contractorId: row.contractor_id,
    toolName: row.tool_name,
    issueType: row.issue_type,
    title: row.title,
    description: row.description,
    errorMessage: row.error_message,
    status: row.status,
    occurrences: row.occurrences,
    affectedContractors: Array.isArray(row.affected_contractors)
      ? row.affected_contractors.filter((x: any) => typeof x === 'string')
      : [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function getSystemIssueStats(): Promise<SystemIssueStats> {
  const pool = getLeadPrimePool();

  const [statusResult, typeResult, topResult] = await Promise.all([
    pool.query(`
      SELECT
        COUNT(CASE WHEN status = 'new' THEN 1 END)::int AS new_count,
        COUNT(CASE WHEN status = 'reviewing' THEN 1 END)::int AS reviewing_count,
        COUNT(CASE WHEN status = 'resolved' THEN 1 END)::int AS resolved_count,
        COUNT(*)::int AS total
      FROM system_issues
    `),
    pool.query(`
      SELECT
        COUNT(CASE WHEN issue_type = 'bug' THEN 1 END)::int AS bug_count,
        COUNT(CASE WHEN issue_type = 'feature_request' THEN 1 END)::int AS feature_count,
        COUNT(CASE WHEN issue_type = 'config_error' THEN 1 END)::int AS config_count
      FROM system_issues
    `),
    pool.query(`
      SELECT title, occurrences, issue_type
      FROM system_issues
      WHERE status != 'resolved'
      ORDER BY occurrences DESC
      LIMIT 5
    `),
  ]);

  const s = statusResult.rows[0];
  const t = typeResult.rows[0];

  return {
    total: s.total,
    byStatus: {
      new: s.new_count,
      reviewing: s.reviewing_count,
      resolved: s.resolved_count,
    },
    byType: {
      bug: t.bug_count,
      feature_request: t.feature_count,
      config_error: t.config_count,
    },
    topIssues: topResult.rows.map((row: any) => ({
      title: row.title,
      occurrences: row.occurrences,
      issueType: row.issue_type,
    })),
  };
}
