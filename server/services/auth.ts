/**
 * Authentication Service
 * Handles OTP generation, validation, and session management
 */

import { eq, and, gt, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { getDb } from '../db';
import { otpCodes, adminSessions, adminUsers, type InsertOtpCode, type InsertAdminSession } from '../../drizzle/schema';
import { resend } from './config';

// OTP Configuration
const OTP_LENGTH = 6;
const OTP_EXPIRY_MINUTES = 10;
const SESSION_EXPIRY_DAYS = 7;

// In-memory OTP store as a fallback for database failures (e.g., SSL issues)
interface MemoryOTP {
  code: string;
  expiresAt: number;
}
const memoryOtpStore = new Map<string, MemoryOTP>();

// In-memory Session store as a fallback
interface MemorySession {
  adminUserId: number;
  expiresAt: number;
  email: string;
}
const memorySessionStore = new Map<string, MemorySession>();

/**
 * Generate a random 6-digit OTP code
 */
function generateOTP(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

/**
 * Send OTP code via email
 */
export async function sendOTP(email: string): Promise<{ success: boolean; error?: string }> {
  try {
    // Generate OTP
    const code = generateOTP();
    const expiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000);

    // Store OTP in memory first (as a reliable fallback)
    memoryOtpStore.set(email, {
      code,
      expiresAt: expiresAt.getTime(),
    });

    // Try to store OTP in database, but don't fail if it fails
    try {
      const db = await getDb();
      if (db) {
        const otpData: InsertOtpCode = {
          email,
          code,
          expiresAt,
          used: false,
        };
        await db.insert(otpCodes).values(otpData);
        console.log(`[Auth] OTP stored in database for ${email}`);
      }
    } catch (dbError) {
      console.warn(`[Auth] Database storage failed for OTP, using memory fallback:`, dbError);
    }

    // Send email via Resend
    if (!resend) {
      console.error('[Auth] Resend not initialized - check RESEND_API_KEY');
      return { success: false, error: 'Email service not configured' };
    }

    console.log(`[Auth] Sending OTP to ${email}, code: ${code}`);

    try {
      await resend.emails.send({
        from: 'Chyrris KAI <mervin@owlfenc.com>',
        to: email,
        subject: 'Your Chyrris KAI Login Code',
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #333;">Chyrris KAI Login</h2>
            <p style="font-size: 16px; color: #666;">Your one-time password is:</p>
            <div style="background: #f5f5f5; padding: 20px; text-align: center; border-radius: 8px; margin: 20px 0;">
              <span style="font-size: 32px; font-weight: bold; letter-spacing: 8px; color: #333;">${code}</span>
            </div>
            <p style="font-size: 14px; color: #999;">This code will expire in ${OTP_EXPIRY_MINUTES} minutes.</p>
            <p style="font-size: 14px; color: #999;">If you didn't request this code, please ignore this email.</p>
          </div>
        `,
      });

      console.log(`[Auth] OTP email sent successfully to ${email}`);
      return { success: true };
    } catch (emailError: any) {
      console.error('[Auth] Failed to send OTP email to', email);
      return { success: false, error: `Failed to send email: ${emailError.message}` };
    }
  } catch (error: any) {
    console.error('[Auth] Error in sendOTP:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Verify OTP code and create session
 */
export async function verifyOTP(
  email: string,
  code: string,
  ipAddress?: string,
  userAgent?: string
): Promise<{ success: boolean; sessionId?: string; error?: string }> {
  try {
    let isValid = false;

    // 1. Check memory store first (reliable fallback)
    const memOtp = memoryOtpStore.get(email);
    if (memOtp && memOtp.code === code && memOtp.expiresAt > Date.now()) {
      isValid = true;
      memoryOtpStore.delete(email); // Use once
      console.log(`[Auth] OTP verified via memory for ${email}`);
    }

    // 2. If not in memory, check database
    if (!isValid) {
      try {
        const db = await getDb();
        if (db) {
          const validOTPs = await db
            .select()
            .from(otpCodes)
            .where(
              and(
                eq(otpCodes.email, email),
                eq(otpCodes.code, code),
                eq(otpCodes.used, false),
                gt(otpCodes.expiresAt, sql`NOW()`)
              )
            )
            .limit(1);

          if (validOTPs.length > 0) {
            isValid = true;
            const otp = validOTPs[0];
            await db.update(otpCodes).set({ used: true }).where(eq(otpCodes.id, otp!.id));
            console.log(`[Auth] OTP verified via database for ${email}`);
          }
        }
      } catch (dbError) {
        console.warn(`[Auth] Database verification failed for OTP:`, dbError);
      }
    }

    if (!isValid) {
      return { success: false, error: 'Invalid or expired code' };
    }

    // Get or create admin user
    let adminUserId: number | null = null;
    try {
      const db = await getDb();
      if (db) {
        let adminUser = await db.select().from(adminUsers).where(eq(adminUsers.email, email)).limit(1);

        if (adminUser.length === 0) {
          await db.insert(adminUsers).values({
            email,
            role: 'admin',
            isActive: true,
            lastLoginAt: new Date(),
          });
          adminUser = await db.select().from(adminUsers).where(eq(adminUsers.email, email)).limit(1);
        } else {
          await db.update(adminUsers).set({ lastLoginAt: new Date() }).where(eq(adminUsers.email, email));
        }
        
        if (adminUser.length > 0) {
          adminUserId = adminUser[0]!.id;
        }
      }
    } catch (dbError) {
      console.warn(`[Auth] Database user management failed, using memory session:`, dbError);
    }

    // Create session
    const sessionId = nanoid(32);
    const expiresAt = new Date(Date.now() + SESSION_EXPIRY_DAYS * 24 * 60 * 60 * 1000);

    // Store in memory session store (fallback)
    memorySessionStore.set(sessionId, {
      adminUserId: adminUserId || 0, // 0 if DB failed
      email,
      expiresAt: expiresAt.getTime(),
    });

    // Try to store in database
    if (adminUserId) {
      try {
        const db = await getDb();
        if (db) {
          const sessionData: InsertAdminSession = {
            id: sessionId,
            adminUserId: adminUserId,
            ipAddress,
            userAgent,
            expiresAt,
          };
          await db.insert(adminSessions).values(sessionData);
        }
      } catch (dbError) {
        console.warn(`[Auth] Database session storage failed:`, dbError);
      }
    }

    return { success: true, sessionId };
  } catch (error: any) {
    console.error('[Auth] Error in verifyOTP:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Validate session and get admin user
 */
export async function validateSession(sessionId: string) {
  try {
    // 1. Check memory session store first
    const memSession = memorySessionStore.get(sessionId);
    if (memSession && memSession.expiresAt > Date.now()) {
      // If we have a real user ID, try to get user from DB
      if (memSession.adminUserId > 0) {
        try {
          const db = await getDb();
          if (db) {
            const users = await db.select().from(adminUsers).where(eq(adminUsers.id, memSession.adminUserId)).limit(1);
            if (users.length > 0 && users[0]!.isActive) {
              return users[0];
            }
          }
        } catch (dbError) {
          console.warn(`[Auth] Database user lookup failed for session:`, dbError);
        }
      }
      
      // Fallback: return a mock user object based on memory session
      return {
        id: memSession.adminUserId,
        email: memSession.email,
        role: 'admin',
        isActive: true,
        name: memSession.email.split('@')[0],
      };
    }

    // 2. Check database session store
    try {
      const db = await getDb();
      if (db) {
        const sessions = await db
          .select()
          .from(adminSessions)
          .where(and(eq(adminSessions.id, sessionId), gt(adminSessions.expiresAt, sql`NOW()`)))
          .limit(1);

        if (sessions.length > 0) {
          const session = sessions[0];
          const users = await db.select().from(adminUsers).where(eq(adminUsers.id, session!.adminUserId)).limit(1);
          if (users.length > 0 && users[0]!.isActive) {
            return users[0];
          }
        }
      }
    } catch (dbError) {
      console.warn(`[Auth] Database session validation failed:`, dbError);
    }

    return null;
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
    memorySessionStore.delete(sessionId);
    
    try {
      const db = await getDb();
      if (db) {
        await db.delete(adminSessions).where(eq(adminSessions.id, sessionId));
      }
    } catch (dbError) {
      console.warn(`[Auth] Database session invalidation failed:`, dbError);
    }
    
    return true;
  } catch (error) {
    console.error('[Auth] Error in invalidateSession:', error);
    return false;
  }
}

/**
 * Clean up expired OTPs and sessions
 */
export async function cleanupExpired(): Promise<void> {
  try {
    const now = Date.now();
    
    // Cleanup memory stores
    for (const [email, otp] of memoryOtpStore.entries()) {
      if (otp.expiresAt < now) memoryOtpStore.delete(email);
    }
    for (const [sid, session] of memorySessionStore.entries()) {
      if (session.expiresAt < now) memorySessionStore.delete(sid);
    }

    // Cleanup database
    try {
      const db = await getDb();
      if (db) {
        await db.delete(otpCodes).where(sql`${otpCodes.expiresAt} < NOW()`);
        await db.delete(adminSessions).where(sql`${adminSessions.expiresAt} < NOW()`);
      }
    } catch (dbError) {
      console.warn(`[Auth] Database cleanup failed:`, dbError);
    }

    console.log('[Auth] Cleanup completed');
  } catch (error) {
    console.error('[Auth] Error in cleanup:', error);
  }
}

// Run cleanup every hour
setInterval(cleanupExpired, 60 * 60 * 1000);
