/**
 * OWL FENC SUBSCRIPTIONS & USAGE SERVICE
 * 
 * Connects to Owl Fenc PostgreSQL database to fetch:
 * - User subscriptions (plans, status, billing)
 * - Usage limits and current usage
 * - Payment history
 */

import { Pool } from 'pg';

let owlfencPool: Pool | null = null;

function getOwlFencPool(): Pool | null {
  if (!owlfencPool && process.env.OWLFENC_DATABASE_URL) {
    try {
      owlfencPool = new Pool({
        connectionString: process.env.OWLFENC_DATABASE_URL,
        ssl: { rejectUnauthorized: true },
        max: 10,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 10000,
      });
      console.log('[OwlFenc Subscriptions] Connected to PostgreSQL');
    } catch (error) {
      console.error('[OwlFenc Subscriptions] Failed to connect:', error);
      return null;
    }
  }
  return owlfencPool;
}

export interface UserSubscription {
  userId: number;
  planId: number;
  planName: string;
  planCode: string;
  price: number;
  status: string;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  currentPeriodStart: Date | null;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  billingCycle: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface UserUsage {
  userId: string;
  month: string;
  planId: number;
  // Limits
  basicEstimatesLimit: number;
  aiEstimatesLimit: number;
  contractsLimit: number;
  propertyVerificationsLimit: number;
  permitAdvisorLimit: number;
  projectsLimit: number;
  // Usage
  basicEstimatesUsed: number;
  aiEstimatesUsed: number;
  contractsUsed: number;
  propertyVerificationsUsed: number;
  permitAdvisorUsed: number;
  projectsUsed: number;
}

export interface PaymentRecord {
  id: string;
  userId: number;
  amount: string;
  status: string;
  paymentDate: Date;
}

/**
 * Get user subscription by Firebase UID
 */
export async function getUserSubscription(firebaseUid: string): Promise<UserSubscription | null> {
  const db = getOwlFencPool();
  if (!db) {
    console.error('[OwlFenc Subscriptions] PostgreSQL pool not available');
    return null;
  }

  try {
    const result = await db.query(`
      SELECT 
        us.id,
        us.user_id as "userId",
        us.plan_id as "planId",
        sp.name as "planName",
        sp.code as "planCode",
        sp.price,
        us.status,
        us.stripe_customer_id as "stripeCustomerId",
        us.stripe_subscription_id as "stripeSubscriptionId",
        us.current_period_start as "currentPeriodStart",
        us.current_period_end as "currentPeriodEnd",
        us.cancel_at_period_end as "cancelAtPeriodEnd",
        us.billing_cycle as "billingCycle",
        us.created_at as "createdAt",
        us.updated_at as "updatedAt"
      FROM user_subscriptions us
      JOIN subscription_plans sp ON us.plan_id = sp.id
      JOIN users u ON us.user_id = u.id
      WHERE u.firebase_uid = $1
      ORDER BY us.created_at DESC
      LIMIT 1
    `, [firebaseUid]);

    if (result.rows.length === 0) {
      return null;
    }

    return result.rows[0] as UserSubscription;
  } catch (error) {
    console.error('[OwlFenc Subscriptions] Error fetching subscription:', error);
    return null;
  }
}

/**
 * Get user usage for current month
 */
export async function getUserUsage(firebaseUid: string): Promise<UserUsage | null> {
  const db = getOwlFencPool();
  if (!db) {
    console.error('[OwlFenc Subscriptions] PostgreSQL pool not available');
    return null;
  }

  try {
    // Get current month in format "2026-01"
    const currentMonth = new Date().toISOString().slice(0, 7);

    const result = await db.query(`
      SELECT 
        uul.user_id as "userId",
        uul.month,
        uul.plan_id as "planId",
        uul.basic_estimates_limit as "basicEstimatesLimit",
        uul.ai_estimates_limit as "aiEstimatesLimit",
        uul.contracts_limit as "contractsLimit",
        uul.property_verifications_limit as "propertyVerificationsLimit",
        uul.permit_advisor_limit as "permitAdvisorLimit",
        uul.projects_limit as "projectsLimit",
        uul.basic_estimates_used as "basicEstimatesUsed",
        uul.ai_estimates_used as "aiEstimatesUsed",
        uul.contracts_used as "contractsUsed",
        uul.property_verifications_used as "propertyVerificationsUsed",
        uul.permit_advisor_used as "permitAdvisorUsed",
        uul.projects_used as "projectsUsed"
      FROM user_usage_limits uul
      JOIN users u ON uul.user_id::text = u.id::text
      WHERE u.firebase_uid = $1 AND uul.month = $2
      LIMIT 1
    `, [firebaseUid, currentMonth]);

    if (result.rows.length === 0) {
      return null;
    }

    return result.rows[0] as UserUsage;
  } catch (error) {
    console.error('[OwlFenc Subscriptions] Error fetching usage:', error);
    return null;
  }
}

/**
 * Get payment history for a user
 */
export async function getUserPaymentHistory(firebaseUid: string, limit: number = 10): Promise<PaymentRecord[]> {
  const db = getOwlFencPool();
  if (!db) {
    console.error('[OwlFenc Subscriptions] PostgreSQL pool not available');
    return [];
  }

  try {
    const result = await db.query(`
      SELECT 
        ph.id,
        ph.user_id as "userId",
        ph.amount,
        ph.status,
        ph.payment_date as "paymentDate"
      FROM payment_history ph
      JOIN users u ON ph.user_id = u.id
      WHERE u.firebase_uid = $1
      ORDER BY ph.payment_date DESC
      LIMIT $2
    `, [firebaseUid, limit]);

    return result.rows as PaymentRecord[];
  } catch (error) {
    console.error('[OwlFenc Subscriptions] Error fetching payment history:', error);
    return [];
  }
}

/**
 * Get all active subscriptions with stats
 */
export async function getAllSubscriptionsStats() {
  const db = getOwlFencPool();
  if (!db) {
    console.error('[OwlFenc Subscriptions] PostgreSQL pool not available');
    return null;
  }

  try {
    const result = await db.query(`
      SELECT 
        sp.id as "planId",
        sp.name as "planName",
        sp.code as "planCode",
        sp.price,
        COUNT(us.id) as "userCount",
        SUM(CASE WHEN us.status = 'active' THEN 1 ELSE 0 END) as "activeCount",
        SUM(CASE WHEN us.status = 'canceled' THEN 1 ELSE 0 END) as "canceledCount"
      FROM subscription_plans sp
      LEFT JOIN user_subscriptions us ON sp.id = us.plan_id
      WHERE sp.is_active = true
      GROUP BY sp.id, sp.name, sp.code, sp.price
      ORDER BY sp.price DESC
    `);

    return result.rows;
  } catch (error) {
    console.error('[OwlFenc Subscriptions] Error fetching subscription stats:', error);
    return null;
  }
}


/**
 * Get property verifications count from PostgreSQL
 * Queries property_search_history table
 */
export async function getPropertyVerificationsCount(firebaseUid?: string): Promise<number> {
  const pool = getOwlFencPool();
  if (!pool) {
    console.log('[OwlFenc Subscriptions] PostgreSQL pool not available for property verifications');
    return 0;
  }

  try {
    // For now, only return total count (per-user filtering requires proper user table mapping)
    const query = 'SELECT COUNT(*) as count FROM property_search_history';
    const result = await pool.query(query);
    return parseInt(result.rows[0]?.count || '0', 10);
  } catch (error) {
    console.error('[OwlFenc Subscriptions] Error fetching property verifications:', error);
    return 0;
  }
}

/**
 * Get all users' property verifications breakdown
 * Returns array of {userId, count}
 */
export async function getPropertyVerificationsBreakdown(): Promise<Array<{firebaseUid: string, count: number}>> {
  const pool = getOwlFencPool();
  if (!pool) {
    console.log('[OwlFenc Subscriptions] PostgreSQL pool not available for property verifications breakdown');
    return [];
  }

  try {
    const query = `
      SELECT u.firebase_uid as "firebaseUid", COUNT(*) as count 
      FROM property_search_history psh
      INNER JOIN users u ON psh.user_id = u.id
      WHERE u.firebase_uid IS NOT NULL
      GROUP BY u.firebase_uid
    `;
    
    const result = await pool.query(query);
    return result.rows.map(row => ({
      firebaseUid: row.firebaseUid,
      count: parseInt(row.count, 10)
    }));
  } catch (error) {
    console.error('[OwlFenc Subscriptions] Error fetching property verifications breakdown:', error);
    return [];
  }
}
