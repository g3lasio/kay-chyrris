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

// ─── USERS INTELLIGENCE ───────────────────────────────────────────────────────

export interface EnrichedUser {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  createdAt: Date;
  balanceCents: number;
  balanceDollars: string;
  totalSpentCents: number;
  totalSpentDollars: string;
  lastActivityAt: Date | null;
  subscriptionStatus: string | null;
  subscriptionPlanId: string | null;
  trialEnd: Date | null;
  businessName: string | null;
  businessType: string | null;
  city: string | null;
  state: string | null;
  hasLicense: boolean;
  licenseNumber: string | null;
  website: string | null;
  industry: string | null;
  tradeType: string | null;
  teamMemberCount: number;
  daysSinceSignup: number;
  isActive: boolean;
}

export interface UserIntelligenceStats {
  totalUsers: number;
  activeUsers: number;
  totalBalanceCents: number;
  totalSpentCents: number;
  byIndustry: Array<{ industry: string; count: number }>;
  bySubscription: Array<{ status: string; count: number }>;
  withLicense: number;
  withoutLicense: number;
  avgTeamSize: number;
}

export async function getEnrichedUsers(options: {
  search?: string;
  industry?: string;
  subscriptionStatus?: string;
  minBalance?: number;
  maxBalance?: number;
  hasLicense?: boolean;
  isActive?: boolean;
  limit?: number;
  offset?: number;
  sortBy?: 'created_at' | 'balance' | 'last_activity' | 'total_spent' | 'team_size';
  sortDir?: 'asc' | 'desc';
} = {}): Promise<{ users: EnrichedUser[]; total: number }> {
  const pool = getLeadPrimePool();
  const {
    search, industry, subscriptionStatus, minBalance, maxBalance,
    hasLicense, isActive, limit = 50, offset = 0,
    sortBy = 'created_at', sortDir = 'desc',
  } = options;

  const conditions: string[] = [];
  const params: any[] = [];
  let pi = 1;

  if (search) {
    params.push(`%${search.toLowerCase()}%`);
    conditions.push(`(LOWER(c.name) LIKE $${pi} OR LOWER(c.email) LIKE $${pi} OR COALESCE(c.phone,'') LIKE $${pi} OR LOWER(COALESCE(cp.business_name,'')) LIKE $${pi})`);
    pi++;
  }
  if (industry) { params.push(industry); conditions.push(`c.industry = $${pi++}`); }
  if (subscriptionStatus && subscriptionStatus !== 'all') {
    if (subscriptionStatus === 'none') { conditions.push(`s.status IS NULL`); }
    else { params.push(subscriptionStatus); conditions.push(`s.status = $${pi++}`); }
  }
  if (minBalance !== undefined) { params.push(minBalance * 100); conditions.push(`COALESCE(w.balance_cents,0) >= $${pi++}`); }
  if (maxBalance !== undefined) { params.push(maxBalance * 100); conditions.push(`COALESCE(w.balance_cents,0) <= $${pi++}`); }
  if (hasLicense !== undefined) { params.push(hasLicense); conditions.push(`COALESCE(cp.has_license,false) = $${pi++}`); }
  if (isActive === true) { conditions.push(`last_tx.last_activity > NOW() - INTERVAL '30 days'`); }
  if (isActive === false) { conditions.push(`(last_tx.last_activity IS NULL OR last_tx.last_activity <= NOW() - INTERVAL '30 days')`); }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const sortMap: Record<string, string> = {
    created_at: 'c.created_at', balance: 'COALESCE(w.balance_cents,0)',
    last_activity: 'last_tx.last_activity', total_spent: 'COALESCE(spent.total_spent_cents,0)',
    team_size: 'COALESCE(tm.team_count,0)',
  };
  const orderBy = `${sortMap[sortBy] ?? 'c.created_at'} ${sortDir === 'asc' ? 'ASC' : 'DESC'} NULLS LAST`;

  const baseQuery = `
    FROM contractors c
    LEFT JOIN wallets w ON w.contractor_id = c.id
    LEFT JOIN subscriptions s ON s.contractor_id = c.id
    LEFT JOIN company_profiles cp ON cp.contractor_id = c.id
    LEFT JOIN (SELECT contractor_id, MAX(created_at) AS last_activity FROM wallet_transactions GROUP BY contractor_id) last_tx ON last_tx.contractor_id = c.id
    LEFT JOIN (SELECT contractor_id, ABS(SUM(amount_cents)) AS total_spent_cents FROM wallet_transactions WHERE amount_cents < 0 GROUP BY contractor_id) spent ON spent.contractor_id = c.id
    LEFT JOIN (SELECT contractor_id, COUNT(*) AS team_count FROM team_members GROUP BY contractor_id) tm ON tm.contractor_id = c.id
    ${whereClause}
  `;

  const countResult = await pool.query(`SELECT COUNT(*) ${baseQuery}`, params);
  const total = parseInt(countResult.rows[0].count, 10);

  const dataParams = [...params, limit, offset];
  const result = await pool.query(
    `SELECT c.id, c.name, c.email, c.phone, c.created_at, c.industry, c.trade_type,
       COALESCE(w.balance_cents,0) AS balance_cents,
       s.status AS subscription_status, s.plan_id AS subscription_plan_id, s.trial_end,
       cp.business_name, cp.business_type, cp.city, cp.state,
       COALESCE(cp.has_license,false) AS has_license, cp.license_number, cp.website,
       last_tx.last_activity,
       COALESCE(spent.total_spent_cents,0) AS total_spent_cents,
       COALESCE(tm.team_count,0) AS team_count
     ${baseQuery}
     ORDER BY ${orderBy}
     LIMIT $${pi} OFFSET $${pi + 1}`,
    dataParams
  );

  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  const users: EnrichedUser[] = result.rows.map(row => {
    const createdAt = new Date(row.created_at);
    const lastActivityAt = row.last_activity ? new Date(row.last_activity) : null;
    return {
      id: row.id, name: row.name || '(no name)', email: row.email, phone: row.phone, createdAt,
      balanceCents: parseFloat(row.balance_cents) || 0,
      balanceDollars: ((parseFloat(row.balance_cents) || 0) / 100).toFixed(2),
      totalSpentCents: parseFloat(row.total_spent_cents) || 0,
      totalSpentDollars: ((parseFloat(row.total_spent_cents) || 0) / 100).toFixed(2),
      lastActivityAt,
      subscriptionStatus: row.subscription_status, subscriptionPlanId: row.subscription_plan_id,
      trialEnd: row.trial_end ? new Date(row.trial_end) : null,
      businessName: row.business_name, businessType: row.business_type,
      city: row.city, state: row.state,
      hasLicense: row.has_license, licenseNumber: row.license_number, website: row.website,
      industry: row.industry, tradeType: row.trade_type,
      teamMemberCount: parseInt(row.team_count) || 0,
      daysSinceSignup: Math.floor((now.getTime() - createdAt.getTime()) / (1000 * 60 * 60 * 24)),
      isActive: lastActivityAt ? lastActivityAt > thirtyDaysAgo : false,
    };
  });

  return { users, total };
}

