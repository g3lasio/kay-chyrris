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

// ─── Types for enriched user intelligence ────────────────────────────────────

export interface EnrichedUser {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  industry: string | null;
  tradeType: string | null;
  companyName: string | null;
  phoneVerified: boolean;
  onboardingCompleted: boolean;
  twilioPhoneNumber: string | null;
  createdAt: Date;
  // wallet
  balanceCents: number;
  balanceDollars: string;
  // subscription
  subscriptionStatus: string | null;
  // activity
  leadCount: number;
  messageCount: number;
  campaignCount: number;
  lastActivityAt: Date | null;
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
 * Get enriched user list with activity metrics
 */
export async function getEnrichedLeadPrimeUsers(options: {
  search?: string;
  limit?: number;
  offset?: number;
  sortBy?: string;
  sortDir?: 'asc' | 'desc';
} = {}): Promise<{ users: EnrichedUser[]; total: number }> {
  const pool = getLeadPrimePool();
  const { search, limit = 50, offset = 0 } = options;

  let whereClause = '';
  const params: any[] = [];

  if (search) {
    params.push(`%${search.toLowerCase()}%`);
    whereClause = `WHERE LOWER(c.name) LIKE $1 OR LOWER(c.email) LIKE $1 OR c.phone LIKE $1 OR LOWER(c.company_name) LIKE $1`;
  }

  const countResult = await pool.query(
    `SELECT COUNT(*) FROM contractors c ${whereClause}`,
    params
  );
  const total = parseInt(countResult.rows[0].count, 10);

  const dataParams = [...params, limit, offset];
  const result = await pool.query(
    `SELECT
       c.id, c.name, c.email, c.phone, c.industry, c.trade_type,
       c.company_name, c.phone_verified, c.onboarding_completed,
       c.twilio_phone_number, c.created_at,
       COALESCE(w.balance_cents, 0) AS balance_cents,
       s.status AS subscription_status,
       COALESCE(lc.lead_count, 0) AS lead_count,
       COALESCE(mc.message_count, 0) AS message_count,
       COALESCE(cc.campaign_count, 0) AS campaign_count,
       GREATEST(lc.last_lead_at, mc.last_message_at, cc.last_campaign_at) AS last_activity_at
     FROM contractors c
     LEFT JOIN wallets w ON w.contractor_id = c.id
     LEFT JOIN subscriptions s ON s.contractor_id = c.id
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
     ${whereClause}
     ORDER BY c.created_at DESC
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    dataParams
  );

  const users: EnrichedUser[] = result.rows.map(row => ({
    id: row.id,
    name: row.name || '(no name)',
    email: row.email,
    phone: row.phone,
    industry: row.industry,
    tradeType: row.trade_type,
    companyName: row.company_name,
    phoneVerified: row.phone_verified || false,
    onboardingCompleted: row.onboarding_completed || false,
    twilioPhoneNumber: row.twilio_phone_number,
    createdAt: row.created_at,
    balanceCents: parseFloat(row.balance_cents) || 0,
    balanceDollars: ((parseFloat(row.balance_cents) || 0) / 100).toFixed(2),
    subscriptionStatus: row.subscription_status,
    leadCount: parseInt(row.lead_count) || 0,
    messageCount: parseInt(row.message_count) || 0,
    campaignCount: parseInt(row.campaign_count) || 0,
    lastActivityAt: row.last_activity_at,
  }));

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
  updates: { name?: string; email?: string; phone?: string }
): Promise<{ success: boolean }> {
  const pool = getLeadPrimePool();
  const setClauses: string[] = [];
  const params: any[] = [];

  if (updates.name !== undefined) {
    params.push(updates.name);
    setClauses.push(`name = $${params.length}`);
  }
  if (updates.email !== undefined) {
    params.push(updates.email);
    setClauses.push(`email = $${params.length}`);
  }
  if (updates.phone !== undefined) {
    params.push(updates.phone);
    setClauses.push(`phone = $${params.length}`);
  }

  if (setClauses.length === 0) return { success: true };

  params.push(contractorId);
  await pool.query(
    `UPDATE contractors SET ${setClauses.join(', ')}, updated_at = NOW() WHERE id = $${params.length}`,
    params
  );

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
