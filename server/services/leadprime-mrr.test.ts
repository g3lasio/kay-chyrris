/**
 * Fuente única del MRR, con el cruce contra Stripe.
 *
 * Dos cosas que se rompieron en producción y aquí quedan fijadas:
 *
 *  1. Las dos pantallas mostraban MRR distinto ($1,345 en P&L Overview vs
 *     $1,594 en By User & Churn) porque cada una tenía su propia consulta. Los
 *     movimientos salen ahora del MISMO cálculo que el MRR.
 *  2. El desglose del P&L mostraba DOS chyrris_growth de $650 y solo uno con
 *     etiqueta manual, mientras Stripe no tenía ninguna suscripción de $650.
 *     Ahora cada línea se cruza contra Stripe y lo que no aparece allá se
 *     etiqueta como cobro manual.
 *
 * El Stripe de verdad no se toca: se inyecta un doble.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Doble de Stripe ──────────────────────────────────────────────────────────
let stripeSubs: any[] = [];
let stripeThrows = false;
let stripeConfigured = true;

vi.mock('./leadprime-finance', () => ({
  getStripe: () => {
    if (!stripeConfigured) return null;
    return {
      subscriptions: {
        list: ({ status }: any) => ({
          async *[Symbol.asyncIterator]() {
            if (stripeThrows) throw new Error('Stripe caído');
            for (const s of stripeSubs.filter((x) => (x.status ?? 'active') === status)) yield s;
          },
        }),
      },
    };
  },
}));

// ── Doble del pool de Postgres ───────────────────────────────────────────────
let dbRows: any[] = [];
const pool: any = { query: async () => ({ rows: dbRows }) };

const { getRecurringRevenue } = await import('./leadprime-mrr');

function sub(over: Partial<any> = {}) {
  return {
    contractor_id: 'c1',
    plan_name: 'chyrris_growth',
    status: 'active',
    created_at: new Date('2020-01-01'),
    canceled_at: null,
    cancel_at_period_end: false,
    stripe_subscription_id: null,
    stripe_customer_id: null,
    email: 'a@x.com',
    phone: null,
    name: null,
    business_name: null,
    plan_price_cents: 65000,
    billing_mode: null,
    agreed_price_cents: null,
    config_status: null,
    ...over,
  };
}

function stripeSub(over: Partial<any> = {}) {
  return {
    id: 'sub_1',
    status: 'active',
    customer: { id: 'cus_1', email: 'a@x.com' },
    items: { data: [{ quantity: 1, price: { unit_amount: 1500, recurring: { interval: 'month', interval_count: 1 }, product: 'LeadPrime - Plan Base' } }] },
    ...over,
  };
}

beforeEach(() => {
  dbRows = [];
  stripeSubs = [];
  stripeThrows = false;
  stripeConfigured = true;
});

describe('origen del dinero — cruce contra Stripe', () => {
  it('una suscripción con contraparte en Stripe se marca como cobro automático', async () => {
    dbRows = [sub({ email: 'rosalio@x.com', plan_name: 'plan_base', plan_price_cents: 1500 })];
    stripeSubs = [stripeSub({ customer: { id: 'cus_1', email: 'rosalio@x.com' } })];

    const rev = await getRecurringRevenue(pool);
    expect(rev.lines[0].billingSource).toBe('stripe');
    expect(rev.stripeMrrUsd).toBe(15);
    expect(rev.unverifiedMrrUsd).toBe(0);
  });

  it('los $650 sin contraparte en Stripe se marcan como cobro MANUAL', async () => {
    // El caso exacto: Stripe solo tiene planes de $15, no hay ninguno de $650.
    dbRows = [sub({ email: 'g3lasio@proton.me', plan_price_cents: 65000 })];
    stripeSubs = [stripeSub({ customer: { id: 'cus_9', email: 'otro@x.com' } })];

    const rev = await getRecurringRevenue(pool);
    expect(rev.lines[0].billingSource).toBe('manual');
    expect(rev.unverifiedMrrUsd).toBe(650);
    expect(rev.stripeMrrUsd).toBe(0);
    // Y sigue contando completo en el MRR: no se elimina nada.
    expect(rev.mrrUsd).toBe(650);
  });

  it('cada dólar del MRR queda asignado a un origen', async () => {
    dbRows = [
      sub({ contractor_id: 'a', email: 'a@x.com', plan_name: 'plan_base', plan_price_cents: 1500 }),
      sub({ contractor_id: 'b', email: 'b@x.com', plan_price_cents: 65000 }),
      sub({ contractor_id: 'c', email: 'c@x.com', plan_name: 'network_elite', plan_price_cents: 24900 }),
    ];
    stripeSubs = [stripeSub({ customer: { id: 'cus_1', email: 'a@x.com' } })];

    const rev = await getRecurringRevenue(pool);
    expect(rev.stripeMrrUsd + rev.unverifiedMrrUsd).toBe(rev.mrrUsd);
    expect(rev.stripeMrrUsd).toBe(15);
    expect(rev.unverifiedMrrUsd).toBe(899);
  });

  it('reporta las suscripciones de Stripe SIN contraparte local, sin sumarlas', async () => {
    dbRows = [sub({ email: 'a@x.com', plan_name: 'plan_base', plan_price_cents: 1500 })];
    stripeSubs = [
      stripeSub({ customer: { id: 'cus_1', email: 'a@x.com' } }),
      // "Caymus Tanks Pro" $6.29 — ni siquiera es LeadPrime.
      stripeSub({
        id: 'sub_caymus',
        customer: { id: 'cus_2', email: 'j.jrodriguez85@gmail.com' },
        items: { data: [{ quantity: 1, price: { unit_amount: 629, recurring: { interval: 'month', interval_count: 1 }, product: 'Caymus Tanks Pro' } }] },
      }),
    ];

    const rev = await getRecurringRevenue(pool);
    expect(rev.stripeOrphans).toHaveLength(1);
    expect(rev.stripeOrphans[0].email).toBe('j.jrodriguez85@gmail.com');
    expect(rev.stripeOrphans[0].monthlyUsd).toBe(6.29);
    expect(rev.mrrUsd).toBe(15); // el huérfano NO infla el MRR
  });

  it('normaliza a mensual una suscripción anual de Stripe', async () => {
    dbRows = [sub({ email: 'a@x.com', plan_price_cents: 65000 })];
    stripeSubs = [
      stripeSub({
        customer: { id: 'cus_1', email: 'a@x.com' },
        items: { data: [{ quantity: 1, price: { unit_amount: 120000, recurring: { interval: 'year', interval_count: 1 } } }] },
      }),
    ];
    const rev = await getRecurringRevenue(pool);
    expect(rev.lines[0].stripeMonthlyUsd).toBe(100); // $1,200/año = $100/mes
  });

  it('si Stripe NO se puede consultar, no se afirma el origen (unknown, no "manual")', async () => {
    dbRows = [sub({ email: 'a@x.com' })];
    stripeThrows = true;

    const rev = await getRecurringRevenue(pool);
    expect(rev.stripeCheck.available).toBe(false);
    expect(rev.lines[0].billingSource).toBe('unknown');
    expect(rev.unverifiedMrrUsd).toBe(0); // no se cuenta como manual sin comprobarlo
    expect(rev.mrrUsd).toBe(650);         // pero el MRR no cambia
  });

  it('sin API key configurada tampoco se inventa el origen', async () => {
    dbRows = [sub({ email: 'a@x.com' })];
    stripeConfigured = false;
    const rev = await getRecurringRevenue(pool);
    expect(rev.stripeCheck.available).toBe(false);
    expect(rev.lines[0].billingSource).toBe('unknown');
  });
});

describe('una sola fuente — MRR y movimientos', () => {
  it('cuentas activas y suscripciones de pago son números distintos y ambos se exponen', async () => {
    dbRows = [
      sub({ contractor_id: 'pago', email: 'pago@x.com', plan_price_cents: 65000 }),
      ...Array.from({ length: 20 }, (_, i) =>
        sub({ contractor_id: `free${i}`, email: `f${i}@x.com`, plan_name: 'pay_as_you_go', plan_price_cents: 0 })
      ),
    ];
    const rev = await getRecurringRevenue(pool);
    expect(rev.activeAccounts).toBe(21);      // era el "21 subscriptions"
    expect(rev.activeSubscriptions).toBe(1);  // las que aportan dinero
    expect(rev.mrrUsd).toBe(650);
  });

  it('el churn del mes solo cuenta planes con mensualidad', async () => {
    const thisMonth = new Date();
    thisMonth.setUTCDate(2);
    dbRows = [
      sub({ contractor_id: 'a', email: 'a@x.com' }),
      sub({ contractor_id: 'gone', email: 'gone@x.com', status: 'canceled', canceled_at: thisMonth, plan_price_cents: 24900 }),
      sub({ contractor_id: 'freegone', email: 'fg@x.com', status: 'canceled', canceled_at: thisMonth, plan_name: 'pay_as_you_go', plan_price_cents: 0 }),
    ];
    const rev = await getRecurringRevenue(pool);
    expect(rev.movements.churnedCount).toBe(1);
    expect(rev.movements.churnedMrrUsd).toBe(249);
  });

  it('cuenta en riesgo = cancel_at_period_end, valorada al mismo precio', async () => {
    dbRows = [sub({ email: 'a@x.com', cancel_at_period_end: true })];
    const rev = await getRecurringRevenue(pool);
    expect(rev.movements.atRiskCount).toBe(1);
    expect(rev.movements.atRiskMrrUsd).toBe(650);
  });
});

describe('duplicados — no se borra ingreso', () => {
  it('dos cuentas DE PAGO del mismo dueño suman las dos y se marcan para revisión', async () => {
    dbRows = [
      sub({ contractor_id: 'owlfenc', email: 'info@owlfenc.com', phone: '5551112222', name: 'Gelasio', plan_name: 'network_elite', plan_price_cents: 24900 }),
      sub({ contractor_id: 'proton', email: 'g3lasio@proton.me', phone: '5551112222', name: 'Gelasio', plan_price_cents: 65000 }),
    ];
    const rev = await getRecurringRevenue(pool);
    expect(rev.mrrUsd).toBe(899); // $650 + $249: los $249 NO se pierden
    expect(rev.activeSubscriptions).toBe(2);
    expect(rev.lines.every((l) => l.needsReview)).toBe(true);
    expect(rev.reviewGroups).toHaveLength(1);
    expect(rev.excluded.some((e) => /duplicad/i.test(e.reason))).toBe(false);
  });

  it('una cuenta con filas repetidas por el JOIN no se marca duplicada de sí misma', async () => {
    // MORENITA Management: dos filas de company_profiles para el mismo id.
    dbRows = [
      sub({ contractor_id: 'morenita', email: 'truthbackpack@gmail.com', phone: '5553334444', business_name: 'MORENITA Management', plan_price_cents: 65000 }),
      sub({ contractor_id: 'morenita', email: 'truthbackpack@gmail.com', phone: '5553334444', business_name: 'MORENITA Management', plan_price_cents: 65000 }),
    ];
    const rev = await getRecurringRevenue(pool);
    expect(rev.activeAccounts).toBe(1);
    expect(rev.mrrUsd).toBe(650);
    expect(rev.excluded).toHaveLength(0);
  });
});

describe('el $650 de Zelle no se toca', () => {
  it('cuenta completo en el MRR y se marca como manual', async () => {
    dbRows = [
      sub({
        contractor_id: 'hugo',
        email: 'hugo@x.com',
        billing_mode: 'external_zelle',
        config_status: 'applied',
        agreed_price_cents: 65000,
      }),
    ];
    const rev = await getRecurringRevenue(pool);
    expect(rev.mrrUsd).toBe(650);
    expect(rev.manualMrrUsd).toBe(650);
    expect(rev.lines[0].isManual).toBe(true);
    expect(rev.byPlan[0].plan).toContain('Manual / Zelle');
  });
});
