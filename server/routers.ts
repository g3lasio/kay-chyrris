import { z } from "zod";
import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, protectedProcedure, router } from "./_core/trpc";
import { verifyPasscode, validateSession, invalidateSession } from "./services/auth";
import {
  getOwlFencUsers,
  getOwlFencUserCount,
  getOwlFencUserById,
  getOwlFencUserSubscription,
  getOwlFencUserLimits,
  getOwlFencDashboardStats,
} from "./services/owlfenc-db";
import * as stripeService from './services/stripe-service';
import { createAndSendCampaign, getCampaignHistory } from './services/notifications';
import * as pushNotifications from './services/notifications-push';
import * as revenueMetrics from './services/revenue-metrics';
import { partnerAdminRouter, partnerAuthRouter, partnerPortalRouter } from './partner/partner-router';

export const appRouter = router({
  system: systemRouter,

  auth: router({
    // Verify passcode and create session
    verifyPasscode: publicProcedure
      .input(z.object({ passcode: z.string().min(1) }))
      .mutation(async ({ input, ctx }) => {
        // The admin login never works through the partner portal domain.
        if (ctx.isPartnerHost) {
          return { success: false, error: 'Not available' };
        }
        const ipAddress = ctx.req.ip || ctx.req.socket.remoteAddress;
        const userAgent = ctx.req.headers['user-agent'];
        const result = await verifyPasscode(input.passcode, ipAddress, userAgent);
        if (result.success && result.sessionId) {
          const cookieOptions = getSessionCookieOptions(ctx.req);
          ctx.res.cookie(COOKIE_NAME, result.sessionId, cookieOptions);
        }
        return result;
      }),

    // Legacy stubs - OTP disabled
    sendOTP: publicProcedure
      .input(z.object({ email: z.string() }))
      .mutation(async () => ({ success: false, error: 'OTP login is disabled' })),
    verifyOTP: publicProcedure
      .input(z.object({ email: z.string(), code: z.string() }))
      .mutation(async () => ({ success: false, error: 'OTP login is disabled' })),

    // Get current user
    me: publicProcedure.query(async ({ ctx }) => {
      if (!ctx.user) {
        return null;
      }
      return ctx.user;
    }),

    // Logout
    logout: publicProcedure.mutation(async ({ ctx }) => {
      const sessionId = ctx.req.cookies[COOKIE_NAME];
      
      if (sessionId) {
        await invalidateSession(sessionId);
      }

      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      
      return { success: true };
    }),
  }),

  // Dashboard routes
  dashboard: router({
    // Get overview metrics for Owl Fenc
    overview: protectedProcedure.query(async ({ ctx }) => {
      try {
        const stats = await getOwlFencDashboardStats();
        return {
          success: true,
          data: stats,
        };
      } catch (error: any) {
        return {
          success: false,
          error: error.message,
        };
      }
    }),
  }),

  // Owl Fenc specific routes
  owlfenc: router({
    // Get users list from Firebase with subscription plans
    getUsers: protectedProcedure.query(async () => {
      try {
        const { getOwlFencUsersWithPlans } = await import('./services/owlfenc-firebase');
        const users = await getOwlFencUsersWithPlans();
        return {
          success: true,
          data: users,
        };
      } catch (error: any) {
        console.error('[Router] Error fetching Firebase users with plans:', error);
        return {
          success: false,
          error: error.message,
        };
      }
    }),

    // Get clients list from Firebase
    getClients: protectedProcedure.query(async () => {
      try {
        const { getOwlFencClients } = await import('./services/owlfenc-firebase');
        const clients = await getOwlFencClients();
        return {
          success: true,
          data: clients,
        };
      } catch (error: any) {
        console.error('[Router] Error fetching Firebase clients:', error);
        return {
          success: false,
          error: error.message,
        };
      }
    }),

    // Get user details
    getUserDetails: protectedProcedure
      .input(z.object({ userId: z.number() }))
      .query(async ({ input }) => {
        try {
          const user = await getOwlFencUserById(input.userId);
          if (!user) {
            return {
              success: false,
              error: 'User not found',
            };
          }

          const subscription = await getOwlFencUserSubscription(input.userId);
          const limits = await getOwlFencUserLimits(input.userId);

          return {
            success: true,
            data: {
              user,
              subscription,
              limits,
            },
          };
        } catch (error: any) {
          return {
            success: false,
            error: error.message,
          };
        }
      }),

    // Get user subscription and usage
    getUserSubscription: protectedProcedure
      .input(z.object({ firebaseUid: z.string() }))
      .query(async ({ input }) => {
        try {
          const { getUserSubscription, getUserUsage } = await import('./services/owlfenc-subscriptions');
          const subscription = await getUserSubscription(input.firebaseUid);
          const usage = await getUserUsage(input.firebaseUid);
          return {
            success: true,
            data: { subscription, usage },
          };
        } catch (error: any) {
          return {
            success: false,
            error: error.message,
          };
        }
      }),

    // Firebase Admin Actions
    disableUser: protectedProcedure
      .input(z.object({ uid: z.string() }))
      .mutation(async ({ input }) => {
        const { disableUser } = await import('./services/firebase-admin-actions');
        return await disableUser(input.uid);
      }),

    enableUser: protectedProcedure
      .input(z.object({ uid: z.string() }))
      .mutation(async ({ input }) => {
        const { enableUser } = await import('./services/firebase-admin-actions');
        return await enableUser(input.uid);
      }),

    deleteUser: protectedProcedure
      .input(z.object({ uid: z.string() }))
      .mutation(async ({ input }) => {
        const { deleteUser } = await import('./services/firebase-admin-actions');
        return await deleteUser(input.uid);
      }),

    sendPasswordReset: protectedProcedure
      .input(z.object({ email: z.string().email() }))
      .mutation(async ({ input }) => {
        const { sendPasswordResetEmail } = await import('./services/firebase-admin-actions');
        return await sendPasswordResetEmail(input.email);
      }),

    updateEmail: protectedProcedure
      .input(z.object({ uid: z.string(), newEmail: z.string().email() }))
      .mutation(async ({ input }) => {
        const { updateUserEmail } = await import('./services/firebase-admin-actions');
        return await updateUserEmail(input.uid, input.newEmail);
      }),

    updatePhone: protectedProcedure
      .input(z.object({ uid: z.string(), newPhone: z.string() }))
      .mutation(async ({ input }) => {
        const { updateUserPhone } = await import('./services/firebase-admin-actions');
        return await updateUserPhone(input.uid, input.newPhone);
      }),

    // Get revenue metrics (MRR, yearly revenue, growth)
    getRevenueMetrics: protectedProcedure.query(async () => {
      try {
        const metrics = await revenueMetrics.getRevenueMetrics();
        return {
          success: true,
          data: metrics,
        };
      } catch (error: any) {
        console.error('[Router] Error fetching revenue metrics:', error);
        return {
          success: false,
          error: error.message,
        };
      }
    }),

    // Get user growth metrics
    getUserGrowthMetrics: protectedProcedure.query(async () => {
      try {
        const metrics = await revenueMetrics.getUserGrowthMetrics();
        return {
          success: true,
          data: metrics,
        };
      } catch (error: any) {
        console.error('[Router] Error fetching user growth metrics:', error);
        return {
          success: false,
          error: error.message,
        };
      }
    }),

    // Get revenue history for charts (last 12 months)
    getRevenueHistory: protectedProcedure.query(async () => {
      try {
        const history = await revenueMetrics.getRevenueHistory();
        return {
          success: true,
          data: history,
        };
      } catch (error: any) {
        console.error('[Router] Error fetching revenue history:', error);
        return {
          success: false,
          error: error.message,
        };
      }
    }),

    // Get user growth history for charts (last 12 months)
    getUserGrowthHistory: protectedProcedure.query(async () => {
      try {
        const history = await revenueMetrics.getUserGrowthHistory();
        return {
          success: true,
          data: history,
        };
      } catch (error: any) {
        console.error('[Router] Error fetching user growth history:', error);
        return {
          success: false,
          error: error.message,
        };
      }
    }),

    // Get dashboard stats from Firebase (REAL DATA)
    getStats: protectedProcedure.query(async () => {
      try {
        const { getOwlFencDashboardStats: getFirebaseStats } = await import('./services/owlfenc-firebase');
        const stats = await getFirebaseStats();
        return {
          success: true,
          data: stats,
        };
      } catch (error: any) {
        console.error('[Router] Error fetching Firebase stats:', error);
        return {
          success: false,
          error: error.message,
        };
      }
    }),

    // Get system-wide usage metrics
    getSystemUsage: protectedProcedure
      .input(z.object({
        startDate: z.string().optional(),
        endDate: z.string().optional(),
      }).optional())
      .query(async ({ input }) => {
      try {
        const { getSystemUsageMetrics } = await import('./services/owlfenc-firebase');
        const metrics = await getSystemUsageMetrics(input?.startDate, input?.endDate);
        return metrics;
      } catch (error: any) {
        console.error('[Router] Error fetching system usage:', error);
        return {
          emailsSentToday: 0,
          pdfsGeneratedToday: 0,
          pdfsGeneratedMonth: 0,
          totalClients: 0,
          totalContracts: 0,
          totalInvoices: 0,
          totalEstimates: 0,
          totalProjects: 0,
          totalPayments: 0,
          totalPermitSearches: 0,
          totalPropertyVerifications: 0,
          totalDualSignatureContracts: 0,
          totalSharedEstimates: 0,
          totalContractModifications: 0,
          emailsSentMonth: 0,
          emailDailyLimit: 500,
          emailUsagePercentage: 0,
        };
      }
    }),

    // Get per-user usage breakdown
    getUserUsageBreakdown: protectedProcedure
      .input(z.object({
        startDate: z.string().optional(),
        endDate: z.string().optional(),
      }).optional())
      .query(async ({ input }) => {
      try {
        const { getUserUsageBreakdown } = await import('./services/owlfenc-firebase');
        const breakdown = await getUserUsageBreakdown(input?.startDate, input?.endDate);
        return breakdown;
      } catch (error: any) {
        console.error('[Router] Error fetching user usage breakdown:', error);
        return [];
      }
    }),

    // ─── AI WALLET MANAGEMENT ────────────────────────────────────────────────

    // Get all users with their current wallet balances (real-time from wallet_accounts)
    getUserWalletBalances: protectedProcedure
      .input(z.object({
        planFilter: z.string().optional(),
      }).optional())
      .query(async ({ input }) => {
        try {
          const { getUserWalletBalances } = await import('./services/owlfenc-wallet');
          const balances = await getUserWalletBalances(input?.planFilter);
          return { success: true, data: balances };
        } catch (error: any) {
          console.error('[Router] Error fetching wallet balances:', error);
          return { success: false, error: error.message, data: [] };
        }
      }),

    // Grant credits to a list of users (admin action — writes directly to wallet_accounts + wallet_transactions)
    grantCreditsToUsers: protectedProcedure
      .input(z.object({
        userIds: z.array(z.number()).min(1, 'Select at least one user'),
        amount: z.number().min(1).max(10000),
        description: z.string().min(3, 'Description is required'),
        adminNote: z.string().optional(),
        expiresAt: z.string().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        try {
          const { grantCreditsToUsers } = await import('./services/owlfenc-wallet');
          const adminEmail = (ctx.user as any)?.email ?? 'unknown-admin';
          const result = await grantCreditsToUsers({
            userIds: input.userIds,
            amount: input.amount,
            description: input.description,
            adminNote: input.adminNote,
            expiresAt: input.expiresAt ? new Date(input.expiresAt) : undefined,
            adminEmail,
          });
          return result;
        } catch (error: any) {
          console.error('[Router] Error granting credits:', error);
          throw new Error(`Failed to grant credits: ${error.message}`);
        }
      }),

    // Get full history of admin grants from wallet_transactions
    getAdminGrantHistory: protectedProcedure
      .input(z.object({
        limit: z.number().optional().default(200),
      }).optional())
      .query(async ({ input }) => {
        try {
          const { getAdminGrantHistory } = await import('./services/owlfenc-wallet');
          const history = await getAdminGrantHistory(input?.limit ?? 200);
          return { success: true, data: history };
        } catch (error: any) {
          console.error('[Router] Error fetching grant history:', error);
          return { success: false, error: error.message, data: [] };
        }
      }),

    // Get wallet stats: total credits in circulation, grants this month, consumption
    getWalletStats: protectedProcedure.query(async () => {
      try {
        const { getWalletStats } = await import('./services/owlfenc-wallet');
        const stats = await getWalletStats();
        return { success: true, data: stats };
      } catch (error: any) {
        console.error('[Router] Error fetching wallet stats:', error);
        return {
          success: false,
          error: error.message,
          data: {
            totalCreditsInCirculation: 0,
            totalAdminGrantsThisMonth: 0,
            totalCreditsConsumedThisMonth: 0,
            usersWithWallet: 0,
            usersWithZeroBalance: 0,
          },
        };
      }
    }),

    // ─── END AI WALLET MANAGEMENT ────────────────────────────────────────────

    // Get Resend email usage stats (direct from Resend API)
    getResendUsage: protectedProcedure.query(async () => {
      try {
        const { getResendUsageStats } = await import('./services/resend-api');
        const stats = await getResendUsageStats();
        return {
          success: true,
          data: stats,
        };
      } catch (error: any) {
        console.error('[Router] Error fetching Resend usage:', error);
        return {
          success: false,
          error: error.message,
          data: {
            emailsSentToday: 0,
            emailsSentThisMonth: 0,
            dailyLimit: 500,
            usagePercentage: 0,
            isNearLimit: false,
            isCritical: false,
          },
        };
      }
    }),
  }),

  // Stripe payment and subscription management
  stripe: router({
    getSubscriptions: protectedProcedure.query(async () => {
      const subscriptions = await stripeService.getSubscriptions();
      return { success: true, data: subscriptions };
    }),
    getPayments: protectedProcedure.query(async () => {
      const payments = await stripeService.getPayments();
      return { success: true, data: payments };
    }),
    getFailedPayments: protectedProcedure.query(async () => {
      const payments = await stripeService.getFailedPayments();
      return { success: true, data: payments };
    }),
    getMRR: protectedProcedure.query(async () => {
      const mrr = await stripeService.calculateMRR();
      return { success: true, data: mrr };
    }),

    // ─── Partner Coupon Management ───────────────────────────────────
    getCoupons: protectedProcedure.query(async () => {
      const coupons = await stripeService.getCoupons();
      return { success: true, data: coupons };
    }),

    createCoupon: protectedProcedure
      .input(z.object({
        name: z.string().min(2, 'Name must be at least 2 characters'),
        percentOff: z.number().min(1).max(100).optional(),
        amountOff: z.number().min(1).optional(),
        currency: z.string().optional(),
        duration: z.enum(['forever', 'once', 'repeating']),
        durationInMonths: z.number().min(1).optional(),
        maxRedemptions: z.number().min(1).optional(),
        redeemBy: z.number().optional(),
        appliesTo: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        const coupon = await stripeService.createCoupon(input);
        return { success: true, data: coupon };
      }),

    deactivateCoupon: protectedProcedure
      .input(z.object({ couponId: z.string() }))
      .mutation(async ({ input }) => {
        const result = await stripeService.deactivateCoupon(input.couponId);
        return { success: result };
      }),
  }),

  // Mass notifications system
  notifications: router({
    sendCampaign: protectedProcedure
      .input(z.object({
        title: z.string(),
        message: z.string(),
        type: z.enum(['announcement', 'event', 'update', 'offer']),
        targetAudience: z.enum(['all', 'free', 'patron', 'master']),
        applicationId: z.number(),
      }))
      .mutation(async ({ input }) => {
        return await createAndSendCampaign(input);
      }),
    
    getCampaigns: protectedProcedure
      .query(async () => {
        return await getCampaignHistory(50);
      }),
    
    // AI-powered message enhancement
    enhanceMessage: protectedProcedure
      .input(z.object({
        message: z.string().min(1, 'Message cannot be empty'),
      }))
      .mutation(async ({ input }) => {
        const { enhanceMessageWithAI } = await import('./services/anthropic-service');
        return await enhanceMessageWithAI(input.message);
      }),
  }),

  // In-app push notifications
  pushNotifications: router({
    // Get all notifications for a user
    getAll: protectedProcedure
      .input(z.object({
        userId: z.string().optional(),
        applicationId: z.number(),
        priority: z.enum(['info', 'warning', 'important', 'critical']).optional(),
        category: z.string().optional(),
        unreadOnly: z.boolean().optional(),
        limit: z.number().default(50),
        offset: z.number().default(0),
      }))
      .query(async ({ input }) => {
        return await pushNotifications.getNotifications(input);
      }),

    // Get unread count
    getUnreadCount: protectedProcedure
      .input(z.object({
        userId: z.string(),
        applicationId: z.number(),
      }))
      .query(async ({ input }) => {
        return await pushNotifications.getUnreadCount(input.userId, input.applicationId);
      }),

    // Mark as read
    markAsRead: protectedProcedure
      .input(z.object({
        notificationId: z.number(),
      }))
      .mutation(async ({ input }) => {
        await pushNotifications.markAsRead(input.notificationId);
        return { success: true };
      }),

    // Mark all as read
    markAllAsRead: protectedProcedure
      .input(z.object({
        userId: z.string(),
        applicationId: z.number(),
      }))
      .mutation(async ({ input }) => {
        await pushNotifications.markAllAsRead(input.userId, input.applicationId);
        return { success: true };
      }),

    // Archive notification
    archive: protectedProcedure
      .input(z.object({
        notificationId: z.number(),
      }))
      .mutation(async ({ input }) => {
        await pushNotifications.archiveNotification(input.notificationId);
        return { success: true };
      }),
  }),

  // ─── PARTNER REFERRAL PORTAL (partners.chyrris.com) ──────────────────────
  // partnerAuth/partnerPortal serve the partner-facing portal; partnerAdmin
  // is the Kai admin management surface for partners.
  partnerAuth: partnerAuthRouter,
  partnerPortal: partnerPortalRouter,
  partnerAdmin: partnerAdminRouter,

  // ─── LEADPRIME CREDIT MANAGEMENT ──────────────────────────────────────────
  leadprime: router({

    // Read-only billing health monitor — surfaces money leaks / double-charges.
    // NEVER moves money; runs only SELECTs against the LeadPrime billing tables.
    billingHealth: protectedProcedure
      .query(async () => {
        try {
          const { getBillingHealth } = await import('./services/leadprime-billing-health');
          const data = await getBillingHealth();
          return { success: true, data };
        } catch (error: any) {
          console.error('[LeadPrime Router] Error fetching billing health:', error);
          return { success: false, error: error.message, data: null };
        }
      }),

    // Read-only infra & cost health — Neon compute consumption, cost-per-user
    // ratio, hot queries, live activity, and worker heartbeats. NEVER mutates
    // anything; only SELECTs system catalogs + GETs the Neon consumption API.
    infraHealth: protectedProcedure
      .query(async () => {
        try {
          const { getInfraHealth } = await import('./services/leadprime-infra-health');
          const data = await getInfraHealth();
          return { success: true, data };
        } catch (error: any) {
          console.error('[LeadPrime Router] Error fetching infra health:', error);
          return { success: false, error: error.message, data: null };
        }
      }),

    serviceSpend: protectedProcedure
      .query(async () => {
        try {
          const { getServiceSpend } = await import('./services/leadprime-service-spend');
          const data = await getServiceSpend();
          return { success: true, data };
        } catch (error: any) {
          console.error('[LeadPrime Router] Error fetching service spend:', error);
          return { success: false, error: error.message, data: null };
        }
      }),

    // Read-only finance P&L — LeadPrime revenue captured by Stripe (filtered by
    // metadata.product='leadprime' in the shared OwlFenc Stripe account), MRR/ARR,
    // Stripe fees, COGS (providers + Neon), free credits (CAC) and gross/operating
    // profit. NEVER moves money; only Stripe reads + SELECTs.
    financeOverview: protectedProcedure
      .query(async () => {
        try {
          const { getFinanceOverview } = await import('./services/leadprime-finance');
          const data = await getFinanceOverview();
          return { success: true, data };
        } catch (error: any) {
          console.error('[LeadPrime Router] Error fetching finance overview:', error);
          return { success: false, error: error.message, data: null };
        }
      }),

    // Read-only finance breakdown — revenue sliced by product/feature
    // (usage_events.cost MTD), by category, and by provider with ROI margin.
    financeBreakdown: protectedProcedure
      .query(async () => {
        try {
          const { getFinanceBreakdown } = await import('./services/leadprime-finance');
          const data = await getFinanceBreakdown();
          return { success: true, data };
        } catch (error: any) {
          console.error('[LeadPrime Router] Error fetching finance breakdown:', error);
          return { success: false, error: error.message, data: null };
        }
      }),

    // Read-only finance by-user — per-contractor LTV/breakeven (revenue vs free
    // credits/CAC) + MRR movements & churn from the local subscriptions lifecycle.
    financeByUser: protectedProcedure
      .query(async () => {
        try {
          const { getFinanceByUser } = await import('./services/leadprime-finance');
          const data = await getFinanceByUser();
          return { success: true, data };
        } catch (error: any) {
          console.error('[LeadPrime Router] Error fetching finance by-user:', error);
          return { success: false, error: error.message, data: null };
        }
      }),

    // Read-only finance forecast — month-end MRR/revenue/profit projection,
    // month-over-month anomaly alerts, and the revenue-at-risk dunning book.
    financeForecast: protectedProcedure
      .query(async () => {
        try {
          const { getFinanceForecast } = await import('./services/leadprime-finance');
          const data = await getFinanceForecast();
          return { success: true, data };
        } catch (error: any) {
          console.error('[LeadPrime Router] Error fetching finance forecast:', error);
          return { success: false, error: error.message, data: null };
        }
      }),

    // Read-only system-health period report — week / month / quarter. Bundles the
    // live health detectors (Neon consumption sliced to the window, cost-per-user,
    // pollers/workers, live activity, hot queries, provider spend, billing leaks)
    // into one exportable (HTML/PDF) snapshot. NEVER mutates anything.
    healthReport: protectedProcedure
      .input(z.object({ range: z.enum(['week', 'month', 'quarter']).default('month') }).optional())
      .query(async ({ input }) => {
        try {
          const { getHealthReport } = await import('./services/leadprime-health-report');
          const data = await getHealthReport(input?.range);
          return { success: true, data };
        } catch (error: any) {
          console.error('[LeadPrime Router] Error fetching health report:', error);
          return { success: false, error: error.message, data: null };
        }
      }),

    // Read-only finance period report — week / month / quarter. Bounds every
    // money query to the chosen window for an exportable (HTML/PDF) snapshot:
    // captured revenue, usage by product & category, free credits (CAC),
    // subscription movements, at-risk book, COGS and full P&L. NEVER moves money.
    financeReport: protectedProcedure
      .input(z.object({ range: z.enum(['week', 'month', 'quarter']).default('month') }).optional())
      .query(async ({ input }) => {
        try {
          const { getFinanceReport } = await import('./services/leadprime-finance-report');
          const data = await getFinanceReport(input?.range);
          return { success: true, data };
        } catch (error: any) {
          console.error('[LeadPrime Router] Error fetching finance report:', error);
          return { success: false, error: error.message, data: null };
        }
      }),

    // Get all LeadPrime users with wallet balances
    getUsers: protectedProcedure
      .input(z.object({
        search: z.string().optional(),
        limit: z.number().optional().default(100),
        offset: z.number().optional().default(0),
      }).optional())
      .query(async ({ input }) => {
        try {
          const { getLeadPrimeUsers } = await import('./services/leadprime-db');
          const result = await getLeadPrimeUsers({
            search: input?.search,
            limit: input?.limit ?? 100,
            offset: input?.offset ?? 0,
          });
          return { success: true, data: result.users, total: result.total };
        } catch (error: any) {
          console.error('[LeadPrime Router] Error fetching users:', error);
          return { success: false, error: error.message, data: [], total: 0 };
        }
      }),

    // Grant credits to a single LeadPrime user
    grantCredits: protectedProcedure
      .input(z.object({
        contractorId: z.string().min(1),
        amountDollars: z.number().min(0.01).max(1200), // raised from 1000 to match $1,200 tier cap (Decisión #5)
        description: z.string().min(3),
        note: z.string().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        try {
          const { grantCreditsToLeadPrimeUser } = await import('./services/leadprime-db');
          const adminEmail = (ctx.user as any)?.email ?? 'admin';
          const amountCents = Math.round(input.amountDollars * 100);
          const result = await grantCreditsToLeadPrimeUser(
            input.contractorId,
            amountCents,
            input.description,
            adminEmail,
            input.note
          );
          return { success: true, newBalanceCents: result.newBalanceCents };
        } catch (error: any) {
          console.error('[LeadPrime Router] Error granting credits:', error);
          throw new Error(`Failed to grant credits: ${error.message}`);
        }
      }),

    // Grant credits to multiple LeadPrime users (batch)
    grantCreditsBatch: protectedProcedure
      .input(z.object({
        contractorIds: z.array(z.string()).min(1).max(500),
        amountDollars: z.number().min(0.01).max(1200), // raised from 1000 to match $1,200 tier cap (Decisión #5)
        description: z.string().min(3),
        note: z.string().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        try {
          const { grantCreditsToLeadPrimeBatch } = await import('./services/leadprime-db');
          const adminEmail = (ctx.user as any)?.email ?? 'admin';
          const amountCents = Math.round(input.amountDollars * 100);
          const result = await grantCreditsToLeadPrimeBatch(
            input.contractorIds,
            amountCents,
            input.description,
            adminEmail,
            input.note
          );
          return { success: true, ...result };
        } catch (error: any) {
          console.error('[LeadPrime Router] Error batch granting credits:', error);
          throw new Error(`Failed to batch grant credits: ${error.message}`);
        }
      }),

    // ── Managed website hosting (per-contractor monthly fee) ──────────────────
    // Read a contractor's hosting config + lifetime amount charged.
    getHosting: protectedProcedure
      .input(z.object({ contractorId: z.string().min(1) }))
      .query(async ({ input }) => {
        try {
          const { getHostingConfig } = await import('./services/leadprime-db');
          return await getHostingConfig(input.contractorId);
        } catch (error: any) {
          console.error('[LeadPrime Router] Error reading hosting config:', error);
          throw new Error(`Failed to read hosting config: ${error.message}`);
        }
      }),

    // Enable/disable hosting and set the monthly price for a contractor. The
    // actual monthly charge runs from LeadPrime's cron — this only saves config.
    setHosting: protectedProcedure
      .input(z.object({
        contractorId: z.string().min(1),
        enabled: z.boolean(),
        monthlyDollars: z.number().min(0).max(1000),
      }))
      .mutation(async ({ input, ctx }) => {
        try {
          const { setHostingConfig } = await import('./services/leadprime-db');
          const adminEmail = (ctx.user as any)?.email ?? 'admin';
          const monthlyCents = Math.round(input.monthlyDollars * 100);
          const config = await setHostingConfig(input.contractorId, input.enabled, monthlyCents, adminEmail);
          return { success: true, config };
        } catch (error: any) {
          console.error('[LeadPrime Router] Error saving hosting config:', error);
          throw new Error(`Failed to save hosting config: ${error.message}`);
        }
      }),

    // Get wallet transaction history
    getTransactions: protectedProcedure
      .input(z.object({
        contractorId: z.string().optional(),
        type: z.string().optional(),
        limit: z.number().optional().default(100),
        offset: z.number().optional().default(0),
      }).optional())
      .query(async ({ input }) => {
        try {
          const { getLeadPrimeTransactions } = await import('./services/leadprime-db');
          const transactions = await getLeadPrimeTransactions({
            contractorId: input?.contractorId,
            type: input?.type,
            limit: input?.limit ?? 100,
            offset: input?.offset ?? 0,
          });
          return { success: true, data: transactions };
        } catch (error: any) {
          console.error('[LeadPrime Router] Error fetching transactions:', error);
          return { success: false, error: error.message, data: [] };
        }
      }),

    // Get admin grant history
    getGrantHistory: protectedProcedure
      .input(z.object({
        limit: z.number().optional().default(100),
      }).optional())
      .query(async ({ input }) => {
        try {
          const { getLeadPrimeAdminGrants } = await import('./services/leadprime-db');
          const grants = await getLeadPrimeAdminGrants({ limit: input?.limit ?? 100 });
          return { success: true, data: grants };
        } catch (error: any) {
          console.error('[LeadPrime Router] Error fetching grant history:', error);
          return { success: false, error: error.message, data: [] };
        }
      }),

    // Get wallet stats
    getStats: protectedProcedure.query(async () => {
      try {
        const { getLeadPrimeWalletStats } = await import('./services/leadprime-db');
        const stats = await getLeadPrimeWalletStats();
        return { success: true, data: stats };
      } catch (error: any) {
        console.error('[LeadPrime Router] Error fetching stats:', error);
        return {
          success: false,
          error: error.message,
          data: {
            totalUsers: 0,
            usersWithWallet: 0,
            totalBalanceCents: 0,
            totalGrantedThisMonth: 0,
            activeSubscribers: 0,
            trialUsers: 0,
          },
        };
      }
    }),

    // ─── SYSTEM ISSUES TELEMETRY ───────────────────────────────────────────

    // Get system issues list with optional filters
    getSystemIssues: protectedProcedure
      .input(z.object({
        status: z.enum(['all', 'new', 'reviewing', 'resolved']).optional().default('all'),
        issue_type: z.enum(['all', 'bug', 'feature_request', 'config_error']).optional().default('all'),
        limit: z.number().optional().default(50),
        offset: z.number().optional().default(0),
      }).optional())
      .query(async ({ input }) => {
        try {
          const { getSystemIssues } = await import('./services/leadprime-db');
          const result = await getSystemIssues({
            status: input?.status ?? 'all',
            issue_type: input?.issue_type ?? 'all',
            limit: input?.limit ?? 50,
            offset: input?.offset ?? 0,
          });
          return { success: true, data: result.issues, total: result.total };
        } catch (error: any) {
          console.error('[LeadPrime Router] Error fetching system issues:', error);
          return { success: false, error: error.message, data: [], total: 0 };
        }
      }),

    // Get system issues stats (counts by status and type)
    getSystemIssueStats: protectedProcedure.query(async () => {
      try {
        const { getSystemIssueStats } = await import('./services/leadprime-db');
        const stats = await getSystemIssueStats();
        return { success: true, data: stats };
      } catch (error: any) {
        console.error('[LeadPrime Router] Error fetching system issue stats:', error);
        return {
          success: false,
          error: error.message,
          data: {
            total: 0,
            byStatus: { new: 0, reviewing: 0, resolved: 0 },
            byType: { bug: 0, feature_request: 0, config_error: 0 },
            topIssues: [],
          },
        };
      }
    }),

    // Update system issue status (new → reviewing → resolved)
    updateSystemIssueStatus: protectedProcedure
      .input(z.object({
        issueId: z.string().uuid(),
        status: z.enum(['new', 'reviewing', 'resolved']),
      }))
      .mutation(async ({ input }) => {
        try {
          const { updateSystemIssueStatus } = await import('./services/leadprime-db');
          const updated = await updateSystemIssueStatus(input.issueId, input.status);
          if (!updated) {
            throw new Error('Issue not found');
          }
          return { success: true, data: updated };
        } catch (error: any) {
          console.error('[LeadPrime Router] Error updating system issue status:', error);
          throw new Error(`Failed to update issue: ${error.message}`);
        }
      }),

    // ─── USERS INTELLIGENCE ──────────────────────────────────────────────────
    getEnrichedUsers: protectedProcedure
      .input(z.object({
        search: z.string().optional(),
        industry: z.string().optional(),
        subscriptionStatus: z.string().optional(),
        minBalance: z.number().optional(),
        maxBalance: z.number().optional(),
        hasLicense: z.boolean().optional(),
        isActive: z.boolean().optional(),
        limit: z.number().optional(),
        offset: z.number().optional(),
        sortBy: z.enum(['created_at','balance','last_activity','total_spent','team_size']).optional(),
        sortDir: z.enum(['asc','desc']).optional(),
      }).optional())
      .query(async ({ input }) => {
        try {
          const { getEnrichedUsers } = await import('./services/leadprime-db');
          const result = await getEnrichedUsers(input ?? {});
          return { success: true, data: result.users, total: result.total };
        } catch (error: any) {
          console.error('[LeadPrime Router] Error fetching enriched users:', error);
          return { success: false, error: error.message, data: [], total: 0 };
        }
      }),

    getUserIntelligenceStats: protectedProcedure.query(async () => {
      try {
        const { getUserIntelligenceStats } = await import('./services/leadprime-db');
        const stats = await getUserIntelligenceStats();
        return { success: true, data: stats };
      } catch (error: any) {
        console.error('[LeadPrime Router] Error fetching user intelligence stats:', error);
        return { success: false, error: error.message, data: null };
      }
    }),

    updateUserContact: protectedProcedure
      .input(z.object({
        contractorId: z.string(),
        name: z.string().optional(),
        email: z.string().email().optional(),
        phone: z.string().optional(),
        industry: z.string().optional(),
        companyName: z.string().optional(),
        businessName: z.string().optional(),
        businessType: z.string().optional(),
        city: z.string().optional(),
        state: z.string().optional(),
        website: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        try {
          const { updateLeadPrimeUserContact } = await import('./services/leadprime-db');
          const { contractorId, ...updates } = input;
          return await updateLeadPrimeUserContact(contractorId, updates);
        } catch (error: any) {
          throw new Error(`Failed to update user: ${error.message}`);
        }
      }),

    deleteUser: protectedProcedure
      .input(z.object({ contractorId: z.string() }))
      .mutation(async ({ input }) => {
        try {
          const { deleteLeadPrimeUser } = await import('./services/leadprime-db');
          return await deleteLeadPrimeUser(input.contractorId);
        } catch (error: any) {
          throw new Error(`Failed to delete user: ${error.message}`);
        }
      }),

    deleteUsers: protectedProcedure
      .input(z.object({ contractorIds: z.array(z.string()).min(1).max(100) }))
      .mutation(async ({ input }) => {
        try {
          const { deleteLeadPrimeUsers } = await import('./services/leadprime-db');
          return await deleteLeadPrimeUsers(input.contractorIds);
        } catch (error: any) {
          throw new Error(`Failed to batch delete users: ${error.message}`);
        }
      }),

    // ── Subscription config (Fases 3-4 — Kai→config→worker pattern) ────────────
    // Kai NEVER moves money or tier. It only writes INTENT to
    // contractor_subscription_config; the LeadPrime worker executes every 5 min.

    // Read a contractor's subscription state + billing history.
    getSubscriptionConfig: protectedProcedure
      .input(z.object({ contractorId: z.string().min(1) }))
      .query(async ({ input }) => {
        try {
          const { getSubscriptionConfig } = await import('./services/leadprime-db');
          return await getSubscriptionConfig(input.contractorId);
        } catch (error: any) {
          console.error('[LeadPrime Router] Error reading subscription config:', error);
          throw new Error(`Failed to read subscription config: ${error.message}`);
        }
      }),

    // Write subscription intent (UPSERT → status='pending'). Worker executes.
    // NEVER writes status='applied', applied_at, checkout_url, or
    // contract_end_processed_at (all worker-owned fields).
    setSubscriptionConfig: protectedProcedure
      .input(z.object({
        contractorId: z.string().min(1),
        targetTier: z.enum(['network_elite', 'chyrris_growth', 'chyrris_legacy']),
        billingMode: z.enum(['stripe_ach', 'comp_no_charge']),
        monthlyCreditsCents: z.number().int().min(0).max(120000).nullable(), // tope $1,200 (Decisión #5)
        enableLegacyProjects: z.boolean(),
        contractEndAt: z.string().nullable(), // ISO date string or null
        onContractEnd: z.enum(['downgrade_to_elite', 'cancel']).default('downgrade_to_elite'),
      }))
      .mutation(async ({ input, ctx }) => {
        try {
          const { setSubscriptionConfig } = await import('./services/leadprime-db');
          const updatedBy = (ctx.user as any)?.email ?? 'admin';
          const result = await setSubscriptionConfig({ ...input, updatedBy });
          return { success: true, config: result };
        } catch (error: any) {
          console.error('[LeadPrime Router] Error saving subscription config:', error);
          throw new Error(`Failed to save subscription config: ${error.message}`);
        }
      }),

    // Read the last 50 tier change log entries for a contractor (audit trail).
    getTierChangeLog: protectedProcedure
      .input(z.object({ contractorId: z.string().min(1) }))
      .query(async ({ input }) => {
        try {
          const { getTierChangeLog } = await import('./services/leadprime-db');
          const log = await getTierChangeLog(input.contractorId);
          return { success: true, data: log };
        } catch (error: any) {
          console.error('[LeadPrime Router] Error reading tier change log:', error);
          return { success: false, error: error.message, data: [] };
        }
      }),

    // ─── Portales /join — suscripciones pendientes de vinculación ────────────
    getPendingSubscriptions: protectedProcedure
      .input(z.object({
        status: z.enum(['paid', 'linked', 'failed', 'all']).optional().default('paid'),
        limit: z.number().int().min(1).max(200).optional().default(100),
        offset: z.number().int().min(0).optional().default(0),
      }))
      .query(async ({ input }) => {
        try {
          const { getPendingSubscriptions } = await import('./services/leadprime-db');
          const statusFilter = input.status === 'all' ? undefined : input.status;
          const result = await getPendingSubscriptions({
            status: statusFilter,
            limit: input.limit,
            offset: input.offset,
          });
          return { success: true, data: result.rows, total: result.total };
        } catch (error: any) {
          console.error('[LeadPrime Router] Error fetching pending subscriptions:', error);
          return { success: false, error: error.message, data: [], total: 0 };
        }
      }),

    linkPendingSubscription: protectedProcedure
      .input(z.object({
        pendingId: z.number().int().positive(),
        contractorId: z.string().min(1),
        staff: z.object({
          phone: z.string().min(1),
          email: z.string().email().optional(),
          name: z.string().optional(),
        }).nullable().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        try {
          const actor = (ctx as any)?.user?.email ?? (ctx as any)?.user?.id ?? 'kai_admin';
          const { linkPendingSubscriptionViaApi } = await import('./services/leadprime-db');
          const result = await linkPendingSubscriptionViaApi({
            pendingId: input.pendingId,
            contractorId: input.contractorId,
            actor: `kai:${actor}`,
            staff: input.staff ?? null,
          });
          return { success: true, ...result };
        } catch (error: any) {
          console.error('[LeadPrime Router] Error linking pending subscription:', error);
          return { success: false, error: error.message, linked: false, tier: '', creditsGrantedCents: 0, staffAdded: false };
        }
      }),

    // Crear cuenta completa de LeadPrime desde Kai (servicio Growth/Legacy).
    createContractor: protectedProcedure
      .input(z.object({
        name: z.string().min(1),
        businessName: z.string().optional(),
        email: z.string().email(),
        phone: z.string().min(10),
        industry: z.string().optional(),
        subCategory: z.string().optional(),
        staff: z.object({
          phone: z.string().min(1),
          email: z.string().email().optional(),
          name: z.string().optional(),
        }).nullable().optional(),
        allowAdditionalBusiness: z.boolean().optional().default(false),
      }))
      .mutation(async ({ input, ctx }) => {
        try {
          const actor = (ctx as any)?.user?.email ?? (ctx as any)?.user?.id ?? 'kai_admin';
          const { createContractorViaApi } = await import('./services/leadprime-db');
          const result = await createContractorViaApi({
            ...input,
            actor: `kai:${actor}`,
          });
          return { success: true, ...result };
        } catch (error: any) {
          console.error('[LeadPrime Router] Error creating contractor:', error);
          return {
            success: false,
            error: error.message,
            // 409 del API interno: el teléfono ya tiene cuenta(s) — la UI
            // ofrece usarla(s) o crear un negocio adicional.
            accountExists: error.details?.accountExists ?? false,
            emailTaken: error.details?.emailTaken ?? false,
            existingBusinesses: (error.details?.existingBusinesses ?? []) as Array<{ id: string; name: string }>,
          };
        }
      }),

    // Agregar staff Chyrris (sin cargo de asiento) a una cuenta existente.
    addStaff: protectedProcedure
      .input(z.object({
        contractorId: z.string().min(1),
        staff: z.object({
          phone: z.string().min(1),
          email: z.string().email().optional(),
          name: z.string().optional(),
        }),
      }))
      .mutation(async ({ input, ctx }) => {
        try {
          const actor = (ctx as any)?.user?.email ?? (ctx as any)?.user?.id ?? 'kai_admin';
          const { addStaffViaApi } = await import('./services/leadprime-db');
          const result = await addStaffViaApi({
            contractorId: input.contractorId,
            staff: input.staff,
            actor: `kai:${actor}`,
          });
          return { success: true, ...result };
        } catch (error: any) {
          console.error('[LeadPrime Router] Error adding staff:', error);
          return { success: false, error: error.message, staffAdded: false, staffPhone: '' };
        }
      }),

    // ─── Approved Clients Portal ────────────────────────────────────────────
    listApprovedClients: protectedProcedure
      .input(z.object({
        status: z.string().optional(),
        plan: z.string().optional(),
        limit: z.number().optional(),
        offset: z.number().optional(),
      }).optional())
      .query(async ({ input }) => {
        try {
          const { listApprovedClientsViaApi } = await import('./services/leadprime-db');
          const clients = await listApprovedClientsViaApi(input ?? {});
          return { success: true, clients };
        } catch (error: any) {
          return { success: false, error: error.message, clients: [] };
        }
      }),

    createApprovedClient: protectedProcedure
      .input(z.object({
        contactName: z.string().min(1),
        companyName: z.string().min(1),
        email: z.string().email(),
        phone: z.string().optional(),
        plan: z.enum(['chyrris_growth', 'chyrris_legacy']),
        monthlyPriceCents: z.number().optional(),
        commitmentMonths: z.number().optional(),
        specialConditions: z.string().optional(),
        agreedGoals: z.string().optional(),
        notes: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        try {
          const { createApprovedClientViaApi } = await import('./services/leadprime-db');
          const client = await createApprovedClientViaApi(input);
          return { success: true, client };
        } catch (error: any) {
          return { success: false, error: error.message, client: null };
        }
      }),

    getApprovedClient: protectedProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ input }) => {
        try {
          const { getApprovedClientViaApi } = await import('./services/leadprime-db');
          const data = await getApprovedClientViaApi(input.id);
          return { success: true, ...data };
        } catch (error: any) {
          return { success: false, error: error.message };
        }
      }),

    regenerateApprovedClientToken: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        try {
          const { regenerateApprovedClientTokenViaApi } = await import('./services/leadprime-db');
          const result = await regenerateApprovedClientTokenViaApi(input.id);
          return { success: true, ...result };
        } catch (error: any) {
          return { success: false, error: error.message };
        }
      }),

  }),

  // ─── END LEADPRIME CREDIT MANAGEMENT ─────────────────────────────
});

export type AppRouter = typeof appRouter;
