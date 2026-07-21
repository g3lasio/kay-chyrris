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
 *   contractor_id, status ('active'|'trialing'|'canceled'|...), plan, trial_end
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
  businessName: string | null;
  createdAt: string;
  balanceCents: number;
  balanceDollars: string;
  welcomeCreditGranted: boolean;
  welcomeCreditExpiresAt: string | null;
  subscriptionStatus: string | null;
  subscriptionPlan: string | null;
  trialEnd: string | null;
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
  createdAt: string;
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
  appliedAt: string | null;
  createdAt: string;
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
    whereClause = `WHERE LOWER(c.name) LIKE $1 OR LOWER(c.email) LIKE $1 OR c.phone LIKE $1
      OR LOWER(COALESCE(c.company_name, '')) LIKE $1 OR LOWER(COALESCE(cp.business_name, '')) LIKE $1`;
  }

  const countResult = await pool.query(
    `SELECT COUNT(*)
     FROM contractors c
     LEFT JOIN company_profiles cp ON cp.contractor_id = c.id
     ${whereClause}`,
    params
  );
  const total = parseInt(countResult.rows[0].count, 10);

  // Subscriptions are joined via LATERAL so a contractor with multiple
  // subscription rows yields exactly one user row (active > trialing > rest).
  const dataParams = [...params, limit, offset];
  const result = await pool.query(
    `SELECT
       c.id,
       c.name,
       c.email,
       c.phone,
       c.created_at,
       COALESCE(NULLIF(TRIM(cp.business_name), ''), NULLIF(TRIM(c.company_name), '')) AS business_name,
       COALESCE(w.balance_cents, 0) AS balance_cents,
       COALESCE(w.welcome_credit_granted, false) AS welcome_credit_granted,
       w.welcome_credit_expires_at,
       s.status AS subscription_status,
       s.plan AS subscription_plan,
       NULL::timestamp AS trial_end
     FROM contractors c
     LEFT JOIN company_profiles cp ON cp.contractor_id = c.id
     LEFT JOIN wallets w ON w.contractor_id = c.id
     LEFT JOIN LATERAL (
       SELECT status, plan
       FROM subscriptions
       WHERE contractor_id = c.id
       ORDER BY CASE status
         WHEN 'active' THEN 0
         WHEN 'trialing' THEN 1
         WHEN 'past_due' THEN 2
         ELSE 3
       END
       LIMIT 1
     ) s ON true
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
    businessName: row.business_name ?? null,
    createdAt: row.created_at,
    balanceCents: parseFloat(row.balance_cents) || 0,
    balanceDollars: ((parseFloat(row.balance_cents) || 0) / 100).toFixed(2),
    welcomeCreditGranted: row.welcome_credit_granted,
    welcomeCreditExpiresAt: row.welcome_credit_expires_at,
    subscriptionStatus: row.subscription_status,
    subscriptionPlan: row.subscription_plan ?? null,
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

/// ─── Types for enriched user intelligence ────────────────────────────────────
export interface EnrichedUser {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  // identity
  networkHandle: string | null;       // @handle — unique LeadPrime Network username
  industry: string | null;
  tradeType: string | null;
  companyName: string | null;
  // profile (company_profiles)
  businessName: string | null;
  businessType: string | null;
  city: string | null;
  state: string | null;
  website: string | null;
  // compliance (network_profiles)
  hasLicense: boolean;
  licenseNumber: string | null;
  // status
  phoneVerified: boolean;
  onboardingCompleted: boolean;
  twilioPhoneNumber: string | null;
  isActive: boolean;                  // had activity in last 30 days
  daysSinceSignup: number;
  createdAt: string;
  // wallet
  balanceCents: number;
  balanceDollars: string;
  totalSpentCents: number;
  totalSpentDollars: string;
  // subscription
  subscriptionStatus: string | null;
  subscriptionPlanId: string | null;
  // activity
  leadCount: number;
  messageCount: number;
  campaignCount: number;
  teamMemberCount: number;
  lastActivityAt: string | null;
}

export interface UserIntelligenceStats {
  totalUsers: number;
  verifiedUsers: number;
  onboardedUsers: number;
  activeSubscriptions: number;
  totalLeads: number;
  totalMessages: number;
  totalCampaigns: number;
  newUsersLast30Days: number;
  activeUsers: number;
  totalBalanceCents: number;
  totalSpentCents: number;
  withLicense: number;
  withoutLicense: number;
  byIndustry: { industry: string; count: number }[];
}

/**
 * Get enriched user list with full profile data.
 * Includes: network_handle (@handle), company profile (city/state/website/businessName/businessType),
 * license info (from network_profiles), total spent, team size, isActive, daysSinceSignup.
 */
export async function getEnrichedLeadPrimeUsers(options: {
  search?: string;
  industry?: string;
  subscriptionStatus?: string;
  hasLicense?: boolean;
  isActive?: boolean;
  limit?: number;
  offset?: number;
  sortBy?: string;
  sortDir?: 'asc' | 'desc';
} = {}): Promise<{ users: EnrichedUser[]; total: number }> {
  const pool = getLeadPrimePool();
  const { search, industry, subscriptionStatus, hasLicense, isActive, limit = 50, offset = 0, sortBy, sortDir = 'desc' } = options;

  const conditions: string[] = [];
  const params: any[] = [];

  if (search) {
    params.push(`%${search.toLowerCase()}%`);
    conditions.push(`(LOWER(c.name) LIKE $${params.length} OR LOWER(c.email) LIKE $${params.length} OR c.phone LIKE $${params.length} OR LOWER(COALESCE(c.company_name,'')) LIKE $${params.length} OR LOWER(COALESCE(c.network_handle,'')) LIKE $${params.length})`);
  }
  if (industry) {
    params.push(industry);
    conditions.push(`c.industry = $${params.length}`);
  }
  if (subscriptionStatus) {
    params.push(subscriptionStatus);
    conditions.push(`s.status = $${params.length}`);
  }
  if (hasLicense === true) {
    conditions.push(`np.license_number IS NOT NULL`);
  } else if (hasLicense === false) {
    conditions.push(`np.license_number IS NULL`);
  }
  if (isActive === true) {
    conditions.push(`GREATEST(lc.last_lead_at, mc.last_message_at, cc.last_campaign_at) >= NOW() - INTERVAL '30 days'`);
  } else if (isActive === false) {
    conditions.push(`(GREATEST(lc.last_lead_at, mc.last_message_at, cc.last_campaign_at) IS NULL OR GREATEST(lc.last_lead_at, mc.last_message_at, cc.last_campaign_at) < NOW() - INTERVAL '30 days')`);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  // Allowed sort columns
  const sortColMap: Record<string, string> = {
    created_at: 'c.created_at',
    balance: 'COALESCE(w.balance_cents, 0)',
    last_activity: 'GREATEST(lc.last_lead_at, mc.last_message_at, cc.last_campaign_at)',
    total_spent: 'COALESCE(spent.total_spent_cents, 0)',
    team_size: 'COALESCE(tm.team_count, 0)',
  };
  const orderCol = sortColMap[sortBy ?? ''] ?? 'c.created_at';
  const orderDir = sortDir === 'asc' ? 'ASC' : 'DESC';

  const countResult = await pool.query(
    `SELECT COUNT(*)
     FROM contractors c
     LEFT JOIN subscriptions s ON s.contractor_id = c.id
     LEFT JOIN network_profiles np ON np.contractor_id = c.id
     LEFT JOIN (
       SELECT contractor_id, MAX(created_at) AS last_lead_at FROM leads GROUP BY contractor_id
     ) lc ON lc.contractor_id = c.id
     LEFT JOIN (
       SELECT contractor_id, MAX(created_at) AS last_message_at FROM messages GROUP BY contractor_id
     ) mc ON mc.contractor_id = c.id
     LEFT JOIN (
       SELECT contractor_id, MAX(created_at) AS last_campaign_at FROM campaigns GROUP BY contractor_id
     ) cc ON cc.contractor_id = c.id
     ${whereClause}`,
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
       c.network_handle,
       c.industry,
       c.trade_type,
       c.company_name,
       c.phone_verified,
       c.onboarding_completed,
       c.twilio_phone_number,
       c.created_at,
       -- company_profiles
       cp.business_name,
       cp.business_type,
       cp.city,
       cp.state,
       cp.website,
       -- network_profiles (license/compliance)
       np.license_number,
       np.license_verified,
       -- wallet
       COALESCE(w.balance_cents, 0) AS balance_cents,
       COALESCE(spent.total_spent_cents, 0) AS total_spent_cents,
       -- subscription
       s.status AS subscription_status,
       s.plan AS subscription_plan_id,
       -- activity counts
       COALESCE(lc.lead_count, 0) AS lead_count,
       COALESCE(mc.message_count, 0) AS message_count,
       COALESCE(cc.campaign_count, 0) AS campaign_count,
       COALESCE(tm.team_count, 0) AS team_count,
       GREATEST(lc.last_lead_at, mc.last_message_at, cc.last_campaign_at) AS last_activity_at
     FROM contractors c
     LEFT JOIN company_profiles cp ON cp.contractor_id = c.id
     LEFT JOIN network_profiles np ON np.contractor_id = c.id
     LEFT JOIN wallets w ON w.contractor_id = c.id
     LEFT JOIN subscriptions s ON s.contractor_id = c.id
     LEFT JOIN (
       SELECT contractor_id, SUM(ABS(amount_cents)) AS total_spent_cents
       FROM wallet_transactions WHERE amount_cents < 0
       GROUP BY contractor_id
     ) spent ON spent.contractor_id = c.id
     LEFT JOIN (
       SELECT contractor_id, COUNT(*) AS lead_count, MAX(created_at) AS last_lead_at
       FROM leads GROUP BY contractor_id
     ) lc ON lc.contractor_id = c.id
     LEFT JOIN (
       SELECT contractor_id, COUNT(*) AS message_count, MAX(created_at) AS last_message_at
       FROM messages GROUP BY contractor_id
     ) mc ON mc.contractor_id = c.id
     LEFT JOIN (
       SELECT contractor_id, COUNT(*) AS campaign_count, MAX(created_at) AS last_campaign_at
       FROM campaigns GROUP BY contractor_id
     ) cc ON cc.contractor_id = c.id
     LEFT JOIN (
       SELECT contractor_id, COUNT(*) AS team_count
       FROM team_members WHERE status = 'active'
       GROUP BY contractor_id
     ) tm ON tm.contractor_id = c.id
     ${whereClause}
     ORDER BY ${orderCol} ${orderDir} NULLS LAST
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    dataParams
  );

  const now = Date.now();
  const users: EnrichedUser[] = result.rows.map(row => {
    const balanceCents = parseFloat(row.balance_cents) || 0;
    const totalSpentCents = parseFloat(row.total_spent_cents) || 0;
    const createdAt = row.created_at instanceof Date ? row.created_at : new Date(row.created_at);
    const daysSinceSignup = Math.floor((now - createdAt.getTime()) / (1000 * 60 * 60 * 24));
    const lastActivity = row.last_activity_at ? new Date(row.last_activity_at) : null;
    const isActiveUser = lastActivity ? (now - lastActivity.getTime()) < 30 * 24 * 60 * 60 * 1000 : false;
    return {
      id: row.id,
      name: row.name || '(no name)',
      email: row.email,
      phone: row.phone ?? null,
      networkHandle: row.network_handle ?? null,
      industry: row.industry ?? null,
      tradeType: row.trade_type ?? null,
      companyName: row.company_name ?? null,
      businessName: row.business_name ?? null,
      businessType: row.business_type ?? null,
      city: row.city ?? null,
      state: row.state ?? null,
      website: row.website ?? null,
      hasLicense: !!(row.license_number),
      licenseNumber: row.license_number ?? null,
      phoneVerified: row.phone_verified || false,
      onboardingCompleted: row.onboarding_completed || false,
      twilioPhoneNumber: row.twilio_phone_number ?? null,
      isActive: isActiveUser,
      daysSinceSignup,
      createdAt: createdAt.toISOString(),
      balanceCents,
      balanceDollars: (balanceCents / 100).toFixed(2),
      totalSpentCents,
      totalSpentDollars: (totalSpentCents / 100).toFixed(2),
      subscriptionStatus: row.subscription_status ?? null,
      subscriptionPlanId: row.subscription_plan_id ?? null,
      leadCount: parseInt(row.lead_count) || 0,
      messageCount: parseInt(row.message_count) || 0,
      campaignCount: parseInt(row.campaign_count) || 0,
      teamMemberCount: parseInt(row.team_count) || 0,
      lastActivityAt: row.last_activity_at ? new Date(row.last_activity_at).toISOString() : null,
    };
  });
  return { users, total };
}

/**
 * Get aggregate stats for user intelligence dashboard
 */
export async function getLeadPrimeUserIntelligenceStats(): Promise<UserIntelligenceStats> {
  const pool = getLeadPrimePool();
  const result = await pool.query(`
    SELECT
      (SELECT COUNT(*) FROM contractors) AS total_users,
      (SELECT COUNT(*) FROM contractors WHERE phone_verified = true) AS verified_users,
      (SELECT COUNT(*) FROM contractors WHERE onboarding_completed = true) AS onboarded_users,
      (SELECT COUNT(*) FROM subscriptions WHERE status IN ('active', 'trialing')) AS active_subscriptions,
      (SELECT COUNT(*) FROM leads) AS total_leads,
      (SELECT COUNT(*) FROM messages) AS total_messages,
      (SELECT COUNT(*) FROM campaigns) AS total_campaigns,
      (SELECT COUNT(*) FROM contractors WHERE created_at >= NOW() - INTERVAL '30 days') AS new_users_last_30_days,
      (SELECT COUNT(*) FROM contractors WHERE updated_at >= NOW() - INTERVAL '30 days') AS active_users_30d,
      (SELECT COALESCE(SUM(balance_cents), 0) FROM contractor_wallets) AS total_balance_cents,
      (SELECT COALESCE(SUM(ABS(amount_cents)), 0) FROM wallet_transactions WHERE amount_cents < 0) AS total_spent_cents,
      (SELECT COUNT(*) FROM contractors c2 JOIN network_profiles np ON np.contractor_id = c2.id WHERE np.license_number IS NOT NULL AND np.license_number != \'\') AS with_license
  `);
  const row = result.rows[0];
  const totalUsers = parseInt(row.total_users) || 0;
  const withLicense = parseInt(row.with_license) || 0;
  // Industry breakdown
  const industryResult = await pool.query(`
    SELECT COALESCE(industry, 'unknown') AS industry, COUNT(*) AS count
    FROM contractors
    GROUP BY industry
    ORDER BY count DESC
    LIMIT 10
  `);
  const byIndustry = industryResult.rows.map((r: any) => ({
    industry: r.industry,
    count: parseInt(r.count) || 0,
  }));
  return {
    totalUsers,
    verifiedUsers: parseInt(row.verified_users) || 0,
    onboardedUsers: parseInt(row.onboarded_users) || 0,
    activeSubscriptions: parseInt(row.active_subscriptions) || 0,
    totalLeads: parseInt(row.total_leads) || 0,
    totalMessages: parseInt(row.total_messages) || 0,
    totalCampaigns: parseInt(row.total_campaigns) || 0,
    newUsersLast30Days: parseInt(row.new_users_last_30_days) || 0,
    activeUsers: parseInt(row.active_users_30d) || 0,
    totalBalanceCents: parseInt(row.total_balance_cents) || 0,
    totalSpentCents: parseInt(row.total_spent_cents) || 0,
    withLicense,
    withoutLicense: Math.max(0, totalUsers - withLicense),
    byIndustry,
  };
}


/**
 * Update contact info for a LeadPrime user
 */
export async function updateLeadPrimeUserContact(
  contractorId: string,
  updates: {
    name?: string;
    email?: string;
    phone?: string;
    industry?: string;
    companyName?: string;
    // company_profiles fields
    businessName?: string;
    businessType?: string;
    city?: string;
    state?: string;
    website?: string;
  }
): Promise<{ success: boolean }> {
  const pool = getLeadPrimePool();

  // ── Update contractors table ──────────────────────────────────────────────
  const contractorCols: string[] = [];
  const contractorParams: any[] = [];
  const contractorFields: Record<string, any> = {
    name: updates.name,
    email: updates.email,
    phone: updates.phone,
    industry: updates.industry,
    company_name: updates.companyName,
  };
  for (const [col, val] of Object.entries(contractorFields)) {
    if (val !== undefined) {
      contractorParams.push(val);
      contractorCols.push(`${col} = $${contractorParams.length}`);
    }
  }
  if (contractorCols.length > 0) {
    contractorParams.push(contractorId);
    await pool.query(
      `UPDATE contractors SET ${contractorCols.join(', ')}, updated_at = NOW() WHERE id = $${contractorParams.length}`,
      contractorParams
    );
  }

  // ── Update company_profiles table ────────────────────────────────────────
  const profileFields: Record<string, any> = {
    business_name: updates.businessName,
    business_type: updates.businessType,
    city: updates.city,
    state: updates.state,
    website: updates.website,
  };
  const profileCols: string[] = [];
  const profileParams: any[] = [];
  for (const [col, val] of Object.entries(profileFields)) {
    if (val !== undefined) {
      profileParams.push(val);
      profileCols.push(`${col} = $${profileParams.length}`);
    }
  }
  if (profileCols.length > 0) {
    profileParams.push(contractorId);
    // Upsert: insert row if not exists, then update
    await pool.query(
      `INSERT INTO company_profiles (id, contractor_id, updated_at)
       VALUES (gen_random_uuid()::VARCHAR(50), $${profileParams.length}, NOW())
       ON CONFLICT (contractor_id) DO NOTHING`,
      [contractorId]
    );
    await pool.query(
      `UPDATE company_profiles SET ${profileCols.join(', ')}, updated_at = NOW() WHERE contractor_id = $${profileParams.length}`,
      profileParams
    );
  }

  return { success: true };
}

/**
 * Delete a single LeadPrime user and all their data.
 *
 * FIX (2026-04-16): The DB has a trigger `prevent_last_owner_deletion_trigger`
 * on team_members that blocks deleting the last owner row of a contractor.
 * When an admin deletes a contractor account entirely, we WANT to remove all
 * team_members rows (including the last owner). We temporarily disable the
 * trigger for this session, perform the deletion, then re-enable it.
 *
 * Most child tables have ON DELETE CASCADE FK to contractors, so deleting the
 * contractor row is sufficient for those. We explicitly delete the tables that
 * do NOT have a CASCADE FK (or that need to be deleted before the contractor row).
 */
export async function deleteLeadPrimeUser(
  contractorId: string
): Promise<{ success: boolean; message: string }> {
  const pool = getLeadPrimePool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Temporarily disable the last-owner guard trigger so admin can delete
    // the contractor's own team_members row (which is always the last owner).
    await client.query(
      `ALTER TABLE team_members DISABLE TRIGGER prevent_last_owner_deletion_trigger`
    );

    // Tables that need explicit DELETE (not covered by CASCADE FK from contractors)
    const tables = [
      // Billing / wallet (no CASCADE)
      'wallet_transactions', 'admin_credit_grants', 'wallets',
      'subscriptions', 'subscription_items',
      // Team (trigger was blocking this)
      'team_members', 'team_audit_logs', 'team_billing_logs',
      // Profile / settings
      'company_profiles', 'contractor_settings', 'contractor_billing_settings',
      // AI
      'agent_memory', 'ai_assistant_settings',
      // CRM
      'leads', 'conversations', 'messages',
      'appointments', 'invoices', 'projects',
      // Campaigns (non-cascade tables)
      'campaign_ai_generations', 'campaign_csv_imports', 'campaign_contact_history',
      // Email
      'email_daily_limits', 'email_unsubscribe_list',
      // LeadHunter
      'leadhunter_purchases', 'leadhunter_results', 'leadhunter_searches',
      // Misc
      'web_search_usage', 'system_issues',
      'automation_logs', 'automation_queue',
      'pipeline_move_log',
      // PM (usually empty but safe to include)
      'pm_vendors', 'pm_vendor_assignments', 'pm_owners',
      'pm_expenses', 'pm_inspections', 'pm_late_fees', 'pm_late_fee_config',
      'pm_lease_renewals', 'pm_monthly_variable_charges', 'pm_reminder_config',
    ];

    for (const table of tables) {
      // Use SAVEPOINT so a missing table / column error doesn't abort the whole transaction
      const sp = `sp_${table}`;
      await client.query(`SAVEPOINT ${sp}`);
      try {
        await client.query(`DELETE FROM ${table} WHERE contractor_id = $1`, [contractorId]);
        await client.query(`RELEASE SAVEPOINT ${sp}`);
      } catch {
        // Table may not exist or column may differ — roll back only this step
        await client.query(`ROLLBACK TO SAVEPOINT ${sp}`);
        await client.query(`RELEASE SAVEPOINT ${sp}`);
      }
    }

    // Delete the contractor itself — CASCADE FK will clean up remaining children
    await client.query(`DELETE FROM contractors WHERE id = $1`, [contractorId]);

    // Re-enable the trigger
    await client.query(
      `ALTER TABLE team_members ENABLE TRIGGER prevent_last_owner_deletion_trigger`
    );

    await client.query('COMMIT');
    return { success: true, message: 'User deleted successfully' };
  } catch (err: any) {
    // Always re-enable the trigger even on error to avoid leaving it disabled
    await client.query(
      `ALTER TABLE team_members ENABLE TRIGGER prevent_last_owner_deletion_trigger`
    ).catch(() => {});
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export async function deleteLeadPrimeUsers(
  contractorIds: string[]
): Promise<{ success: boolean; deleted: number; failed: string[]; message: string }> {
  if (!contractorIds.length) return { success: true, deleted: 0, failed: [], message: 'No users to delete' };
  const results = await Promise.allSettled(
    contractorIds.map(id => deleteLeadPrimeUser(id))
  );
  const failed: string[] = [];
  let deleted = 0;
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') deleted++;
    else failed.push(contractorIds[i]);
  });
  return {
    success: failed.length === 0,
    deleted,
    failed,
    message: failed.length === 0
      ? `${deleted} user(s) deleted successfully`
      : `${deleted} deleted, ${failed.length} failed`,
  };
}

// ─── ALIAS EXPORTS FOR ROUTER COMPATIBILITY ───────────────────────────────────
// The router imports these names; the actual implementations use longer names.
export const getEnrichedUsers = getEnrichedLeadPrimeUsers;
export const getUserIntelligenceStats = getLeadPrimeUserIntelligenceStats;

// ─── WALLET STATS ─────────────────────────────────────────────────────────────
export interface LeadPrimeWalletStats {
  totalUsers: number;
  usersWithWallet: number;
  totalBalanceCents: number;
  totalGrantedThisMonth: number;
  activeSubscribers: number;
  trialUsers: number;
}

export async function getLeadPrimeWalletStats(): Promise<LeadPrimeWalletStats> {
  const pool = getLeadPrimePool();
  const result = await pool.query(`
    SELECT
      (SELECT COUNT(*) FROM contractors) AS total_users,
      (SELECT COUNT(*) FROM wallets WHERE balance_cents > 0) AS users_with_wallet,
      (SELECT COALESCE(SUM(balance_cents), 0) FROM wallets) AS total_balance_cents,
      (
        SELECT COALESCE(SUM(amount_cents), 0)
        FROM admin_credit_grants
        WHERE created_at >= date_trunc('month', NOW())
      ) AS total_granted_this_month,
      (
        SELECT COUNT(*)
        FROM subscriptions
        WHERE status = 'active'
      ) AS active_subscribers,
      (
        SELECT COUNT(*)
        FROM subscriptions
        WHERE status = 'trialing'
      ) AS trial_users
  `);
  const row = result.rows[0];
  return {
    totalUsers: parseInt(row.total_users) || 0,
    usersWithWallet: parseInt(row.users_with_wallet) || 0,
    totalBalanceCents: parseFloat(row.total_balance_cents) || 0,
    totalGrantedThisMonth: parseFloat(row.total_granted_this_month) || 0,
    activeSubscribers: parseInt(row.active_subscribers) || 0,
    trialUsers: parseInt(row.trial_users) || 0,
  };
}

// ─── SYSTEM ISSUES ────────────────────────────────────────────────────────────
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
  createdAt: string;
  updatedAt: string;
}

export interface SystemIssueStats {
  total: number;
  byStatus: { new: number; reviewing: number; resolved: number };
  byType: { bug: number; feature_request: number; config_error: number };
  topIssues: Array<{ id: string; title: string; occurrences: number; status: string; issueType: string }>;
}

/**
 * Get system issues list with optional filters.
 * Handles missing table gracefully — returns empty results instead of crashing.
 */
export async function getSystemIssues(options: {
  status?: string;
  issue_type?: string;
  limit?: number;
  offset?: number;
} = {}): Promise<{ issues: SystemIssue[]; total: number }> {
  const pool = getLeadPrimePool();
  const { status = 'all', issue_type = 'all', limit = 50, offset = 0 } = options;

  try {
    const conditions: string[] = [];
    const params: any[] = [];

    if (status && status !== 'all') {
      params.push(status);
      conditions.push(`status = $${params.length}`);
    }
    if (issue_type && issue_type !== 'all') {
      params.push(issue_type);
      conditions.push(`issue_type = $${params.length}`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const countResult = await pool.query(
      `SELECT COUNT(*) AS total FROM system_issues ${whereClause}`,
      params
    );
    const total = parseInt(countResult.rows[0]?.total) || 0;

    const dataParams = [...params, limit, offset];
    const dataResult = await pool.query(
      `SELECT
         id, contractor_id, tool_name, issue_type, title, description,
         error_message, status, occurrences,
         COALESCE(affected_contractors, '{}') AS affected_contractors,
         created_at, updated_at
       FROM system_issues
       ${whereClause}
       ORDER BY
         CASE status WHEN 'new' THEN 0 WHEN 'reviewing' THEN 1 ELSE 2 END,
         occurrences DESC,
         created_at DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      dataParams
    );

    const issues: SystemIssue[] = dataResult.rows.map(row => ({
      id: row.id,
      contractorId: row.contractor_id,
      toolName: row.tool_name,
      issueType: row.issue_type,
      title: row.title,
      description: row.description,
      errorMessage: row.error_message,
      status: row.status,
      occurrences: parseInt(row.occurrences) || 1,
      affectedContractors: Array.isArray(row.affected_contractors)
        ? row.affected_contractors
        : [],
      createdAt: row.created_at instanceof Date
        ? row.created_at.toISOString()
        : row.created_at,
      updatedAt: row.updated_at instanceof Date
        ? row.updated_at.toISOString()
        : row.updated_at,
    }));

    return { issues, total };
  } catch (err: any) {
    if (err.code === '42P01') {
      console.warn('[LeadPrime DB] system_issues table does not exist yet — returning empty');
      return { issues: [], total: 0 };
    }
    throw err;
  }
}

