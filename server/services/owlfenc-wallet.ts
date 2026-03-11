/**
 * OWLFENC WALLET SERVICE — Chyrris KAI Admin Panel
 *
 * Connects directly to the Owl Fenc PostgreSQL database to:
 * - Read wallet balances from wallet_accounts
 * - Read transaction history from wallet_transactions
 * - Execute admin credit grants (addCredits)
 *
 * Architecture: Direct DB connection via OWLFENC_DATABASE_URL
 *
 * SCHEMA REFERENCE (server/migrations/001_wallet_schema.sql):
 * wallet_accounts:
 *   id, user_id, firebase_uid, balance_credits, total_credits_earned,
 *   total_credits_spent, total_top_up_amount_cents, stripe_customer_id,
 *   is_locked, locked_reason, created_at, updated_at
 *
 * wallet_transactions:
 *   id, wallet_id (FK→wallet_accounts.id), user_id, firebase_uid,
 *   type, direction, amount_credits, balance_after, feature_name,
 *   resource_id, subscription_plan_id, stripe_payment_intent_id,
 *   stripe_checkout_session_id, top_up_amount_cents, idempotency_key,
 *   description, metadata, expires_at, created_at
 */

import { getOwlFencDb } from './owlfenc-db';
import { sql } from 'drizzle-orm';

export interface UserWalletBalance {
  userId: number;
  firebaseUid: string;
  email: string;
  displayName: string | null;
  planName: string;
  planId: number;
  creditBalance: number;
  lifetimeCreditsEarned: number;
  lifetimeCreditsSpent: number;
  lastTransactionAt: Date | null;
  walletCreatedAt: Date | null;
}

export interface AdminGrantRecord {
  id: number;
  userId: number;
  firebaseUid: string;
  email: string;
  displayName: string | null;
  amount: number;
  description: string;
  adminNote: string | null;
  expiresAt: Date | null;
  createdAt: Date;
  balanceAfter: number;
}

export interface GrantResult {
  success: boolean;
  usersGranted: number;
  totalCreditsGranted: number;
  errors: Array<{ userId: number; error: string }>;
}

/**
 * Get all users with their wallet balances.
 * Returns real-time data from wallet_accounts joined with users and subscription_plans.
 * Uses correct column names: balance_credits, total_credits_earned, total_credits_spent
 */
export async function getUserWalletBalances(planFilter?: string): Promise<UserWalletBalance[]> {
  const db = getOwlFencDb();
  if (!db) {
    throw new Error('Owl Fenc database not available');
  }

  try {
    const result = await db.execute(sql`
      SELECT
        u.id                                                    AS "userId",
        u.firebase_uid                                          AS "firebaseUid",
        u.email                                                 AS "email",
        COALESCE(u.owner_name, u.username)                       AS "displayName",
        COALESCE(sp.name, 'Free')                               AS "planName",
        COALESCE(us.plan_id, 5)                                 AS "planId",
        COALESCE(wa.balance_credits, 0)                         AS "creditBalance",
        COALESCE(wa.total_credits_earned, 0)                    AS "lifetimeCreditsEarned",
        COALESCE(wa.total_credits_spent, 0)                     AS "lifetimeCreditsSpent",
        wa.updated_at                                           AS "lastTransactionAt",
        wa.created_at                                           AS "walletCreatedAt"
      FROM users u
      LEFT JOIN user_subscriptions us
        ON u.id = us.user_id AND us.status = 'active'
      LEFT JOIN subscription_plans sp
        ON us.plan_id = sp.id
      LEFT JOIN wallet_accounts wa
        ON u.id = wa.user_id
      ${planFilter && planFilter !== 'all'
        ? sql`WHERE LOWER(COALESCE(sp.name, 'Free')) ILIKE ${'%' + planFilter + '%'}`
        : sql``}
      ORDER BY COALESCE(wa.balance_credits, 0) DESC, u.email ASC
    `);

    return result.rows.map((row: any) => ({
      userId: Number(row.userId),
      firebaseUid: row.firebaseUid as string,
      email: row.email as string,
      displayName: row.displayName as string | null,
      planName: row.planName as string,
      planId: Number(row.planId),
      creditBalance: Number(row.creditBalance),
      lifetimeCreditsEarned: Number(row.lifetimeCreditsEarned),
      lifetimeCreditsSpent: Number(row.lifetimeCreditsSpent),
      lastTransactionAt: row.lastTransactionAt ? new Date(row.lastTransactionAt) : null,
      walletCreatedAt: row.walletCreatedAt ? new Date(row.walletCreatedAt) : null,
    }));
  } catch (error) {
    console.error('[OwlFenc Wallet] Error fetching wallet balances:', error);
    throw error;
  }
}

