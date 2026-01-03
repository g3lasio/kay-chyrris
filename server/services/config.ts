/**
 * External Services Configuration
 * Centralized configuration for Stripe, Resend, and external databases
 */

// CRITICAL: Load environment variables FIRST before any other imports
import { config as loadDotenv } from 'dotenv';
import { existsSync } from 'fs';
import { resolve } from 'path';

// Try to load .env.local if it exists (for local development)
const envLocalPath = resolve(process.cwd(), '.env.local');
if (existsSync(envLocalPath)) {
  console.log('[Config] Loading .env.local from:', envLocalPath);
  const result = loadDotenv({ path: envLocalPath });
  if (result.error) {
    console.error('[Config] Error loading .env.local:', result.error);
  } else {
    console.log('[Config] .env.local loaded successfully');
  }
}

import Stripe from 'stripe';
import { Resend } from 'resend';

// Debug: Log all environment variables related to our services
console.log('[Config] === Environment Variables Debug ===');
console.log('[Config] STRIPE_SECRET_KEY:', process.env.STRIPE_SECRET_KEY ? `${process.env.STRIPE_SECRET_KEY.substring(0, 15)}...` : 'NOT FOUND');
console.log('[Config] RESEND_API_KEY:', process.env.RESEND_API_KEY ? `${process.env.RESEND_API_KEY.substring(0, 10)}...` : 'NOT FOUND');
console.log('[Config] OWLFENC_DATABASE_URL:', process.env.OWLFENC_DATABASE_URL ? 'CONFIGURED' : 'NOT FOUND');
console.log('[Config] LEADPRIME_DATABASE_URL:', process.env.LEADPRIME_DATABASE_URL ? 'CONFIGURED' : 'NOT FOUND');
console.log('[Config] =====================================');

// Stripe Configuration
const stripeKey = process.env.STRIPE_SECRET_KEY;
if (!stripeKey) {
  console.warn('[Config] STRIPE_SECRET_KEY not found, Stripe functionality will be disabled');
}
export const stripe = stripeKey ? new Stripe(stripeKey, {
  apiVersion: '2025-12-15.clover',
  typescript: true,
}) : null;

// Resend Configuration
const resendApiKey = process.env.RESEND_API_KEY;
if (!resendApiKey) {
  console.error('[Config] ❌ RESEND_API_KEY not found, email functionality will be disabled');
} else {
  console.log(`[Config] ✅ Resend initialized with API key: ${resendApiKey.substring(0, 10)}...`);
}
export const resend = resendApiKey ? new Resend(resendApiKey) : null;

// External Database URLs
export const EXTERNAL_DBS = {
  owlfenc: process.env.OWLFENC_DATABASE_URL || '',
  leadprime: process.env.LEADPRIME_DATABASE_URL || '',
} as const;

// Validate required environment variables
export function validateConfig() {
  const missing: string[] = [];

  if (!process.env.STRIPE_SECRET_KEY) missing.push('STRIPE_SECRET_KEY');
  if (!process.env.RESEND_API_KEY) missing.push('RESEND_API_KEY');
  if (!process.env.OWLFENC_DATABASE_URL) missing.push('OWLFENC_DATABASE_URL');
  if (!process.env.LEADPRIME_DATABASE_URL) missing.push('LEADPRIME_DATABASE_URL');

  if (missing.length > 0) {
    console.warn(`[Config] Missing environment variables: ${missing.join(', ')}`);
    console.warn('[Config] Some features may not work correctly');
  }

  return missing.length === 0;
}

// Initialize and validate on module load
validateConfig();
