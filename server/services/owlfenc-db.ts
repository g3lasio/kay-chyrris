/**
 * Owl Fenc Database Service
 * Connects to Owl Fenc PostgreSQL database (Neon) and provides query methods
 * 
 * Schema: Uses unified PostgreSQL schema with Firebase Auth integration
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
        ssl: { rejectUnauthorized: true },
        max: 10,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 10000,
      });

      owlfencDb = drizzle(owlfencPool);
      console.log('[OwlFenc DB] Connected successfully to Neon PostgreSQL');
    } catch (error) {
      console.error('[OwlFenc DB] Failed to connect:', error);
      owlfencDb = null;
    }
  }
  return owlfencDb;
}

/**
 * Get all users from Owl Fenc with their subscription info
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
        u.id,
        u.firebase_uid as "firebaseUid",
        u.username,
        u.email,
        u.company,
        u.owner_name as "ownerName",
        u.role,
        u.phone,
        u.created_at as "createdAt",
        sp.name as "planName",
        us.status as "subscriptionStatus",
        sp.price as "planPrice"
      FROM users u
      LEFT JOIN user_subscriptions us ON u.id = us.user_id
      LEFT JOIN subscription_plans sp ON us.plan_id = sp.id
    `;

    if (search) {
      query = sql`${query} WHERE 
        u.username ILIKE ${`%${search}%`} OR 
        u.email ILIKE ${`%${search}%`} OR
        u.company ILIKE ${`%${search}%`} OR
        u.owner_name ILIKE ${`%${search}%`}
      `;
    }

    query = sql`${query} ORDER BY u.created_at DESC LIMIT ${limit} OFFSET ${offset}`;

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
        username ILIKE ${`%${search}%`} OR 
        email ILIKE ${`%${search}%`} OR
        company ILIKE ${`%${search}%`} OR
        owner_name ILIKE ${`%${search}%`}
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
        u.id,
        u.firebase_uid as "firebaseUid",
        u.username,
        u.email,
        u.company,
        u.owner_name as "ownerName",
        u.role,
        u.phone,
        u.created_at as "createdAt",
        sp.name as "planName",
        us.status as "subscriptionStatus",
        sp.price as "planPrice"
      FROM users u
      LEFT JOIN user_subscriptions us ON u.id = us.user_id
      LEFT JOIN subscription_plans sp ON us.plan_id = sp.id
      WHERE u.id = ${userId}
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
        us.id,
        us.user_id as "userId",
        sp.name as plan,
        sp.code as "planCode",
        sp.price,
        us.status,
        us.current_period_start as "currentPeriodStart",
        us.current_period_end as "currentPeriodEnd",
        us.cancel_at_period_end as "cancelAtPeriodEnd",
        us.stripe_customer_id as "stripeCustomerId",
        us.stripe_subscription_id as "stripeSubscriptionId",
        us.billing_cycle as "billingCycle",
        us.created_at as "createdAt",
        us.updated_at as "updatedAt"
      FROM user_subscriptions us
      INNER JOIN subscription_plans sp ON us.plan_id = sp.id
      WHERE us.user_id = ${userId}
      ORDER BY us.created_at DESC
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
        user_id as "userId",
        month,
        plan_id as "planId",
        basic_estimates_limit as "basicEstimatesLimit",
        ai_estimates_limit as "aiEstimatesLimit",
        contracts_limit as "contractsLimit",
        property_verifications_limit as "propertyVerificationsLimit",
        permit_advisor_limit as "permitAdvisorLimit",
        projects_limit as "projectsLimit",
        basic_estimates_used as "basicEstimatesUsed",
        ai_estimates_used as "aiEstimatesUsed",
        contracts_used as "contractsUsed",
        property_verifications_used as "propertyVerificationsUsed",
        permit_advisor_used as "permitAdvisorUsed",
        projects_used as "projectsUsed",
        created_at as "createdAt",
        updated_at as "updatedAt"
      FROM user_usage_limits
      WHERE user_id = ${userId.toString()}
      ORDER BY created_at DESC
      LIMIT 1
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

    // Active subscriptions
    const activeSubsResult = await db.execute(sql`
      SELECT COUNT(*) as count 
      FROM user_subscriptions 
      WHERE status = 'active'
    `);
    const activeSubscriptions = Number(activeSubsResult.rows[0]?.count || 0);

    // Users by plan
    const planStatsResult = await db.execute(sql`
      SELECT 
        sp.name as plan,
        sp.id as "planId",
        COUNT(*) as count
      FROM user_subscriptions us
      INNER JOIN subscription_plans sp ON us.plan_id = sp.id
      WHERE us.status = 'active'
      GROUP BY sp.name, sp.id
    `);

    const usersByPlan: Record<string, number> = {
      free: 0,
      patron: 0,
      master: 0,
    };
    let freeUsers = 0;
    let paidUsers = 0;

    for (const row of planStatsResult.rows) {
      const planName = row.plan as string;
      const count = Number(row.count);
      
      // Map plan names to frontend keys
      if (planName === 'Primo Chambeador' || planName === 'Free' || planName === 'Free Trial') {
        usersByPlan.free += count;
        freeUsers += count;
      } else if (planName === 'Mero Patrón') {
        usersByPlan.patron += count;
        paidUsers += count;
      } else if (planName === 'Master Contractor') {
        usersByPlan.master += count;
        paidUsers += count;
      }
    }

    // Calculate monthly revenue (sum of active paid subscriptions)
    const revenueResult = await db.execute(sql`
      SELECT COALESCE(SUM(sp.price), 0) as total
      FROM user_subscriptions us
      INNER JOIN subscription_plans sp ON us.plan_id = sp.id
      WHERE us.status = 'active' AND sp.id != 1
    `);
    const monthlyRevenue = Math.round(Number(revenueResult.rows[0]?.total || 0) / 100); // Convert cents to dollars

    // New users this month
    const newUsersResult = await db.execute(sql`
      SELECT COUNT(*) as count 
      FROM users 
      WHERE created_at >= DATE_TRUNC('month', CURRENT_TIMESTAMP)
    `);
    const newUsersThisMonth = Number(newUsersResult.rows[0]?.count || 0);

    // Total projects
    const projectsResult = await db.execute(sql`
      SELECT COUNT(*) as count FROM projects
    `);
    const totalProjects = Number(projectsResult.rows[0]?.count || 0);

    return {
      totalUsers,
      activeSubscriptions,
      freeUsers,
      paidUsers,
      monthlyRevenue,
      usersByPlan,
      newUsersThisMonth,
      totalProjects,
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

/**
 * Get users by subscription plan
 */
export async function getOwlFencUsersByPlan(plan: string | null): Promise<Array<{ id: number; email: string }>> {
  const db = getOwlFencDb();
  if (!db) {
    console.warn('[OwlFenc DB] Database not available');
    return [];
  }

  try {
    let result;

    if (plan === null) {
      // Get all users
      result = await db.execute(sql`
        SELECT id, email
        FROM users
        WHERE email IS NOT NULL
      `);
    } else {
      // Get users by specific plan
      result = await db.execute(sql`
        SELECT DISTINCT u.id, u.email
        FROM users u
        LEFT JOIN user_subscriptions us ON u.id = us.user_id
        LEFT JOIN subscription_plans sp ON us.plan_id = sp.id
        WHERE u.email IS NOT NULL
          AND (
            (LOWER(sp.name) = LOWER(${plan}) AND us.status = 'active')
            OR (sp.name IS NULL AND LOWER(${plan}) = 'free')
          )
      `);
    }

    return result.rows.map((row: any) => ({
      id: Number(row.id),
      email: row.email as string,
    }));
  } catch (error) {
    console.error('[OwlFenc DB] Error fetching users by plan:', error);
    return [];
  }
}
