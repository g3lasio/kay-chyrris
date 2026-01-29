import { NOT_ADMIN_ERR_MSG, UNAUTHED_ERR_MSG } from '@shared/const';
import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import type { TrpcContext } from "./context";

// ⚠️ TEMPORARY AUTH BYPASS - ALWAYS ENABLED
// To re-enable authentication, change this to false
const AUTH_BYPASS_ENABLED = true; // Set to false to require login

if (AUTH_BYPASS_ENABLED) {
  console.warn('🚨 ========================================');
  console.warn('🚨 AUTH BYPASS IS ENABLED ON SERVER!');
  console.warn('🚨 This should ONLY be used in development!');
  console.warn('🚨 ========================================');
}

const t = initTRPC.context<TrpcContext>().create({
  transformer: superjson,
});

export const router = t.router;
export const publicProcedure = t.procedure;

const requireUser = t.middleware(async opts => {
  const { ctx, next } = opts;

  // 🚨 AUTH BYPASS: Skip authentication if enabled
  if (AUTH_BYPASS_ENABLED) {
    // Create a mock admin user for bypass mode
    const mockUser = {
      id: 1,
      email: 'dev@bypass.local',
      name: 'Dev User (Bypass Mode)',
      role: 'super_admin' as const,
      isActive: true,
      lastLoginAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    return next({
      ctx: {
        ...ctx,
        user: mockUser,
      },
    });
  }

  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: UNAUTHED_ERR_MSG });
  }

  return next({
    ctx: {
      ...ctx,
      user: ctx.user,
    },
  });
});

export const protectedProcedure = t.procedure.use(requireUser);

export const adminProcedure = t.procedure.use(
  t.middleware(async opts => {
    const { ctx, next } = opts;

    if (!ctx.user || ctx.user.role !== 'admin') {
      throw new TRPCError({ code: "FORBIDDEN", message: NOT_ADMIN_ERR_MSG });
    }

    return next({
      ctx: {
        ...ctx,
        user: ctx.user,
      },
    });
  }),
);
