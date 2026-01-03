import admin from 'firebase-admin';
import { readFileSync } from 'fs';
import { join } from 'path';

let firebaseApp: admin.app.App | null = null;

/**
 * Initialize Firebase Admin SDK
 * Uses service account JSON file for authentication
 */
export function initializeFirebase() {
  if (firebaseApp) {
    return firebaseApp;
  }

  try {
    // Try to load service account from file (local development)
    const serviceAccountPath = join(process.cwd(), 'firebase-service-account.json');
    const serviceAccount = JSON.parse(readFileSync(serviceAccountPath, 'utf8'));

    firebaseApp = admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      projectId: 'owl-fenc',
    });

    console.log('[Firebase] Initialized successfully with service account');
    return firebaseApp;
  } catch (error) {
    // Try to use environment variable (Replit/production)
    const serviceAccountEnv = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (serviceAccountEnv) {
      try {
        const serviceAccount = JSON.parse(serviceAccountEnv);
        firebaseApp = admin.initializeApp({
          credential: admin.credential.cert(serviceAccount),
          projectId: 'owl-fenc',
        });
        console.log('[Firebase] Initialized successfully with environment variable');
        return firebaseApp;
      } catch (envError) {
        console.error('[Firebase] Failed to parse FIREBASE_SERVICE_ACCOUNT env var:', envError);
      }
    }

    console.error('[Firebase] Failed to initialize:', error);
    throw new Error('Firebase initialization failed. Please provide service account credentials.');
  }
}

/**
 * Get Firestore database instance
 */
export function getFirestore() {
  if (!firebaseApp) {
    initializeFirebase();
  }
  return admin.firestore();
}

/**
 * Get Firebase Auth instance
 */
export function getAuth() {
  if (!firebaseApp) {
    initializeFirebase();
  }
  return admin.auth();
}

// Initialize on module load
try {
  initializeFirebase();
} catch (error) {
  console.warn('[Firebase] Deferred initialization - will try again on first use');
}