export async function getUserIntelligenceStats(): Promise<UserIntelligenceStats> {
  const pool = getLeadPrimePool();
  const [totals, industryDist, subDist, licenseDist, teamAvg] = await Promise.all([
    pool.query(`
      SELECT COUNT(DISTINCT c.id)::int AS total_users,
        COUNT(DISTINCT CASE WHEN last_tx.last_activity > NOW() - INTERVAL '30 days' THEN c.id END)::int AS active_users,
        COALESCE(SUM(w.balance_cents),0) AS total_balance_cents,
        COALESCE(SUM(ABS(spent.total_spent_cents)),0) AS total_spent_cents
      FROM contractors c
      LEFT JOIN wallets w ON w.contractor_id = c.id
      LEFT JOIN (SELECT contractor_id, MAX(created_at) AS last_activity FROM wallet_transactions GROUP BY contractor_id) last_tx ON last_tx.contractor_id = c.id
      LEFT JOIN (SELECT contractor_id, SUM(amount_cents) AS total_spent_cents FROM wallet_transactions WHERE amount_cents < 0 GROUP BY contractor_id) spent ON spent.contractor_id = c.id
    `),
    pool.query(`SELECT COALESCE(industry,'unknown') AS industry, COUNT(*)::int AS count FROM contractors GROUP BY industry ORDER BY count DESC LIMIT 15`),
    pool.query(`SELECT COALESCE(s.status,'none') AS status, COUNT(*)::int AS count FROM contractors c LEFT JOIN subscriptions s ON s.contractor_id = c.id GROUP BY s.status ORDER BY count DESC`),
    pool.query(`SELECT COUNT(CASE WHEN COALESCE(has_license,false)=true THEN 1 END)::int AS with_license, COUNT(CASE WHEN COALESCE(has_license,false)=false THEN 1 END)::int AS without_license FROM company_profiles`),
    pool.query(`SELECT COALESCE(AVG(team_count),0) AS avg_team_size FROM (SELECT contractor_id, COUNT(*) AS team_count FROM team_members GROUP BY contractor_id) t`),
  ]);
  const t = totals.rows[0];
  const l = licenseDist.rows[0] || { with_license: 0, without_license: 0 };
  return {
    totalUsers: t.total_users, activeUsers: t.active_users,
    totalBalanceCents: parseFloat(t.total_balance_cents) || 0,
    totalSpentCents: parseFloat(t.total_spent_cents) || 0,
    byIndustry: industryDist.rows.map((r: any) => ({ industry: r.industry, count: r.count })),
    bySubscription: subDist.rows.map((r: any) => ({ status: r.status, count: r.count })),
    withLicense: l.with_license, withoutLicense: l.without_license,
    avgTeamSize: parseFloat(teamAvg.rows[0]?.avg_team_size) || 0,
  };
}

export async function updateLeadPrimeUserContact(
  contractorId: string,
  updates: { email?: string; phone?: string; name?: string }
): Promise<{ success: boolean; message: string }> {
  const pool = getLeadPrimePool();
  const fields: string[] = [];
  const values: any[] = [];
  let pi = 1;
  if (updates.email) { fields.push(`email = $${pi++}`); values.push(updates.email); }
  if (updates.phone) { fields.push(`phone = $${pi++}`); values.push(updates.phone); }
  if (updates.name) { fields.push(`name = $${pi++}`); values.push(updates.name); }
  if (fields.length === 0) return { success: false, message: 'No fields to update' };
  values.push(contractorId);
  await pool.query(`UPDATE contractors SET ${fields.join(', ')}, updated_at = NOW() WHERE id = $${pi}`, values);
  return { success: true, message: 'User updated successfully' };
}

export async function deleteLeadPrimeUser(
  contractorId: string
): Promise<{ success: boolean; message: string }> {
  const pool = getLeadPrimePool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const tables = [
      'wallet_transactions','admin_credit_grants','wallets','subscriptions',
      'team_members','company_profiles','contractor_settings','agent_memory','ai_assistant_settings',
    ];
    for (const table of tables) {
      try { await client.query(`DELETE FROM ${table} WHERE contractor_id = $1`, [contractorId]); } catch {}
    }
    await client.query(`DELETE FROM contractors WHERE id = $1`, [contractorId]);
    await client.query('COMMIT');
    return { success: true, message: 'User deleted successfully' };
  } catch (err: any) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
