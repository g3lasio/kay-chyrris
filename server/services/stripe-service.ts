import { stripe } from './config';

export interface StripeSubscription {
  id: string;
  customer: string;
  status: string;
  currentPeriodEnd: Date;
  currentPeriodStart: Date;
  cancelAtPeriodEnd: boolean;
  plan: {
    id: string;
    amount: number;
    currency: string;
    interval: string;
    product: string;
  };
}

export interface StripePayment {
  id: string;
  amount: number;
  currency: string;
  status: string;
  created: Date;
  customer: string;
  description: string | null;
}

export interface StripeMRRData {
  currentMRR: number;
  previousMRR: number;
  growth: number;
  activeSubscriptions: number;
  currency: string;
}

export async function getSubscriptions(limit: number = 100): Promise<StripeSubscription[]> {
  if (!stripe) {
    console.warn('[Stripe] Not initialized');
    return [];
  }

  try {
    const subscriptions = await stripe.subscriptions.list({
      limit,
      expand: ['data.plan.product'],
    });

    return subscriptions.data.map((sub) => ({
      id: sub.id,
      customer: typeof sub.customer === 'string' ? sub.customer : sub.customer.id,
      status: sub.status,
      currentPeriodEnd: new Date((sub as any).current_period_end * 1000),
      currentPeriodStart: new Date((sub as any).current_period_start * 1000),
      cancelAtPeriodEnd: sub.cancel_at_period_end,
      plan: {
        id: sub.items.data[0]?.price.id || '',
        amount: sub.items.data[0]?.price.unit_amount || 0,
        currency: sub.items.data[0]?.price.currency || 'usd',
        interval: sub.items.data[0]?.price.recurring?.interval || 'month',
        product: typeof sub.items.data[0]?.price.product === 'string' 
          ? sub.items.data[0].price.product 
          : sub.items.data[0]?.price.product?.id || '',
      },
    }));
  } catch (error) {
    console.error('[Stripe] Error fetching subscriptions:', error);
    return [];
  }
}

export async function getPayments(limit: number = 100): Promise<StripePayment[]> {
  if (!stripe) {
    console.warn('[Stripe] Not initialized');
    return [];
  }

  try {
    const charges = await stripe.charges.list({
      limit,
    });

    return charges.data.map((charge) => ({
      id: charge.id,
      amount: charge.amount,
      currency: charge.currency,
      status: charge.status,
      created: new Date(charge.created * 1000),
      customer: typeof charge.customer === 'string' ? charge.customer : charge.customer?.id || '',
      description: charge.description,
    }));
  } catch (error) {
    console.error('[Stripe] Error fetching payments:', error);
    return [];
  }
}

export async function getFailedPayments(limit: number = 50): Promise<StripePayment[]> {
  if (!stripe) {
    console.warn('[Stripe] Not initialized');
    return [];
  }

  try {
    const charges = await stripe.charges.list({
      limit,
    });

    return charges.data
      .filter((charge) => charge.status === 'failed')
      .map((charge) => ({
        id: charge.id,
        amount: charge.amount,
        currency: charge.currency,
        status: charge.status,
        created: new Date(charge.created * 1000),
        customer: typeof charge.customer === 'string' ? charge.customer : charge.customer?.id || '',
        description: charge.description,
      }));
  } catch (error) {
    console.error('[Stripe] Error fetching failed payments:', error);
    return [];
  }
}

export async function calculateMRR(): Promise<StripeMRRData> {
  if (!stripe) {
    console.warn('[Stripe] Not initialized');
    return {
      currentMRR: 0,
      previousMRR: 0,
      growth: 0,
      activeSubscriptions: 0,
      currency: 'usd',
    };
  }

  try {
    const subscriptions = await stripe.subscriptions.list({
      status: 'active',
      limit: 100,
    });

    let currentMRR = 0;
    let currency = 'usd';

    subscriptions.data.forEach((sub) => {
      const amount = sub.items.data[0]?.price.unit_amount || 0;
      const interval = sub.items.data[0]?.price.recurring?.interval;
      currency = sub.items.data[0]?.price.currency || 'usd';

      // Convert to monthly recurring revenue
      if (interval === 'month') {
        currentMRR += amount;
      } else if (interval === 'year') {
        currentMRR += amount / 12;
      }
    });

    // Convert from cents to dollars
    currentMRR = currentMRR / 100;

    // For now, we'll calculate previous MRR as 90% of current (placeholder)
    // In a real implementation, you'd query historical data
    const previousMRR = currentMRR * 0.9;
    const growth = previousMRR > 0 ? ((currentMRR - previousMRR) / previousMRR) * 100 : 0;

    return {
      currentMRR,
      previousMRR,
      growth,
      activeSubscriptions: subscriptions.data.length,
      currency,
    };
  } catch (error) {
    console.error('[Stripe] Error calculating MRR:', error);
    return {
      currentMRR: 0,
      previousMRR: 0,
      growth: 0,
      activeSubscriptions: 0,
      currency: 'usd',
    };
  }
}