/**
 * Get aggregate stats for system issues dashboard.
 * Handles missing table gracefully.
 */
export async function getSystemIssueStats(): Promise<SystemIssueStats> {
  const pool = getLeadPrimePool();
  try {
    const result = await pool.query(`
      SELECT
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE status = 'new') AS new_count,
        COUNT(*) FILTER (WHERE status = 'reviewing') AS reviewing_count,
        COUNT(*) FILTER (WHERE status = 'resolved') AS resolved_count,
        COUNT(*) FILTER (WHERE issue_type = 'bug') AS bug_count,
        COUNT(*) FILTER (WHERE issue_type = 'feature_request') AS feature_count,
        COUNT(*) FILTER (WHERE issue_type = 'config_error') AS config_count
      FROM system_issues
    `);
    const row = result.rows[0];

    const topResult = await pool.query(`
      SELECT id, title, occurrences, status, issue_type
      FROM system_issues
      WHERE status != 'resolved'
      ORDER BY occurrences DESC
      LIMIT 5
    `);
    return {
      total: parseInt(row.total) || 0,
      byStatus: {
        new: parseInt(row.new_count) || 0,
        reviewing: parseInt(row.reviewing_count) || 0,
        resolved: parseInt(row.resolved_count) || 0,
      },
      byType: {
        bug: parseInt(row.bug_count) || 0,
        feature_request: parseInt(row.feature_count) || 0,
        config_error: parseInt(row.config_count) || 0,
      },
      topIssues: topResult.rows.map(r => ({
        id: r.id,
        title: r.title,
        occurrences: parseInt(r.occurrences) || 1,
        status: r.status,
        issueType: r.issue_type,
      })),
    };
  } catch (err: any) {
    if (err.code === '42P01') {
      console.warn('[LeadPrime DB] system_issues table does not exist yet — returning empty stats');
      return {
        total: 0,
        byStatus: { new: 0, reviewing: 0, resolved: 0 },
        byType: { bug: 0, feature_request: 0, config_error: 0 },
        topIssues: [],
      };
    }
    throw err;
  }
}

