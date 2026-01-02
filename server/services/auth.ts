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
    const db = await getDb();
    if (!db) {
      return { success: false, error: 'Database not available' };
    }

    // Generate OTP
    const code = generateOTP();
    const expiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000);

    // Store OTP in database
    const otpData: InsertOtpCode = {
      email,
      code,
      expiresAt,
      used: false,
    };

    await db.insert(otpCodes).values(otpData);

    // Send email via Resend
    if (!resend) {
      console.error('[Auth] Resend not initialized - check RESEND_API_KEY');
      return { success: false, error: 'Email service not configured' };
    }

    console.log(`[Auth] Sending OTP to ${email}, code: ${code}`);

    try{
      await resend.emails.send({
        from: 'Chyrris KAI <onboarding@resend.dev>',
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
      console.error('[Auth] Error details:', emailError.message);
      console.error('[Auth] Full error:', emailError);
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
    const db = await getDb();
    if (!db) {
      return { success: false, error: 'Database not available' };
    }

    // Find valid OTP
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

    if (validOTPs.length === 0) {
      return { success: false, error: 'Invalid or expired code' };
    }

    const otp = validOTPs[0];

    // Mark OTP as used
    await db.update(otpCodes).set({ used: true }).where(eq(otpCodes.id, otp!.id));

    // Get or create admin user
    let adminUser = await db.select().from(adminUsers).where(eq(adminUsers.email, email)).limit(1);

    if (adminUser.length === 0) {
      // Create new admin user
      await db.insert(adminUsers).values({
        email,
        role: 'admin',
        isActive: true,
        lastLoginAt: new Date(),
      });

      adminUser = await db.select().from(adminUsers).where(eq(adminUsers.email, email)).limit(1);
    } else {
      // Update last login
      await db.update(adminUsers).set({ lastLoginAt: new Date() }).where(eq(adminUsers.email, email));
    }

    if (adminUser.length === 0) {
      return { success: false, error: 'Failed to create user' };
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
    const db = await getDb();
    if (!db) {
      return null;
    }

    // Find valid session
    const sessions = await db
      .select()
      .from(adminSessions)
      .where(and(eq(adminSessions.id, sessionId), gt(adminSessions.expiresAt, sql`NOW()`)))
      .limit(1);

    if (sessions.length === 0) {
      return null;
    }

    const session = sessions[0];

    // Get admin user
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
 * Clean up expired OTPs and sessions
 */
export async function cleanupExpired(): Promise<void> {
  try {
    const db = await getDb();
    if (!db) {
      return;
    }

    const now = new Date();

    // Delete expired OTPs (where expires_at < now)
    await db.delete(otpCodes).where(sql`${otpCodes.expiresAt} < NOW()`);

    // Delete expired sessions (where expires_at < now)
    await db.delete(adminSessions).where(sql`${adminSessions.expiresAt} < NOW()`);

    console.log('[Auth] Cleanup completed');
  } catch (error) {
    console.error('[Auth] Error in cleanup:', error);
  }
}

// Run cleanup every hour
setInterval(cleanupExpired, 60 * 60 * 1000);
