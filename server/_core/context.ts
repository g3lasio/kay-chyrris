import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import type { User } from "../../drizzle/schema";
import { COOKIE_NAME } from "@shared/const";
import { validateSession } from "../services/auth";

export type TrpcContext = {
  req: CreateExpressContextOptions["req"];
  res: CreateExpressContextOptions["res"];
  user: User | null;
};

export async function createContext(
  opts: CreateExpressContextOptions
): Promise<TrpcContext> {
  // Get session from cookie
  const sessionId = opts.req.cookies[COOKIE_NAME];
  let user: User | null = null;

  if (sessionId) {
    user = await validateSession(sessionId);
  }

  return {
    req: opts.req,
    res: opts.res,
    user,
  };
}
