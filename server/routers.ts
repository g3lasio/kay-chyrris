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
    // Get users list
    getUsers: protectedProcedure
      .input(
        z.object({
          limit: z.number().min(1).max(100).default(50),
          offset: z.number().min(0).default(0),
          search: z.string().optional(),
        })
      )
      .query(async ({ input }) => {
        try {
          const users = await getOwlFencUsers(input);
          const total = await getOwlFencUserCount(input.search);
          
          return {
            success: true,
            data: {
              users,
              total,
              limit: input.limit,
              offset: input.offset,
            },
          };
        } catch (error: any) {
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

    // Get dashboard stats
    getStats: protectedProcedure.query(async () => {
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
  }),
});

export type AppRouter = typeof appRouter;
