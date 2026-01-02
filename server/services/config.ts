/**
 * External Services Configuration
 * Centralized configuration for Stripe, Resend, and external databases
 */

import Stripe from 'stripe';
import { Resend } from 'resend';

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
  console.warn('[Config] RESEND_API_KEY not found, email functionality will be disabled');
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
    console.warn('[Config] Configure these in Replit Secrets or .env.local');
  }

  return missing.length === 0;
}

// Initialize and validate on module load
validateConfig();