export async function getCustomerDetails(customerId: string) {
  if (!stripe) {
    console.warn('[Stripe] Not initialized');
    return null;
  }

  try {
    const customer = await stripe.customers.retrieve(customerId);
    return customer;
  } catch (error) {
    console.error('[Stripe] Error fetching customer:', error);
    return null;
  }
}

// ─── Partner Coupon Management ────────────────────────────────────────────────

export interface PartnerCoupon {
  id: string;
  name: string;
  percentOff: number | null;
  amountOff: number | null;
  currency: string | null;
  duration: string;
  durationInMonths: number | null;
  timesRedeemed: number;
  maxRedemptions: number | null;
  valid: boolean;
  created: Date;
  redeemBy: Date | null;
  appliesTo: string | null; // plan restriction label (e.g. 'Master Contractor')
}

export interface CreateCouponInput {
  name: string;
  percentOff?: number;
  amountOff?: number;
  currency?: string;
  duration: 'forever' | 'once' | 'repeating';
  durationInMonths?: number;
  maxRedemptions?: number;
  redeemBy?: number; // unix timestamp
  appliesTo?: string; // metadata label
}

export async function getCoupons(): Promise<PartnerCoupon[]> {
  if (!stripe) {
    console.warn('[Stripe] Not initialized');
    return [];
  }
  try {
    const coupons = await stripe.coupons.list({ limit: 100 });
    return coupons.data.map((c) => ({
      id: c.id,
      name: c.name || c.id,
      percentOff: c.percent_off ?? null,
      amountOff: c.amount_off ?? null,
      currency: c.currency ?? null,
      duration: c.duration,
      durationInMonths: c.duration_in_months ?? null,
      timesRedeemed: c.times_redeemed,
      maxRedemptions: c.max_redemptions ?? null,
      valid: c.valid,
      created: new Date(c.created * 1000),
      redeemBy: c.redeem_by ? new Date(c.redeem_by * 1000) : null,
      appliesTo: (c.metadata as any)?.appliesTo ?? null,
    }));
  } catch (error) {
    console.error('[Stripe] Error fetching coupons:', error);
    return [];
  }
}

export async function createCoupon(input: CreateCouponInput): Promise<PartnerCoupon> {
  if (!stripe) throw new Error('Stripe not initialized');

  // Use the name as the Stripe coupon ID so the code is predictable and exact-matchable.
  // e.g. name="BLUECOLLAR" → Stripe ID="BLUECOLLAR" → user enters "BLUECOLLAR" → exact match.
  // Sanitize: uppercase, replace spaces/special chars with underscore.
  const couponId = input.name.trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '_');

  const params: any = {
    id: couponId,
    name: input.name,
    duration: input.duration,
    metadata: { appliesTo: input.appliesTo || 'Master Contractor' },
  };

  if (input.percentOff !== undefined) params.percent_off = input.percentOff;
  if (input.amountOff !== undefined) {
    params.amount_off = input.amountOff;
    params.currency = input.currency || 'usd';
  }
  if (input.duration === 'repeating' && input.durationInMonths) {
    params.duration_in_months = input.durationInMonths;
  }
  if (input.maxRedemptions) params.max_redemptions = input.maxRedemptions;
  if (input.redeemBy) params.redeem_by = input.redeemBy;

  const coupon = await stripe.coupons.create(params);
  return {
    id: coupon.id,
    name: coupon.name || coupon.id,
    percentOff: coupon.percent_off ?? null,
    amountOff: coupon.amount_off ?? null,
    currency: coupon.currency ?? null,
    duration: coupon.duration,
    durationInMonths: coupon.duration_in_months ?? null,
    timesRedeemed: coupon.times_redeemed,
    maxRedemptions: coupon.max_redemptions ?? null,
    valid: coupon.valid,
    created: new Date(coupon.created * 1000),
    redeemBy: coupon.redeem_by ? new Date(coupon.redeem_by * 1000) : null,
    appliesTo: (coupon.metadata as any)?.appliesTo ?? null,
  };
}

export async function deactivateCoupon(couponId: string): Promise<boolean> {
  if (!stripe) throw new Error('Stripe not initialized');
  try {
    await stripe.coupons.del(couponId);
    return true;
  } catch (error) {
    console.error('[Stripe] Error deactivating coupon:', error);
    return false;
  }
}