/**
 * Grant credits to a list of users.
 * Uses the correct schema column names:
 *   wallet_accounts: balance_credits, total_credits_earned, firebase_uid
 *   wallet_transactions: amount_credits, balance_after, direction, wallet_id, firebase_uid
 *
 * Flow per user:
 *   1. Get firebase_uid from users table (needed for wallet lookup)
 *   2. Upsert wallet_accounts using firebase_uid (unique constraint)
 *   3. Get wallet id + new balance
 *   4. Insert wallet_transactions with all required NOT NULL columns
 */
export async function grantCreditsToUsers(params: {
  userIds: number[];
  amount: number;
  description: string;
  adminNote?: string;
  expiresAt?: Date;
  adminEmail: string;
}): Promise<GrantResult> {
  const db = getOwlFencDb();
  if (!db) {
    throw new Error('Owl Fenc database not available');
  }

  const { userIds, amount, description, adminNote, expiresAt, adminEmail } = params;
  const errors: Array<{ userId: number; error: string }> = [];
  let usersGranted = 0;

  for (const userId of userIds) {
    try {
      // 1. Get firebase_uid for this user (required for wallet_accounts unique constraint)
      const userResult = await db.execute(sql`
        SELECT firebase_uid FROM users WHERE id = ${userId} LIMIT 1
      `);
      if (!userResult.rows || userResult.rows.length === 0) {
        throw new Error(`User ${userId} not found`);
      }
      const firebaseUid = userResult.rows[0].firebase_uid as string;

      // 2. Upsert wallet_accounts — create if not exists, then add credits atomically
      //    Uses correct columns: balance_credits, total_credits_earned, firebase_uid
      await db.execute(sql`
        INSERT INTO wallet_accounts (user_id, firebase_uid, balance_credits, total_credits_earned, total_credits_spent, updated_at)
        VALUES (${userId}, ${firebaseUid}, ${amount}, ${amount}, 0, NOW())
        ON CONFLICT (user_id) DO UPDATE
          SET balance_credits       = wallet_accounts.balance_credits + ${amount},
              total_credits_earned  = wallet_accounts.total_credits_earned + ${amount},
              updated_at            = NOW()
      `);

      // 3. Get wallet id and new balance for the transaction record
      const walletResult = await db.execute(sql`
        SELECT id, balance_credits FROM wallet_accounts WHERE user_id = ${userId} LIMIT 1
      `);
      const walletId = Number(walletResult.rows[0]?.id ?? 0);
      const balanceAfter = Number(walletResult.rows[0]?.balance_credits ?? 0);

      // 4. Build deterministic idempotency key to prevent double-grants
      const descSlug = description.toLowerCase().replace(/[^a-z0-9]/g, '_').slice(0, 30);
      const idempotencyKey = `admin:${adminEmail}:${firebaseUid}:${amount}cr:${descSlug}`;

      // 5. Insert transaction record with all required NOT NULL columns
      //    type: 'admin_adjustment' (matches owlfenc schema enum)
      //    direction: 'credit'
      //    amount_credits: always positive (direction determines sign)
      await db.execute(sql`
        INSERT INTO wallet_transactions (
          wallet_id,
          user_id,
          firebase_uid,
          type,
          direction,
          amount_credits,
          balance_after,
          description,
          metadata,
          expires_at,
          idempotency_key,
          created_at
        ) VALUES (
          ${walletId},
          ${userId},
          ${firebaseUid},
          'admin_adjustment',
          'credit',
          ${amount},
          ${balanceAfter},
          ${description},
          ${JSON.stringify({ grantedBy: adminEmail, adminNote: adminNote ?? null })}::jsonb,
          ${expiresAt ?? null},
          ${idempotencyKey},
          NOW()
        )
        ON CONFLICT (idempotency_key) DO NOTHING
      `);

      usersGranted++;
    } catch (error: any) {
      console.error(`[OwlFenc Wallet] Error granting credits to user ${userId}:`, error);
      errors.push({ userId, error: error.message });
    }
  }

  return {
    success: errors.length === 0,
    usersGranted,
    totalCreditsGranted: usersGranted * amount,
    errors,
  };
}

