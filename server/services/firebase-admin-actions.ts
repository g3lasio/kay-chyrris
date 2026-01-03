/**
 * FIREBASE ADMIN USER MANAGEMENT ACTIONS
 * 
 * Provides admin actions for managing Firebase Authentication users:
 * - Disable/Enable user accounts
 * - Delete user accounts
 * - Reset password (send email)
 * - Update email
 * - Update phone
 */

import admin from 'firebase-admin';
import { initializeFirebase } from './firebase';

function getFirebaseAdmin() {
  try {
    initializeFirebase();
    return admin;
  } catch (error) {
    console.error('[Firebase Admin Actions] Firebase not initialized:', error);
    return null;
  }
}

export interface UserActionResult {
  success: boolean;
  message: string;
  error?: string;
}

/**
 * Disable a user account (temporary suspension)
 */
export async function disableUser(uid: string): Promise<UserActionResult> {
  const admin = getFirebaseAdmin();
  if (!admin) {
    return {
      success: false,
      message: 'Firebase Admin not initialized',
      error: 'FIREBASE_NOT_INITIALIZED'
    };
  }

  try {
    await admin.auth().updateUser(uid, {
      disabled: true
    });

    console.log(`[Firebase Admin] User ${uid} disabled successfully`);
    return {
      success: true,
      message: 'User account disabled successfully'
    };
  } catch (error: any) {
    console.error('[Firebase Admin] Error disabling user:', error);
    return {
      success: false,
      message: 'Failed to disable user account',
      error: error.message
    };
  }
}

/**
 * Enable a previously disabled user account
 */
export async function enableUser(uid: string): Promise<UserActionResult> {
  const admin = getFirebaseAdmin();
  if (!admin) {
    return {
      success: false,
      message: 'Firebase Admin not initialized',
      error: 'FIREBASE_NOT_INITIALIZED'
    };
  }

  try {
    await admin.auth().updateUser(uid, {
      disabled: false
    });

    console.log(`[Firebase Admin] User ${uid} enabled successfully`);
    return {
      success: true,
      message: 'User account enabled successfully'
    };
  } catch (error: any) {
    console.error('[Firebase Admin] Error enabling user:', error);
    return {
      success: false,
      message: 'Failed to enable user account',
      error: error.message
    };
  }
}

/**
 * Delete a user account permanently
 * WARNING: This action cannot be undone
 */
export async function deleteUser(uid: string): Promise<UserActionResult> {
  const admin = getFirebaseAdmin();
  if (!admin) {
    return {
      success: false,
      message: 'Firebase Admin not initialized',
      error: 'FIREBASE_NOT_INITIALIZED'
    };
  }

  try {
    await admin.auth().deleteUser(uid);

    console.log(`[Firebase Admin] User ${uid} deleted successfully`);
    return {
      success: true,
      message: 'User account deleted permanently'
    };
  } catch (error: any) {
    console.error('[Firebase Admin] Error deleting user:', error);
    return {
      success: false,
      message: 'Failed to delete user account',
      error: error.message
    };
  }
}

/**
 * Send password reset email to user
 */
export async function sendPasswordResetEmail(email: string): Promise<UserActionResult> {
  const admin = getFirebaseAdmin();
  if (!admin) {
    return {
      success: false,
      message: 'Firebase Admin not initialized',
      error: 'FIREBASE_NOT_INITIALIZED'
    };
  }

  try {
    // Generate password reset link
    const link = await admin.auth().generatePasswordResetLink(email);

    console.log(`[Firebase Admin] Password reset link generated for ${email}`);
    console.log(`[Firebase Admin] Reset link: ${link}`);
    
    // Note: In production, you would send this link via email using your email service
    // For now, we just generate the link and return it
    
    return {
      success: true,
      message: `Password reset link generated. Link: ${link}`
    };
  } catch (error: any) {
    console.error('[Firebase Admin] Error generating password reset link:', error);
    return {
      success: false,
      message: 'Failed to generate password reset link',
      error: error.message
    };
  }
}

/**
 * Update user email address
 */
export async function updateUserEmail(uid: string, newEmail: string): Promise<UserActionResult> {
  const admin = getFirebaseAdmin();
  if (!admin) {
    return {
      success: false,
      message: 'Firebase Admin not initialized',
      error: 'FIREBASE_NOT_INITIALIZED'
    };
  }

  try {
    await admin.auth().updateUser(uid, {
      email: newEmail,
      emailVerified: false // User needs to verify new email
    });

    console.log(`[Firebase Admin] Email updated for user ${uid} to ${newEmail}`);
    return {
      success: true,
      message: 'Email updated successfully. User needs to verify new email.'
    };
  } catch (error: any) {
    console.error('[Firebase Admin] Error updating email:', error);
    return {
      success: false,
      message: 'Failed to update email address',
      error: error.message
    };
  }
}

/**
 * Update user phone number
 */
export async function updateUserPhone(uid: string, newPhone: string): Promise<UserActionResult> {
  const admin = getFirebaseAdmin();
  if (!admin) {
    return {
      success: false,
      message: 'Firebase Admin not initialized',
      error: 'FIREBASE_NOT_INITIALIZED'
    };
  }

  try {
    await admin.auth().updateUser(uid, {
      phoneNumber: newPhone
    });

    console.log(`[Firebase Admin] Phone updated for user ${uid} to ${newPhone}`);
    return {
      success: true,
      message: 'Phone number updated successfully'
    };
  } catch (error: any) {
    console.error('[Firebase Admin] Error updating phone:', error);
    return {
      success: false,
      message: 'Failed to update phone number',
      error: error.message
    };
  }
}

/**
 * Get user details by UID
 */
export async function getUserDetails(uid: string) {
  const admin = getFirebaseAdmin();
  if (!admin) {
    throw new Error('Firebase Admin not initialized');
  }

  try {
    const userRecord = await admin.auth().getUser(uid);
    return {
      uid: userRecord.uid,
      email: userRecord.email,
      emailVerified: userRecord.emailVerified,
      displayName: userRecord.displayName,
      phoneNumber: userRecord.phoneNumber,
      photoURL: userRecord.photoURL,
      disabled: userRecord.disabled,
      metadata: {
        creationTime: userRecord.metadata.creationTime,
        lastSignInTime: userRecord.metadata.lastSignInTime,
        lastRefreshTime: userRecord.metadata.lastRefreshTime
      },
      providerData: userRecord.providerData
    };
  } catch (error: any) {
    console.error('[Firebase Admin] Error getting user details:', error);
    throw new Error(`Failed to get user details: ${error.message}`);
  }
}
