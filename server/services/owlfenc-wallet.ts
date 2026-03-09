/**
 * OWLFENC WALLET SERVICE — Chyrris KAI Admin Panel
 *
 * Connects directly to the Owl Fenc PostgreSQL database to:
 * - Read wallet balances from wallet_accounts
 * - Read transaction history from wallet_transactions
 * - Execute admin credit grants (addCredits)
 *
 * Architecture: Direct DB connection via OWLFENC_DATABASE_URL
 * (no HTTP calls to owlfenc API — more secure, less latency)
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
 */
export async function getUserWalletBalances(planFilter?: string): Promise<UserWalletBalance[]> {
  const db = getOwlFencDb();
  if (!db) {
    throw new Error('Owl Fenc database not available');
  }

  try {
    const result = await db.execute(sql`
      SELECT
        u.id                                              AS "userId",
        u.firebase_uid                                    AS "firebaseUid",
        u.email                                           AS "email",
        u.display_name                                    AS "displayName",
        COALESCE(sp.name, 'Free')                         AS "planName",
        COALESCE(us.plan_id, 5)                           AS "planId",
        COALESCE(wa.balance, 0)                           AS "creditBalance",
        COALESCE(wa.lifetime_credits_earned, 0)           AS "lifetimeCreditsEarned",
        COALESCE(wa.lifetime_credits_spent, 0)            AS "lifetimeCreditsSpent",
        wa.updated_at                                     AS "lastTransactionAt",
        wa.created_at                                     AS "walletCreatedAt"
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
      ORDER BY COALESCE(wa.balance, 0) DESC, u.email ASC
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
 * Uses atomic SQL UPDATE to ensure balance integrity.
 * Records each grant in wallet_transactions with type 'admin_grant'.
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
      // 1. Upsert wallet_accounts — create if not exists, then add credits atomically
      await db.execute(sql`
        INSERT INTO wallet_accounts (user_id, balance, lifetime_credits_earned, lifetime_credits_spent, updated_at)
        VALUES (${userId}, ${amount}, ${amount}, 0, NOW())
        ON CONFLICT (user_id) DO UPDATE
          SET balance                  = wallet_accounts.balance + ${amount},
              lifetime_credits_earned  = wallet_accounts.lifetime_credits_earned + ${amount},
              updated_at               = NOW()
      `);

      // 2. Get the new balance for the transaction record
      const balanceResult = await db.execute(sql`
        SELECT balance FROM wallet_accounts WHERE user_id = ${userId}
      `);
      const balanceAfter = Number(balanceResult.rows[0]?.balance ?? 0);

      // 3. Insert transaction record in wallet_transactions
      await db.execute(sql`
        INSERT INTO wallet_transactions (
          user_id,
          type,
          amount,
          balance_after,
          description,
          admin_note,
          expires_at,
          created_at
        ) VALUES (
          ${userId},
          'admin_grant',
          ${amount},
          ${balanceAfter},
          ${description},
          ${adminNote ?? `Admin grant by ${adminEmail}`},
          ${expiresAt ?? null},
          NOW()
        )
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
 * Groups by description+date to show "batch" grants.
 */
export async function getAdminGrantHistory(limit = 200): Promise<AdminGrantRecord[]> {
  const db = getOwlFencDb();
  if (!db) {
    throw new Error('Owl Fenc database not available');
  }

  try {
    const result = await db.execute(sql`
      SELECT
        wt.id                   AS "id",
        wt.user_id              AS "userId",
        u.firebase_uid          AS "firebaseUid",
        u.email                 AS "email",
        u.display_name          AS "displayName",
        wt.amount               AS "amount",
        wt.description          AS "description",
        wt.admin_note           AS "adminNote",
        wt.expires_at           AS "expiresAt",
        wt.created_at           AS "createdAt",
        wt.balance_after        AS "balanceAfter"
      FROM wallet_transactions wt
      INNER JOIN users u ON wt.user_id = u.id
      WHERE wt.type = 'admin_grant'
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
      db.execute(sql`SELECT COALESCE(SUM(balance), 0) AS total FROM wallet_accounts`),
      db.execute(sql`
        SELECT COALESCE(SUM(amount), 0) AS total
        FROM wallet_transactions
        WHERE type = 'admin_grant'
          AND created_at >= DATE_TRUNC('month', CURRENT_TIMESTAMP)
      `),
      db.execute(sql`
        SELECT COALESCE(SUM(ABS(amount)), 0) AS total
        FROM wallet_transactions
        WHERE amount < 0
          AND created_at >= DATE_TRUNC('month', CURRENT_TIMESTAMP)
      `),
      db.execute(sql`SELECT COUNT(*) AS count FROM wallet_accounts`),
      db.execute(sql`SELECT COUNT(*) AS count FROM wallet_accounts WHERE balance <= 0`),
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
