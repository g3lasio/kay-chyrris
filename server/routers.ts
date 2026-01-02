import { z } from "zod";
import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, protectedProcedure, router } from "./_core/trpc";
import { sendOTP, verifyOTP, validateSession, invalidateSession } from "./services/auth";

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

  // Protected routes require authentication
  dashboard: router({
    // Get overview metrics
    overview: protectedProcedure.query(async ({ ctx }) => {
      // TODO: Implement dashboard overview
      return {
        totalApplications: 2,
        totalUsers: 0,
        activeAlerts: 0,
      };
    }),
  }),
});

export type AppRouter = typeof appRouter;
