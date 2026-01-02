/**
 * Owl Fenc Database Service
 * Connects to Owl Fenc PostgreSQL database and provides query methods
 */

import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { sql } from 'drizzle-orm';

let owlfencPool: Pool | null = null;
let owlfencDb: ReturnType<typeof drizzle> | null = null;

/**
 * Initialize connection to Owl Fenc database
 */
export function getOwlFencDb() {
  if (!owlfencDb && process.env.OWLFENC_DATABASE_URL) {
    try {
      owlfencPool = new Pool({
        connectionString: process.env.OWLFENC_DATABASE_URL,
        max: 10,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 10000,
      });

      owlfencDb = drizzle(owlfencPool);
      console.log('[OwlFenc DB] Connected successfully');
    } catch (error) {
      console.error('[OwlFenc DB] Failed to connect:', error);
      owlfencDb = null;
    }
  }
  return owlfencDb;
}

/**
 * Get all users from Owl Fenc
 */
export async function getOwlFencUsers(options: {
  limit?: number;
  offset?: number;
  search?: string;
}) {
  const db = getOwlFencDb();
  if (!db) {
    throw new Error('Owl Fenc database not available');
  }

  const { limit = 50, offset = 0, search } = options;

  try {
    let query = sql`
      SELECT 
        id,
        "openId",
        name,
        email,
        "loginMethod",
        role,
        "createdAt",
        "updatedAt",
        "lastSignedIn"
      FROM users
    `;

    if (search) {
      query = sql`${query} WHERE 
        name ILIKE ${`%${search}%`} OR 
        email ILIKE ${`%${search}%`}
      `;
    }

    query = sql`${query} ORDER BY "createdAt" DESC LIMIT ${limit} OFFSET ${offset}`;

    const result = await db.execute(query);
    return result.rows;
  } catch (error) {
    console.error('[OwlFenc DB] Error fetching users:', error);
    throw error;
  }
}

/**
 * Get user count
 */
export async function getOwlFencUserCount(search?: string) {
  const db = getOwlFencDb();
  if (!db) {
    throw new Error('Owl Fenc database not available');
  }

  try {
    let query = sql`SELECT COUNT(*) as count FROM users`;

    if (search) {
      query = sql`${query} WHERE 
        name ILIKE ${`%${search}%`} OR 
        email ILIKE ${`%${search}%`}
      `;
    }

    const result = await db.execute(query);
    return Number(result.rows[0]?.count || 0);
  } catch (error) {
    console.error('[OwlFenc DB] Error counting users:', error);
    throw error;
  }
}

/**
 * Get user by ID
 */
export async function getOwlFencUserById(userId: number) {
  const db = getOwlFencDb();
  if (!db) {
    throw new Error('Owl Fenc database not available');
  }

  try {
    const result = await db.execute(sql`
      SELECT 
        id,
        "openId",
        name,
        email,
        "loginMethod",
        role,
        "createdAt",
        "updatedAt",
        "lastSignedIn"
      FROM users
      WHERE id = ${userId}
    `);

    return result.rows[0] || null;
  } catch (error) {
    console.error('[OwlFenc DB] Error fetching user:', error);
    throw error;
  }
}

/**
 * Get subscription data for a user
 */
export async function getOwlFencUserSubscription(userId: number) {
  const db = getOwlFencDb();
  if (!db) {
    throw new Error('Owl Fenc database not available');
  }

  try {
    const result = await db.execute(sql`
      SELECT 
        id,
        "userId",
        plan,
        status,
        "currentPeriodStart",
        "currentPeriodEnd",
        "cancelAtPeriodEnd",
        "stripeCustomerId",
        "stripeSubscriptionId",
        "createdAt",
        "updatedAt"
      FROM subscriptions
      WHERE "userId" = ${userId}
      ORDER BY "createdAt" DESC
      LIMIT 1
    `);

    return result.rows[0] || null;
  } catch (error) {
    console.error('[OwlFenc DB] Error fetching subscription:', error);
    throw error;
  }
}

/**
 * Get usage limits for a user
 */
export async function getOwlFencUserLimits(userId: number) {
  const db = getOwlFencDb();
  if (!db) {
    throw new Error('Owl Fenc database not available');
  }

  try {
    const result = await db.execute(sql`
      SELECT 
        id,
        "userId",
        "contractsUsed",
        "contractsLimit",
        "estimatesUsed",
        "estimatesLimit",
        "invoicesUsed",
        "invoicesLimit",
        "propertyVerificationsUsed",
        "propertyVerificationsLimit",
        "permitAdvisorUsed",
        "permitAdvisorLimit",
        "totalQueriesUsed",
        "totalQueriesLimit",
        "resetAt",
        "createdAt",
        "updatedAt"
      FROM user_limits
      WHERE "userId" = ${userId}
    `);

    return result.rows[0] || null;
  } catch (error) {
    console.error('[OwlFenc DB] Error fetching user limits:', error);
    throw error;
  }
}

/**
 * Get dashboard statistics
 */
export async function getOwlFencDashboardStats() {
  const db = getOwlFencDb();
  if (!db) {
    throw new Error('Owl Fenc database not available');
  }

  try {
    // Total users
    const totalUsersResult = await db.execute(sql`SELECT COUNT(*) as count FROM users`);
    const totalUsers = Number(totalUsersResult.rows[0]?.count || 0);

    // Users by plan
    const planStatsResult = await db.execute(sql`
      SELECT 
        s.plan,
        COUNT(*) as count
      FROM subscriptions s
      INNER JOIN users u ON s."userId" = u.id
      WHERE s.status = 'active'
      GROUP BY s.plan
    `);

    const usersByPlan: Record<string, number> = {};
    for (const row of planStatsResult.rows) {
      usersByPlan[row.plan as string] = Number(row.count);
    }

    // New users this month
    const newUsersResult = await db.execute(sql`
      SELECT COUNT(*) as count 
      FROM users 
      WHERE "createdAt" >= DATE_TRUNC('month', CURRENT_DATE)
    `);
    const newUsersThisMonth = Number(newUsersResult.rows[0]?.count || 0);

    // Active users (logged in last 30 days)
    const activeUsersResult = await db.execute(sql`
      SELECT COUNT(*) as count 
      FROM users 
      WHERE "lastSignedIn" >= CURRENT_DATE - INTERVAL '30 days'
    `);
    const activeUsers = Number(activeUsersResult.rows[0]?.count || 0);

    return {
      totalUsers,
      usersByPlan,
      newUsersThisMonth,
      activeUsers,
    };
  } catch (error) {
    console.error('[OwlFenc DB] Error fetching dashboard stats:', error);
    throw error;
  }
}

/**
 * Close database connection
 */
export async function closeOwlFencDb() {
  if (owlfencPool) {
    await owlfencPool.end();
    owlfencPool = null;
    owlfencDb = null;
    console.log('[OwlFenc DB] Connection closed');
  }
}