/**
 * Get the full history of admin grants from wallet_transactions.
 * Uses correct column: amount_credits (not amount), type = 'admin_adjustment'
 * adminNote is stored in metadata JSONB field.
 */
export async function getAdminGrantHistory(limit = 200): Promise<AdminGrantRecord[]> {
  const db = getOwlFencDb();
  if (!db) {
    throw new Error('Owl Fenc database not available');
  }

  try {
    const result = await db.execute(sql`
      SELECT
        wt.id                                   AS "id",
        wt.user_id                              AS "userId",
        wt.firebase_uid                         AS "firebaseUid",
        u.email                                 AS "email",
        COALESCE(u.owner_name, u.username)       AS "displayName",
        wt.amount_credits                       AS "amount",
        wt.description                          AS "description",
        wt.metadata->>'adminNote'               AS "adminNote",
        wt.expires_at                           AS "expiresAt",
        wt.created_at                           AS "createdAt",
        wt.balance_after                        AS "balanceAfter"
      FROM wallet_transactions wt
      INNER JOIN users u ON wt.user_id = u.id
      WHERE wt.type = 'admin_adjustment'
        AND wt.direction = 'credit'
      ORDER BY wt.created_at DESC
      LIMIT ${limit}
    `);

    return result.rows.map((row: any) => ({
      id: Number(row.id),
      userId: Number(row.userId),
      firebaseUid: row.firebaseUid as string,
      email: row.email as string,
      displayName: row.displayName as string | null,
      amount: Number(row.amount),
      description: row.description as string,
      adminNote: row.adminNote as string | null,
      expiresAt: row.expiresAt ? new Date(row.expiresAt) : null,
      createdAt: new Date(row.createdAt),
      balanceAfter: Number(row.balanceAfter),
    }));
  } catch (error) {
    console.error('[OwlFenc Wallet] Error fetching admin grant history:', error);
    throw error;
  }
}

/**
 * Get aggregated stats for the grant history panel.
 * Uses correct column names: balance_credits, amount_credits
 */
export async function getWalletStats(): Promise<{
  totalCreditsInCirculation: number;
  totalAdminGrantsThisMonth: number;
  totalCreditsConsumedThisMonth: number;
  usersWithWallet: number;
  usersWithZeroBalance: number;
}> {
  const db = getOwlFencDb();
  if (!db) {
    throw new Error('Owl Fenc database not available');
  }

  try {
    const [circulation, grants, consumed, walletUsers, zeroBalance] = await Promise.all([
      // Total credits in circulation across all wallets
      db.execute(sql`SELECT COALESCE(SUM(balance_credits), 0) AS total FROM wallet_accounts`),
      // Admin grants this month (type = admin_adjustment, direction = credit)
      db.execute(sql`
        SELECT COALESCE(SUM(amount_credits), 0) AS total
        FROM wallet_transactions
        WHERE type = 'admin_adjustment'
          AND direction = 'credit'
          AND created_at >= DATE_TRUNC('month', CURRENT_TIMESTAMP)
      `),
      // Credits consumed this month (direction = debit)
      db.execute(sql`
        SELECT COALESCE(SUM(amount_credits), 0) AS total
        FROM wallet_transactions
        WHERE direction = 'debit'
          AND created_at >= DATE_TRUNC('month', CURRENT_TIMESTAMP)
      `),
      db.execute(sql`SELECT COUNT(*) AS count FROM wallet_accounts`),
      db.execute(sql`SELECT COUNT(*) AS count FROM wallet_accounts WHERE balance_credits <= 0`),
    ]);

    return {
      totalCreditsInCirculation: Number(circulation.rows[0]?.total ?? 0),
      totalAdminGrantsThisMonth: Number(grants.rows[0]?.total ?? 0),
      totalCreditsConsumedThisMonth: Number(consumed.rows[0]?.total ?? 0),
      usersWithWallet: Number(walletUsers.rows[0]?.count ?? 0),
      usersWithZeroBalance: Number(zeroBalance.rows[0]?.count ?? 0),
    };
  } catch (error) {
    console.error('[OwlFenc Wallet] Error fetching wallet stats:', error);
    throw error;
  }
}