/**
 * Update the status of a system issue.
 * Returns the updated issue or null if not found.
 */
export async function updateSystemIssueStatus(
  issueId: string,
  status: string
): Promise<SystemIssue | null> {
  const pool = getLeadPrimePool();
  try {
    const result = await pool.query(
      `UPDATE system_issues
       SET status = $1, updated_at = NOW()
       WHERE id = $2
       RETURNING
         id, contractor_id, tool_name, issue_type, title, description,
         error_message, status, occurrences,
         COALESCE(affected_contractors, '{}') AS affected_contractors,
         created_at, updated_at`,
      [status, issueId]
    );
    if (!result.rows.length) return null;
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
      occurrences: parseInt(row.occurrences) || 1,
      affectedContractors: Array.isArray(row.affected_contractors)
        ? row.affected_contractors
        : [],
      createdAt: row.created_at instanceof Date
        ? row.created_at.toISOString()
        : row.created_at,
      updatedAt: row.updated_at instanceof Date
        ? row.updated_at.toISOString()
        : row.updated_at,
    };
  } catch (err: any) {
    if (err.code === '42P01') {
      throw new Error('system_issues table does not exist');
    }
    throw err;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Managed website hosting (Chyrris-built sites) — per-contractor monthly fee.
//
// Config lives in the `contractor_hosting` table on the SAME LeadPrime Neon DB
// (migration 231 in g3lasio/leadprime). The admin toggles it on/off and sets the
// monthly price here; LeadPrime's own daily cron (hostingBillingService) performs
// the actual wallet deduction (type 'managed_hosting'). We only read/write config
// and read the charge history — we never move money from the admin.
// ─────────────────────────────────────────────────────────────────────────────

export interface HostingConfig {
  contractorId: string;
  enabled: boolean;
  monthlyCents: number;
  status: string;            // active | suspended | inactive
  nextChargeAt: string | null;
  lastChargedAt: string | null;
  updatedBy: string | null;
  totalChargedCents: number; // lifetime sum of managed_hosting charges
}

/** Read a contractor's managed-hosting config + lifetime amount charged. */
export async function getHostingConfig(contractorId: string): Promise<HostingConfig> {
  const pool = getLeadPrimePool();

  const cfg = await pool.query(
    `SELECT enabled, monthly_cents, status, next_charge_at, last_charged_at, updated_by
     FROM contractor_hosting WHERE contractor_id = $1`,
    [contractorId]
  );

  // Lifetime charged = sum of the (negative) managed_hosting debits, as a positive.
  const charged = await pool.query(
    `SELECT COALESCE(SUM(ABS(amount_cents)), 0) AS total
     FROM wallet_transactions
     WHERE contractor_id = $1 AND type = 'managed_hosting'`,
    [contractorId]
  );
  const totalChargedCents = parseInt(charged.rows[0]?.total, 10) || 0;

  const row = cfg.rows[0];
  if (!row) {
    return {
      contractorId, enabled: false, monthlyCents: 0, status: 'inactive',
      nextChargeAt: null, lastChargedAt: null, updatedBy: null, totalChargedCents,
    };
  }
  return {
    contractorId,
    enabled: row.enabled === true,
    monthlyCents: parseInt(row.monthly_cents, 10) || 0,
    status: row.status || 'inactive',
    nextChargeAt: row.next_charge_at instanceof Date ? row.next_charge_at.toISOString() : row.next_charge_at,
    lastChargedAt: row.last_charged_at instanceof Date ? row.last_charged_at.toISOString() : row.last_charged_at,
    updatedBy: row.updated_by || null,
    totalChargedCents,
  };
}

/**
 * Enable/disable hosting and set the monthly price for a contractor.
 * - Enabling (with amount > 0): schedules the first charge for the next daily
 *   sweep only if it wasn't already enabled (re-saving an active config keeps its
 *   existing next_charge_at, so the billing date never silently resets).
 * - Disabling: status → 'inactive', next_charge_at → NULL (the sweep skips it),
 *   but monthly_cents is preserved so re-enabling remembers the price.
 * Money is never moved here — LeadPrime's cron does the actual deduction.
 */
export async function setHostingConfig(
  contractorId: string,
  enabled: boolean,
  monthlyCents: number,
  updatedBy: string
): Promise<HostingConfig> {
  const pool = getLeadPrimePool();

  const existing = await pool.query(
    `SELECT enabled, next_charge_at FROM contractor_hosting WHERE contractor_id = $1`,
    [contractorId]
  );
  const wasEnabled = existing.rows[0]?.enabled === true;
  const existingNext = existing.rows[0]?.next_charge_at ?? null;

  const shouldBill = enabled && monthlyCents > 0;

  if (shouldBill) {
    // Keep the existing schedule if already enabled; otherwise start billing now
    // (next daily sweep picks it up). NOW() is resolved in SQL below.
    const keepSchedule = wasEnabled && existingNext != null;
    await pool.query(
      `INSERT INTO contractor_hosting
         (contractor_id, enabled, monthly_cents, status, next_charge_at, updated_by, updated_at)
       VALUES ($1, true, $2, 'active', NOW(), $3, NOW())
       ON CONFLICT (contractor_id) DO UPDATE SET
         enabled        = true,
         monthly_cents  = EXCLUDED.monthly_cents,
         status         = CASE WHEN contractor_hosting.status = 'suspended' THEN 'suspended' ELSE 'active' END,
         next_charge_at = ${keepSchedule ? 'contractor_hosting.next_charge_at' : 'NOW()'},
         updated_by     = EXCLUDED.updated_by,
         updated_at     = NOW()`,
      [contractorId, Math.round(monthlyCents), updatedBy]
    );
  } else {
    await pool.query(
      `INSERT INTO contractor_hosting
         (contractor_id, enabled, monthly_cents, status, next_charge_at, updated_by, updated_at)
       VALUES ($1, false, $2, 'inactive', NULL, $3, NOW())
       ON CONFLICT (contractor_id) DO UPDATE SET
         enabled        = false,
         monthly_cents  = EXCLUDED.monthly_cents,
         status         = 'inactive',
         next_charge_at = NULL,
         updated_by     = EXCLUDED.updated_by,
         updated_at     = NOW()`,
      [contractorId, Math.round(monthlyCents), updatedBy]
    );
  }

  return getHostingConfig(contractorId);
}

// ─── SUBSCRIPTION CONFIG (Fases 3-4 — Kai→config→worker pattern) ─────────────
//
// Kai NEVER moves money or tier directly. It writes an INTENT to
// contractor_subscription_config (migration 251 in g3lasio/leadprime). The
// LeadPrime worker (subscriptionConfigWorker, every 5 min) executes via the
// single applyTierChange gate.
//
// Fields Kai writes: target_tier, billing_mode, monthly_credits_cents,
//   enable_legacy_projects, contract_end_at, on_contract_end, status='pending',
//   enabled=true, updated_by, updated_at.
// Fields Kai NEVER writes: status='applied', applied_at, checkout_url,
//   contract_end_processed_at (all owned by the worker).
// ─────────────────────────────────────────────────────────────────────────────

export interface SubscriptionConfig {
  contractorId: string;
  // From subscriptions table
  planName: string | null;
  subStatus: string | null;
  serviceLevel: string | null;
  // From contractor_feature_flags
  legacyRealEstate: boolean;
  // From contractor_subscription_config
  targetTier: string | null;
  billingMode: string | null;
  monthlyCreditsCents: number | null;
  enableLegacyProjects: boolean;
  contractEndAt: string | null;
  onContractEnd: string;
  contractEndProcessedAt: string | null;
  status: string | null;
  enabled: boolean;
  checkoutUrl: string | null;
  checkoutCreatedAt: string | null;
  lastError: string | null;
  updatedBy: string | null;
  appliedAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  // Billing history
  invoices: Array<{
    stripeInvoiceId: string | null;
    amountDue: number;
    amountPaid: number;
    status: string;
    paidAt: string | null;
    createdAt: string;
  }>;
  achHolds: Array<{
    stripeInvoiceId: string | null;
    tier: string | null;
    amountCents: number;
    status: string;
    retryCount: number;
    holdExpiresAt: string | null;
  }>;
}

/** Read a contractor's subscription config, subscription status, feature flags,
 *  and billing history (invoices + ACH holds). */
export async function getSubscriptionConfig(contractorId: string): Promise<SubscriptionConfig> {
  const pool = getLeadPrimePool();

  // Main query: subscriptions + config + feature flags
  const mainRes = await pool.query(
    `SELECT
       csc.target_tier,
       csc.billing_mode,
       csc.monthly_credits_cents,
       csc.enable_legacy_projects,
       csc.contract_end_at,
       csc.on_contract_end,
       csc.contract_end_processed_at,
       csc.status,
       csc.enabled,
       csc.checkout_url,
       csc.checkout_created_at,
       csc.last_error,
       csc.updated_by,
       csc.applied_at,
       csc.created_at,
       csc.updated_at,
       s.plan_name,
       s.status AS sub_status,
       s.service_level,
       COALESCE(f.legacy_real_estate, false) AS legacy_real_estate
     FROM subscriptions s
     LEFT JOIN contractor_subscription_config csc USING (contractor_id)
     LEFT JOIN contractor_feature_flags f USING (contractor_id)
     WHERE s.contractor_id = $1`,
    [contractorId]
  );

  const row = mainRes.rows[0];

  // Billing history: invoices
  const invoicesRes = await pool.query(
    `SELECT stripe_invoice_id, amount_due, amount_paid, status, paid_at, created_at
     FROM invoices
     WHERE contractor_id = $1
     ORDER BY created_at DESC LIMIT 24`,
    [contractorId]
  );

  // Billing history: ACH holds
  const holdsRes = await pool.query(
    `SELECT stripe_invoice_id, tier, amount_cents, status, retry_count, hold_expires_at
     FROM ach_payment_holds
     WHERE contractor_id = $1
     ORDER BY created_at DESC LIMIT 24`,
    [contractorId]
  );

  const toIso = (v: any) => (v instanceof Date ? v.toISOString() : v ?? null);

  return {
    contractorId,
    planName: row?.plan_name ?? null,
    subStatus: row?.sub_status ?? null,
    serviceLevel: row?.service_level ?? null,
    legacyRealEstate: row?.legacy_real_estate === true,
    targetTier: row?.target_tier ?? null,
    billingMode: row?.billing_mode ?? null,
    monthlyCreditsCents: row?.monthly_credits_cents != null ? parseInt(row.monthly_credits_cents, 10) : null,
    enableLegacyProjects: row?.enable_legacy_projects === true,
    contractEndAt: toIso(row?.contract_end_at),
    onContractEnd: row?.on_contract_end ?? 'downgrade_to_elite',
    contractEndProcessedAt: toIso(row?.contract_end_processed_at),
    status: row?.status ?? null,
    enabled: row?.enabled === true,
    checkoutUrl: row?.checkout_url ?? null,
    checkoutCreatedAt: toIso(row?.checkout_created_at),
    lastError: row?.last_error ?? null,
    updatedBy: row?.updated_by ?? null,
    appliedAt: toIso(row?.applied_at),
    createdAt: toIso(row?.created_at),
    updatedAt: toIso(row?.updated_at),
    invoices: invoicesRes.rows.map(r => ({
      stripeInvoiceId: r.stripe_invoice_id ?? null,
      amountDue: parseInt(r.amount_due, 10) || 0,
      amountPaid: parseInt(r.amount_paid, 10) || 0,
      status: r.status,
      paidAt: toIso(r.paid_at),
      createdAt: toIso(r.created_at) ?? '',
    })),
    achHolds: holdsRes.rows.map(r => ({
      stripeInvoiceId: r.stripe_invoice_id ?? null,
      tier: r.tier ?? null,
      amountCents: parseInt(r.amount_cents, 10) || 0,
      status: r.status,
      retryCount: parseInt(r.retry_count, 10) || 0,
      holdExpiresAt: toIso(r.hold_expires_at),
    })),
  };
}

export interface SetSubscriptionConfigInput {
  contractorId: string;
  targetTier: 'network_elite' | 'chyrris_growth' | 'chyrris_legacy';
  billingMode: 'stripe_ach' | 'comp_no_charge';
  monthlyCreditsCents: number | null;  // null = use catalog default; max 120000
  enableLegacyProjects: boolean;
  contractEndAt: string | null;        // ISO string or null
  onContractEnd: 'downgrade_to_elite' | 'cancel';
  updatedBy: string;
}

/** Write subscription intent to contractor_subscription_config.
 *  UPSERT with status='pending', enabled=true. NEVER writes status='applied',
 *  applied_at, checkout_url, or contract_end_processed_at (worker-owned). */
export async function setSubscriptionConfig(input: SetSubscriptionConfigInput): Promise<SubscriptionConfig> {
  const pool = getLeadPrimePool();

  const creditsCap = 120000; // $1,200 — Decisión #5
  const credits = input.monthlyCreditsCents != null
    ? Math.min(Math.max(0, Math.round(input.monthlyCreditsCents)), creditsCap)
    : null;

  await pool.query(
    `INSERT INTO contractor_subscription_config
       (contractor_id, target_tier, billing_mode, monthly_credits_cents,
        enable_legacy_projects, contract_end_at, on_contract_end,
        status, enabled, updated_by, updated_at, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending', true, $8, NOW(), NOW())
     ON CONFLICT (contractor_id) DO UPDATE SET
       target_tier            = EXCLUDED.target_tier,
       billing_mode           = EXCLUDED.billing_mode,
       monthly_credits_cents  = EXCLUDED.monthly_credits_cents,
       enable_legacy_projects = EXCLUDED.enable_legacy_projects,
       contract_end_at        = EXCLUDED.contract_end_at,
       on_contract_end        = EXCLUDED.on_contract_end,
       status                 = 'pending',
       enabled                = true,
       updated_by             = EXCLUDED.updated_by,
       updated_at             = NOW()`,
    [
      input.contractorId,
      input.targetTier,
      input.billingMode,
      credits,
      input.enableLegacyProjects,
      input.contractEndAt ? new Date(input.contractEndAt) : null,
      input.onContractEnd,
      input.updatedBy,
    ]
  );

  return getSubscriptionConfig(input.contractorId);
}

export interface TierChangeLogEntry {
  id: number;
  contractorId: string;
  fromTier: string | null;
  toTier: string;
  fromStatus: string | null;
  toStatus: string | null;
  source: string | null;
  actor: string | null;
  billing: string | null;
  creditsGrantedCents: number;
  reason: string | null;
  metadata: Record<string, any> | null;
  createdAt: string;
}

/** Read the last 50 tier change log entries for a contractor (audit trail). */
export async function getTierChangeLog(contractorId: string): Promise<TierChangeLogEntry[]> {
  const pool = getLeadPrimePool();
  const res = await pool.query(
    `SELECT id, contractor_id, from_tier, to_tier, from_status, to_status,
            source, actor, billing, COALESCE(credits_granted_cents, 0) AS credits_granted_cents,
            reason, metadata, created_at
     FROM tier_change_log
     WHERE contractor_id = $1
     ORDER BY id DESC LIMIT 50`,
    [contractorId]
  );
  return res.rows.map(r => ({
    id: r.id,
    contractorId: r.contractor_id,
    fromTier: r.from_tier ?? null,
    toTier: r.to_tier,
    fromStatus: r.from_status ?? null,
    toStatus: r.to_status ?? null,
    source: r.source ?? null,
    actor: r.actor ?? null,
    billing: r.billing ?? null,
    creditsGrantedCents: parseInt(r.credits_granted_cents, 10) || 0,
    reason: r.reason ?? null,
    metadata: r.metadata ?? null,
    createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at,
  }));
}

// ─── PENDING SUBSCRIPTIONS (portales /join) ────────────────────────────────

export interface PendingSubscription {
  id: number;
  tier: string;
  businessName: string | null;
  contactName: string | null;
  email: string;
  phone: string | null;
  stripeCustomerId: string;
  stripeSubscriptionId: string;
  stripeInvoiceId: string | null;
  amountPaidCents: number;
  status: 'paid' | 'linked' | 'failed';
  goodFaithConfirmed: boolean;
  paidAt: string | null;
  linkedContractorId: string | null;
  createdAt: string;
  updatedAt: string;
}

/** List pending subscriptions from /join portals (paid but not yet linked to an account). */
export async function getPendingSubscriptions(options: {
  status?: string;
  limit?: number;
  offset?: number;
} = {}): Promise<{ rows: PendingSubscription[]; total: number }> {
  const pool = getLeadPrimePool();
  const { status, limit = 100, offset = 0 } = options;
  const params: any[] = [];
  let where = '';
  if (status) {
    params.push(status);
    where = `WHERE status = $${params.length}`;
  }
  const countRes = await pool.query(
    `SELECT COUNT(*) FROM pending_subscriptions ${where}`,
    params
  );
  const total = parseInt(countRes.rows[0].count, 10);
  params.push(limit, offset);
  const res = await pool.query(
    `SELECT id, tier, business_name, contact_name, email, phone,
            stripe_customer_id, stripe_subscription_id, stripe_invoice_id,
            amount_paid_cents, status, good_faith_confirmed, paid_at,
            linked_contractor_id, created_at, updated_at
     FROM pending_subscriptions
     ${where}
     ORDER BY created_at DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  const rows: PendingSubscription[] = res.rows.map(r => ({
    id: r.id,
    tier: r.tier,
    businessName: r.business_name ?? null,
    contactName: r.contact_name ?? null,
    email: r.email,
    phone: r.phone ?? null,
    stripeCustomerId: r.stripe_customer_id,
    stripeSubscriptionId: r.stripe_subscription_id,
    stripeInvoiceId: r.stripe_invoice_id ?? null,
    amountPaidCents: r.amount_paid_cents ?? 0,
    status: r.status,
    goodFaithConfirmed: r.good_faith_confirmed,
    paidAt: r.paid_at ? (r.paid_at instanceof Date ? r.paid_at.toISOString() : r.paid_at) : null,
    linkedContractorId: r.linked_contractor_id ?? null,
    createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at,
    updatedAt: r.updated_at instanceof Date ? r.updated_at.toISOString() : r.updated_at,
  }));
  return { rows, total };
}

export interface LinkPendingResult {
  linked: boolean;
  alreadyLinked?: boolean;
  tier: string;
  creditsGrantedCents: number;
  staffAdded: boolean;
  error?: string;
}

/**
 * Server-to-server call to LeadPrime's internal Kai API
 * (backend/src/routes/internalKai.ts in g3lasio/leadprime). Authenticated by
 * the shared secret LEADPRIME_INTERNAL_API_KEY (= KAI_INTERNAL_API_KEY on the
 * LeadPrime side). NOTE: the old /api/join/link endpoint expects a user JWT,
 * NOT this key — calling it from Kai always returned 401.
 */
async function callLeadPrimeInternalApi(path: string, body: Record<string, any>): Promise<any> {
  const baseUrl = process.env.LEADPRIME_API_URL || 'https://leadprime.chyrris.com';
  const apiKey = process.env.LEADPRIME_INTERNAL_API_KEY;
  if (!apiKey) throw new Error('LEADPRIME_INTERNAL_API_KEY no configurado — necesario para operar cuentas de LeadPrime');
  const resp = await fetch(`${baseUrl}/api/internal/kai${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });
  const data: any = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    const err: any = new Error(data?.error || `LeadPrime API error ${resp.status}`);
    err.details = data;
    err.status = resp.status;
    throw err;
  }
  return data;
}

