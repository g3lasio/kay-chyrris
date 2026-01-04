import { ENV } from '../_core/env';

/**
 * Resend API Integration
 * Fetches email usage statistics directly from Resend API
 */

interface ResendEmail {
  id: string;
  from: string;
  to: string[];
  subject: string;
  created_at: string;
}

interface ResendEmailsResponse {
  data: ResendEmail[];
  has_more: boolean;
}

/**
 * Get emails sent today from Resend API
 * @returns Number of emails sent today
 */
export async function getResendEmailsSentToday(): Promise<number> {
  try {
    if (!ENV.resendApiKey) {
      console.error('[Resend API] API key not configured');
      return 0;
    }

    // Calculate today's start time (midnight UTC)
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const todayISO = today.toISOString();

    // Resend API endpoint to list emails
    const response = await fetch('https://api.resend.com/emails', {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${ENV.resendApiKey}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      console.error('[Resend API] Failed to fetch emails:', response.statusText);
      return 0;
    }

    const data: ResendEmailsResponse = await response.json();
    
    // Filter emails sent today
    const emailsToday = data.data.filter(email => {
      const emailDate = new Date(email.created_at);
      return emailDate >= today;
    });

    console.log(`[Resend API] Emails sent today: ${emailsToday.length}`);
    return emailsToday.length;
  } catch (error) {
    console.error('[Resend API] Error fetching email count:', error);
    return 0;
  }
}

/**
 * Get total emails sent in the current month from Resend API
 * @returns Number of emails sent this month
 */
export async function getResendEmailsSentThisMonth(): Promise<number> {
  try {
    if (!ENV.resendApiKey) {
      console.error('[Resend API] API key not configured');
      return 0;
    }

    // Calculate month start time (first day of month at midnight UTC)
    const monthStart = new Date();
    monthStart.setUTCDate(1);
    monthStart.setUTCHours(0, 0, 0, 0);

    // Resend API endpoint to list emails
    const response = await fetch('https://api.resend.com/emails', {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${ENV.resendApiKey}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      console.error('[Resend API] Failed to fetch emails:', response.statusText);
      return 0;
    }

    const data: ResendEmailsResponse = await response.json();
    
    // Filter emails sent this month
    const emailsThisMonth = data.data.filter(email => {
      const emailDate = new Date(email.created_at);
      return emailDate >= monthStart;
    });

    console.log(`[Resend API] Emails sent this month: ${emailsThisMonth.length}`);
    return emailsThisMonth.length;
  } catch (error) {
    console.error('[Resend API] Error fetching email count:', error);
    return 0;
  }
}

/**
 * Get email usage statistics from Resend API
 * @returns Object with today's count, monthly count, daily limit, and usage percentage
 */
export async function getResendUsageStats() {
  const emailsSentToday = await getResendEmailsSentToday();
  const emailsSentThisMonth = await getResendEmailsSentThisMonth();
  const dailyLimit = 500; // Resend free tier limit
  const usagePercentage = (emailsSentToday / dailyLimit) * 100;

  return {
    emailsSentToday,
    emailsSentThisMonth,
    dailyLimit,
    usagePercentage: Math.round(usagePercentage * 10) / 10, // Round to 1 decimal
    isNearLimit: usagePercentage >= 80, // Alert at 80%
    isCritical: usagePercentage >= 90, // Critical at 90%
  };
}
