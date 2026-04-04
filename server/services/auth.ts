/**
 * Authentication Service
 * Passcode-based authentication (replaces OTP email)
 * Set ADMIN_PASSCODE env variable to configure the passcode
 */
import { eq, and, gt, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { getDb } from '../db';
import { adminSessions, adminUsers, type InsertAdminSession } from '../../drizzle/schema';

const SESSION_EXPIRY_DAYS = 7;

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

    if (passcode !== adminPasscode) {
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
    const db = await getDb();
    if (!db) {
      return null;
    }

    const sessions = await db
      .select()
      .from(adminSessions)
      .where(and(eq(adminSessions.id, sessionId), gt(adminSessions.expiresAt, sql`NOW()`)))
      .limit(1);

    if (sessions.length === 0) {
      return null;
    }

    const session = sessions[0];
    const users = await db.select().from(adminUsers).where(eq(adminUsers.id, session!.adminUserId)).limit(1);

    if (users.length === 0 || !users[0]!.isActive) {
      return null;
    }

    return users[0];
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