/**
 * Link a paid /join-portal payment to an existing contractor account.
 * Delegates to LeadPrime so the complex applyTierChange logic stays there.
 */
export async function linkPendingSubscriptionViaApi(input: {
  pendingId: number;
  contractorId: string;
  actor: string;
  staff?: { phone: string; email?: string; name?: string } | null;
}): Promise<LinkPendingResult> {
  const data = await callLeadPrimeInternalApi('/link', {
    pendingId: input.pendingId,
    contractorId: input.contractorId,
    actor: input.actor,
    staff: input.staff ?? null,
  });
  return {
    linked: data.linked ?? true,
    alreadyLinked: data.alreadyLinked ?? false,
    tier: data.tier ?? '',
    creditsGrantedCents: data.creditsGrantedCents ?? 0,
    staffAdded: data.staffAdded ?? false,
  };
}

export interface CreateContractorResult {
  contractorId: string;
  handle: string;
  phone: string;
  additionalBusiness: boolean;
  staffAdded: boolean;
}

/**
 * Create a complete, verified LeadPrime account (contractor + business profile
 * + team owner + pay_as_you_go subscription + welcome credit + seeds).
 * The client logs in afterwards via the normal phone-OTP flow.
 */
export async function createContractorViaApi(input: {
  name: string;
  businessName?: string | null;
  email: string;
  phone: string;
  industry?: string | null;
  subCategory?: string | null;
  actor: string;
  staff?: { phone: string; email?: string; name?: string } | null;
  allowAdditionalBusiness?: boolean;
}): Promise<CreateContractorResult> {
  const data = await callLeadPrimeInternalApi('/contractors/create', {
    name: input.name,
    businessName: input.businessName ?? null,
    email: input.email,
    phone: input.phone,
    industry: input.industry ?? null,
    subCategory: input.subCategory ?? null,
    actor: input.actor,
    staff: input.staff ?? null,
    allowAdditionalBusiness: input.allowAdditionalBusiness ?? false,
  });
  return {
    contractorId: data.contractorId,
    handle: data.handle ?? '',
    phone: data.phone ?? input.phone,
    additionalBusiness: data.additionalBusiness ?? false,
    staffAdded: data.staffAdded ?? false,
  };
}

/**
 * Add a Chyrris staff member (is_staff=true — no $10 seat charge, role admin)
 * to an existing contractor account. Part of the managed service included in
 * the Growth/Legacy tiers.
 */
export async function addStaffViaApi(input: {
  contractorId: string;
  staff: { phone: string; email?: string; name?: string };
  actor: string;
}): Promise<{ staffAdded: boolean; staffPhone: string }> {
  const data = await callLeadPrimeInternalApi('/staff/add', {
    contractorId: input.contractorId,
    staff: input.staff,
    actor: input.actor,
  });
  return { staffAdded: data.staffAdded ?? true, staffPhone: data.staffPhone ?? input.staff.phone };
}
