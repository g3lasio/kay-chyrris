import Stripe from 'stripe';
import { getOwlFencUsers } from './owlfenc-firebase';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '', {
  apiVersion: '2025-12-15.clover',
});

export interface RevenueMetrics {
  mrr: number; // Monthly Recurring Revenue
  yearlyRevenue: number; // Total revenue for current year
  revenueGrowth: number; // Month-over-month growth percentage
  lastMonthRevenue: number;
}

export interface UserGrowthMetrics {
  totalUsers: number;
  newUsersThisMonth: number;
  userGrowth: number; // Month-over-month growth percentage
  activeUsers: number; // Users with active subscriptions
}

export interface MonthlyRevenueData {
  month: string; // Format: "2024-01"
  revenue: number;
  subscriptions: number;
}

export interface MonthlyUserData {
  month: string; // Format: "2024-01"
  totalUsers: number;
  newUsers: number;
}

/**
 * Calculate MRR from active Stripe subscriptions
 */
export async function calculateMRR(): Promise<number> {
  try {
    const subscriptions = await stripe.subscriptions.list({
      status: 'active',
      limit: 100,
    });

    let mrr = 0;
    for (const sub of subscriptions.data) {
      // Sum up all subscription items
      for (const item of sub.items.data) {
        const amount = item.price.unit_amount || 0;
        const quantity = item.quantity || 1;
        
        // Convert to monthly amount based on interval
        if (item.price.recurring?.interval === 'month') {
          mrr += (amount * quantity) / 100; // Convert from cents to dollars
        } else if (item.price.recurring?.interval === 'year') {
          mrr += (amount * quantity) / 12 / 100; // Annual to monthly
        }
      }
    }

    return Math.round(mrr * 100) / 100; // Round to 2 decimals
  } catch (error) {
    console.error('[Revenue] Error calculating MRR:', error);
    return 0;
  }
}

/**
 * Get total revenue for current year from Stripe
 */
export async function getYearlyRevenue(): Promise<number> {
  try {
    const currentYear = new Date().getFullYear();
    const startOfYear = Math.floor(new Date(`${currentYear}-01-01`).getTime() / 1000);
    const endOfYear = Math.floor(new Date(`${currentYear}-12-31T23:59:59`).getTime() / 1000);

    const charges = await stripe.charges.list({
      created: {
        gte: startOfYear,
        lte: endOfYear,
      },
      limit: 100,
    });

    let totalRevenue = 0;
    for (const charge of charges.data) {
      if (charge.paid && !charge.refunded) {
        totalRevenue += charge.amount / 100; // Convert from cents
      }
    }

    // If there are more charges, fetch them
    if (charges.has_more) {
      let hasMore = true;
      let startingAfter = charges.data[charges.data.length - 1].id;

      while (hasMore) {
        const moreCharges = await stripe.charges.list({
          created: {
            gte: startOfYear,
            lte: endOfYear,
          },
          limit: 100,
          starting_after: startingAfter,
        });

        for (const charge of moreCharges.data) {
          if (charge.paid && !charge.refunded) {
            totalRevenue += charge.amount / 100;
          }
        }

        hasMore = moreCharges.has_more;
        if (hasMore) {
          startingAfter = moreCharges.data[moreCharges.data.length - 1].id;
        }
      }
    }

    return Math.round(totalRevenue * 100) / 100;
  } catch (error) {
    console.error('[Revenue] Error calculating yearly revenue:', error);
    return 0;
  }
}

/**
 * Calculate revenue growth (month-over-month)
 */
export async function calculateRevenueGrowth(): Promise<{ growth: number; lastMonthRevenue: number }> {
  try {
    const now = new Date();
    const currentMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const twoMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 2, 1);

    // Get current month revenue
    const currentMonthStart = Math.floor(currentMonth.getTime() / 1000);
    const currentMonthEnd = Math.floor(now.getTime() / 1000);

    const currentCharges = await stripe.charges.list({
      created: {
        gte: currentMonthStart,
        lte: currentMonthEnd,
      },
      limit: 100,
    });

    let currentRevenue = 0;
    for (const charge of currentCharges.data) {
      if (charge.paid && !charge.refunded) {
        currentRevenue += charge.amount / 100;
      }
    }

    // Get last month revenue
    const lastMonthStart = Math.floor(lastMonth.getTime() / 1000);
    const lastMonthEnd = Math.floor(currentMonth.getTime() / 1000) - 1;

    const lastCharges = await stripe.charges.list({
      created: {
        gte: lastMonthStart,
        lte: lastMonthEnd,
      },
      limit: 100,
    });

    let lastRevenue = 0;
    for (const charge of lastCharges.data) {
      if (charge.paid && !charge.refunded) {
        lastRevenue += charge.amount / 100;
      }
    }

    // Calculate growth percentage
    const growth = lastRevenue > 0
      ? ((currentRevenue - lastRevenue) / lastRevenue) * 100
      : 0;

    return {
      growth: Math.round(growth * 100) / 100,
      lastMonthRevenue: Math.round(lastRevenue * 100) / 100,
    };
  } catch (error) {
    console.error('[Revenue] Error calculating revenue growth:', error);
    return { growth: 0, lastMonthRevenue: 0 };
  }
}

