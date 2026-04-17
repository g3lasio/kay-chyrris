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
  createdAt: string;
  balanceCents: number;
  balanceDollars: string;
  welcomeCreditGranted: boolean;
  welcomeCreditExpiresAt: string | null;
  subscriptionStatus: string | null;
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
       NULL::timestamp AS trial_end
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
      (SELECT COUNT(*) FROM contractors WHERE created_at >= NOW() - INTERVAL '30 days') AS new_users_last_30_days
  `);

  const row = result.rows[0];
  return {
    totalUsers: parseInt(row.total_users) || 0,
    verifiedUsers: parseInt(row.verified_users) || 0,
    onboardedUsers: parseInt(row.onboarded_users) || 0,
    activeSubscriptions: parseInt(row.active_subscriptions) || 0,
    totalLeads: parseInt(row.total_leads) || 0,
    totalMessages: parseInt(row.total_messages) || 0,
    totalCampaigns: parseInt(row.total_campaigns) || 0,
    newUsersLast30Days: parseInt(row.new_users_last_30_days) || 0,
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
