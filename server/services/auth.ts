/**
 * Authentication Service
 * Passcode-based authentication (replaces OTP email)
 * Set ADMIN_PASSCODE env variable to configure the passcode
 */
import { timingSafeEqual } from 'node:crypto';
import { eq, and, gt, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { getDb } from '../db';
import { adminSessions, adminUsers, type InsertAdminSession } from '../../drizzle/schema';

const SESSION_EXPIRY_DAYS = 7;

// validateSession runs on EVERY tRPC request; without this cache each request
// costs two extra DB roundtrips, which is what made the whole panel (and the
// login redirect) feel sluggish. Entries are short-lived and dropped on logout.
const SESSION_CACHE_TTL_MS = 60_000;
const sessionCache = new Map<string, { user: typeof adminUsers.$inferSelect; expires: number }>();

function passcodeMatches(input: string, expected: string): boolean {
  const a = Buffer.from(input);
  const b = Buffer.from(expected);
  // timingSafeEqual requires equal lengths; comparing against itself keeps
  // constant time while still failing the overall check.
  if (a.length !== b.length) {
    timingSafeEqual(b, b);
    return false;
  }
  return timingSafeEqual(a, b);
}

/**
 * Verify passcode and create session
 */
export async function verifyPasscode(
  passcode: string,
  ipAddress?: string,
  userAgent?: string
): Promise<{ success: boolean; sessionId?: string; error?: string }> {
  try {
    const adminPasscode = process.env.ADMIN_PASSCODE;

    if (!adminPasscode) {
      console.error('[Auth] ADMIN_PASSCODE environment variable is not set');
      return { success: false, error: 'Server configuration error' };
    }

    if (!passcodeMatches(passcode, adminPasscode)) {
      console.log('[Auth] Invalid passcode attempt');
      return { success: false, error: 'Invalid passcode' };
    }

    const db = await getDb();
    if (!db) {
      return { success: false, error: 'Database not available' };
    }

    // Get or create the default admin user
    const ADMIN_EMAIL = 'admin@chyrris.com';
    let adminUser = await db.select().from(adminUsers).where(eq(adminUsers.email, ADMIN_EMAIL)).limit(1);

    if (adminUser.length === 0) {
      await db.insert(adminUsers).values({
        email: ADMIN_EMAIL,
        role: 'admin',
        isActive: true,
        lastLoginAt: new Date(),
      });
      adminUser = await db.select().from(adminUsers).where(eq(adminUsers.email, ADMIN_EMAIL)).limit(1);
    } else {
      await db.update(adminUsers).set({ lastLoginAt: new Date() }).where(eq(adminUsers.email, ADMIN_EMAIL));
    }

    if (adminUser.length === 0) {
      return { success: false, error: 'Failed to create admin user' };
    }

    // Create session
    const sessionId = nanoid(32);
    const expiresAt = new Date(Date.now() + SESSION_EXPIRY_DAYS * 24 * 60 * 60 * 1000);

    const sessionData: InsertAdminSession = {
      id: sessionId,
      adminUserId: adminUser[0]!.id,
      ipAddress,
      userAgent,
      expiresAt,
    };

    await db.insert(adminSessions).values(sessionData);
    console.log('[Auth] Passcode login successful, session created');
    return { success: true, sessionId };
  } catch (error: any) {
    console.error('[Auth] Error in verifyPasscode:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Validate session and get admin user
 */
export async function validateSession(sessionId: string) {
  try {
    const cached = sessionCache.get(sessionId);
    if (cached && cached.expires > Date.now()) {
      return cached.user;
    }

    const db = await getDb();
    if (!db) {
      return null;
    }

    // Single roundtrip: session validity + user in one JOIN.
    const rows = await db
      .select({ user: adminUsers })
      .from(adminSessions)
      .innerJoin(adminUsers, eq(adminUsers.id, adminSessions.adminUserId))
      .where(and(eq(adminSessions.id, sessionId), gt(adminSessions.expiresAt, sql`NOW()`)))
      .limit(1);

    const user = rows[0]?.user;
    if (!user || !user.isActive) {
      sessionCache.delete(sessionId);
      return null;
    }

    sessionCache.set(sessionId, { user, expires: Date.now() + SESSION_CACHE_TTL_MS });
    return user;
  } catch (error) {
    console.error('[Auth] Error in validateSession:', error);
    return null;
  }
}

/**
 * Invalidate session (logout)
 */
export async function invalidateSession(sessionId: string): Promise<boolean> {
  try {
    sessionCache.delete(sessionId);
    const db = await getDb();
    if (!db) {
      return false;
    }
    await db.delete(adminSessions).where(eq(adminSessions.id, sessionId));
    return true;
  } catch (error) {
    console.error('[Auth] Error in invalidateSession:', error);
    return false;
  }
}

/**
 * Clean up expired sessions
 */
export async function cleanupExpired(): Promise<void> {
  try {
    const db = await getDb();
    if (!db) {
      return;
    }
    await db.delete(adminSessions).where(sql`${adminSessions.expiresAt} < NOW()`);
    console.log('[Auth] Session cleanup completed');
  } catch (error) {
    console.error('[Auth] Error in cleanup:', error);
  }
}

// Run cleanup every hour
setInterval(cleanupExpired, 60 * 60 * 1000);

// Backward-compatible stubs (prevent import errors from old references)
export async function sendOTP(_email: string) {
  return { success: false, error: 'OTP login is disabled. Use passcode login.' };
}

export async function verifyOTP(_email: string, _code: string) {
  return { success: false, error: 'OTP login is disabled. Use passcode login.' };
}