/**
 * Get complete revenue metrics
 */
export async function getRevenueMetrics(): Promise<RevenueMetrics> {
  const [mrr, yearlyRevenue, growthData] = await Promise.all([
    calculateMRR(),
    getYearlyRevenue(),
    calculateRevenueGrowth(),
  ]);

  return {
    mrr,
    yearlyRevenue,
    revenueGrowth: growthData.growth,
    lastMonthRevenue: growthData.lastMonthRevenue,
  };
}

/**
 * Get user growth metrics from Firebase
 */
export async function getUserGrowthMetrics(): Promise<UserGrowthMetrics> {
  try {
    const users = await getOwlFencUsers();
    const totalUsers = users.length;

    // Calculate new users this month
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    
    let newUsersThisMonth = 0;
    let lastMonthUsers = 0;

    for (const user of users) {
      const createdAt = new Date((user as any).metadata?.creationTime || user.uid);
      
      if (createdAt >= startOfMonth) {
        newUsersThisMonth++;
      }
      
      // Count users created before this month
      if (createdAt < startOfMonth) {
        lastMonthUsers++;
      }
    }

    // Calculate growth percentage
    const userGrowth = lastMonthUsers > 0
      ? (newUsersThisMonth / lastMonthUsers) * 100
      : 0;

    // Count active users (with active subscriptions)
    const activeSubscriptions = await stripe.subscriptions.list({
      status: 'active',
      limit: 100,
    });

    return {
      totalUsers,
      newUsersThisMonth,
      userGrowth: Math.round(userGrowth * 100) / 100,
      activeUsers: activeSubscriptions.data.length,
    };
  } catch (error) {
    console.error('[UserGrowth] Error calculating user growth metrics:', error);
    return {
      totalUsers: 0,
      newUsersThisMonth: 0,
      userGrowth: 0,
      activeUsers: 0,
    };
  }
}

/**
 * Get monthly revenue history for charts (last 12 months)
 */
export async function getRevenueHistory(): Promise<MonthlyRevenueData[]> {
  try {
    const history: MonthlyRevenueData[] = [];
    const now = new Date();

    for (let i = 11; i >= 0; i--) {
      const month = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const nextMonth = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);
      
      const monthStart = Math.floor(month.getTime() / 1000);
      const monthEnd = Math.floor(nextMonth.getTime() / 1000) - 1;

      const charges = await stripe.charges.list({
        created: {
          gte: monthStart,
          lte: monthEnd,
        },
        limit: 100,
      });

      let monthRevenue = 0;
      for (const charge of charges.data) {
        if (charge.paid && !charge.refunded) {
          monthRevenue += charge.amount / 100;
        }
      }

      const subscriptions = await stripe.subscriptions.list({
        created: {
          gte: monthStart,
          lte: monthEnd,
        },
        limit: 100,
      });

      history.push({
        month: month.toISOString().slice(0, 7), // Format: "2024-01"
        revenue: Math.round(monthRevenue * 100) / 100,
        subscriptions: subscriptions.data.length,
      });
    }

    return history;
  } catch (error) {
    console.error('[Revenue] Error fetching revenue history:', error);
    return [];
  }
}

/**
 * Get monthly user growth history for charts (last 12 months)
 */
export async function getUserGrowthHistory(): Promise<MonthlyUserData[]> {
  try {
    const users = await getOwlFencUsers();
    const history: MonthlyUserData[] = [];
    const now = new Date();

    for (let i = 11; i >= 0; i--) {
      const month = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const nextMonth = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);

      let totalUsers = 0;
      let newUsers = 0;

      for (const user of users) {
        const createdAt = new Date((user as any).metadata?.creationTime || user.uid);
        
        // Count users created up to end of this month
        if (createdAt < nextMonth) {
          totalUsers++;
        }
        
        // Count users created in this specific month
        if (createdAt >= month && createdAt < nextMonth) {
          newUsers++;
        }
      }

      history.push({
        month: month.toISOString().slice(0, 7),
        totalUsers,
        newUsers,
      });
    }

    return history;
  } catch (error) {
    console.error('[UserGrowth] Error fetching user growth history:', error);
    return [];
  }
}
