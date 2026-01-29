import { z } from "zod";
import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, protectedProcedure, router } from "./_core/trpc";
import { sendOTP, verifyOTP, validateSession, invalidateSession } from "./services/auth";
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

export const appRouter = router({
  system: systemRouter,
  
  auth: router({
    // Send OTP to email
    sendOTP: publicProcedure
      .input(z.object({ email: z.string().email() }))
      .mutation(async ({ input }) => {
        const result = await sendOTP(input.email);
        return result;
      }),

    // Verify OTP and create session
    verifyOTP: publicProcedure
      .input(
        z.object({
          email: z.string().email(),
          code: z.string().length(6),
        })
      )
      .mutation(async ({ input, ctx }) => {
        const ipAddress = ctx.req.ip || ctx.req.socket.remoteAddress;
        const userAgent = ctx.req.headers['user-agent'];

        const result = await verifyOTP(input.email, input.code, ipAddress, userAgent);

        if (result.success && result.sessionId) {
          // Set session cookie
          const cookieOptions = getSessionCookieOptions(ctx.req);
          ctx.res.cookie(COOKIE_NAME, result.sessionId, cookieOptions);
        }

        return result;
      }),

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

    // Create notification (admin/system)
    create: protectedProcedure
      .input(z.object({
        applicationId: z.number(),
        userId: z.string().optional().nullable(),
        title: z.string(),
        message: z.string(),
        priority: z.enum(['info', 'warning', 'important', 'critical']),
        category: z.string().optional(),
        actionUrl: z.string().optional(),
        actionLabel: z.string().optional(),
        icon: z.string().optional(),
        expiresAt: z.date().optional(),
        metadata: z.record(z.string(), z.any()).optional(),
      }))
      .mutation(async ({ input }) => {
        const notification = await pushNotifications.createNotification(input);
        return { success: true, notification };
      }),

    // Get user preferences
    getPreferences: protectedProcedure
      .input(z.object({
        userId: z.string(),
        applicationId: z.number(),
      }))
      .query(async ({ input }) => {
        return await pushNotifications.getUserPreferences(input.userId, input.applicationId);
      }),

    // Update user preferences
    updatePreferences: protectedProcedure
      .input(z.object({
        userId: z.string(),
        applicationId: z.number(),
        enabled: z.boolean().optional(),
        minPriority: z.enum(['info', 'warning', 'important', 'critical']).optional(),
        categoriesEnabled: z.array(z.string()).optional(),
        quietHoursStart: z.string().optional(),
        quietHoursEnd: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        const { userId, applicationId, ...updates } = input;
        await pushNotifications.updateUserPreferences(userId, applicationId, updates);
        return { success: true };
      }),
  }),
});

export type AppRouter = typeof appRouter;
