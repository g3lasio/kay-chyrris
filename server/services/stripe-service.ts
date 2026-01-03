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
