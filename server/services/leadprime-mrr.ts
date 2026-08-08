/**
 * leadprime-mrr.ts — FUENTE ÚNICA de ingreso recurrente (MRR).
 *
 * POR QUÉ EXISTE (auditoría ago 2026): dos pantallas mostraban MRR distinto y
 * ambas estaban mal.
 *
 *   · "By User & Churn" sumaba `subscriptions.base_price_cents`, columna cuyo
 *     DEFAULT es 1500. O sea: TODA cuenta nacía valiendo $15/mes, incluidas
 *     las Pay-As-You-Go (que no pagan mensualidad), la cuenta demo y los
 *     duplicados. De ahí salía el $549 = $249 (Elite) + 20 × $15.
 *   · "P&L Overview" leía Stripe y daba otro número.
 *
 * Ahora ambas pantallas leen de AQUÍ — no de dos consultas parecidas. La
 * segunda revisión (ago 8) encontró que seguían discrepando ($1,345 vs $1,594)
 * porque "By User & Churn" conservaba su propia consulta sin las exclusiones.
 * Por eso este módulo calcula también los MOVIMIENTOS (nuevas, churn, en
 * riesgo): mientras existan dos consultas, tarde o temprano vuelven a divergir.
 *
 * TRES CONCEPTOS QUE NO SON EL MISMO NÚMERO, y por eso se exponen por separado:
 *   · activeAccounts        — cuentas con suscripción activa, incluidas las que
 *                             no pagan mensualidad (Pay-As-You-Go). Era el "21".
 *   · activeSubscriptions   — las que SÍ aportan dinero al MRR. Era el "5".
 *   · mrrUsd                — la suma de dinero de esas últimas.
 *
 * ORIGEN DEL DINERO (requisito del dueño): cada dólar del MRR se cruza contra
 * Stripe. Lo que no tiene contraparte en Stripe se marca como cobro MANUAL con
 * su etiqueta — igual que el de Zelle — para que no quede ni un dólar sin
 * origen identificable. No se elimina nada: se etiqueta y se reporta.
 *
 * INGRESO MANUAL (Zelle): las suscripciones cobradas fuera de Stripe SÍ son
 * ingreso real y cuentan como MRR — decisión del dueño. El contratista no pudo
 * pagar por el portal ACH y paga por transferencia; es temporal y a propósito,
 * pendiente de migrar a cobro automático. Se marca para que la UI lo etiquete,
 * pero NUNCA se excluye de ningún cálculo.
 */
import { Pool } from 'pg';
import { findDuplicateAccounts } from '@shared/duplicate-accounts';

/** De dónde sale el dinero de esta suscripción. */
export type BillingSource =
  /** Tiene suscripción activa en Stripe: cobro automático. */
  | 'stripe'
  /** Verificado contra Stripe y NO existe ahí: se cobra a mano (Zelle/transferencia). */
  | 'manual'
  /** No se pudo consultar Stripe, así que no se afirma nada. */
  | 'unknown';

export interface MrrLine {
  contractorId: string;
  planName: string;
  /** Precio mensual real en USD: catálogo del plan, o el acordado si es manual. */
  monthlyUsd: number;
  status: string;
  /** true = configurado explícitamente como cobro externo (Zelle) en LeadPrime. */
  isManual: boolean;
  /** Resultado del cruce contra Stripe. */
  billingSource: BillingSource;
  stripeSubscriptionId: string | null;
  /** Lo que Stripe cobra realmente, si se encontró la suscripción allá. */
  stripeMonthlyUsd: number | null;
  /** true = coincide con OTRA cuenta de pago; cuenta igual, pero requiere revisión. */
  needsReview: boolean;
  email: string | null;
  businessName: string | null;
}

export interface MrrMovementsOut {
  newCount: number;
  newMrrUsd: number;
  churnedCount: number;
  churnedMrrUsd: number;
  netNewMrrUsd: number;
  atRiskCount: number;
  atRiskMrrUsd: number;
  logoChurnRatePct: number | null;
}

export interface RecurringRevenue {
  available: boolean;
  note?: string;
  /** MRR total en USD (Stripe + manual). */
  mrrUsd: number;
  arrUsd: number;
  /** Suscripciones que REALMENTE aportan dinero (precio > 0, sin duplicados ni demo). */
  activeSubscriptions: number;
  /** Cuentas con suscripción activa, incluidas las que no pagan mensualidad. */
  activeAccounts: number;
  /** Parte del MRR configurada como cobro externo (Zelle) en LeadPrime. */
  manualMrrUsd: number;
  manualSubscriptions: number;
  /** Parte del MRR con suscripción activa CONFIRMADA en Stripe. */
  stripeMrrUsd: number;
  stripeSubscriptions: number;
  /** Parte del MRR SIN contraparte en Stripe → se cobra a mano. */
  unverifiedMrrUsd: number;
  unverifiedSubscriptions: number;
  /** Estado del cruce contra Stripe (si falló, no se afirma nada sobre el origen). */
  stripeCheck: { available: boolean; note?: string; activeSubscriptions: number };
  /** Suscripciones activas en Stripe SIN contraparte local — para que nada quede invisible. */
  stripeOrphans: Array<{ subscriptionId: string; email: string | null; monthlyUsd: number; product: string | null }>;
  byPlan: Array<{ plan: string; mrrUsd: number; subscriptions: number; isManual: boolean }>;
  lines: MrrLine[];
  /** Cuentas descartadas y por qué (transparencia: nada desaparece en silencio). */
  excluded: Array<{ contractorId: string; reason: string; email: string | null }>;
  /** Grupos de cuentas DE PAGO que coinciden: se suman todas, las decide una persona. */
  reviewGroups: Array<{ emails: string[]; contractorIds: string[] }>;
  movements: MrrMovementsOut;
}

const ACTIVE_STATUSES = ['active', 'trialing'];
/** Estados que se traen para poder calcular churn dentro del mes. */
const ALL_STATUSES = ['active', 'trialing', 'canceled', 'cancelled', 'past_due', 'unpaid', 'incomplete'];

/** Cuenta demo de App Review: nunca es ingreso. */
function isDemoAccount(row: any): boolean {
  const email = String(row.email || '').toLowerCase();
  const demoId = process.env.DEMO_CONTRACTOR_ID;
  if (demoId && row.contractor_id === demoId) return true;
  return email.includes('apple-review+') || email.includes('@leadprime.demo');
}

/**
 * Marca duplicados con la regla compartida. La regla NUNCA excluye una cuenta
 * con suscripción de pago activa: solo agrupa las que no pagan (aportan $0, así
 * que excluirlas no puede borrar ingreso) y señala para revisión humana los
 * casos en que dos cuentas de pago coinciden.
 */
function markDuplicates(rows: any[]) {
  return findDuplicateAccounts(
    rows.map((r) => ({
      id: r.contractor_id,
      phone: r.phone,
      name: r.name,
      businessName: r.business_name,
      monthlyPriceCents: priceCentsFor(r),
    }))
  );
}

/** Precio mensual real de una fila: acordado si el cobro es externo, si no catálogo. */
function priceCentsFor(row: any): number {
  const isManual = row.billing_mode === 'external_zelle' && row.config_status === 'applied';
  return isManual
    ? Number(row.agreed_price_cents || row.plan_price_cents || 0)
    : Number(row.plan_price_cents || 0);
}

// ── Cruce contra Stripe ───────────────────────────────────────────────────────

interface StripeSub {
  id: string;
  customerId: string | null;
  email: string | null;
  monthlyUsd: number;
  product: string | null;
}

/**
 * Trae las suscripciones ACTIVAS de Stripe. Read-only. Si no hay key o la API
 * falla, devuelve `available: false` y el llamador NO afirma nada sobre el
 * origen del dinero — decir "manual" sin haber podido comprobarlo sería tan
 * falso como el problema que esto vino a resolver.
 */
async function fetchStripeActiveSubs(): Promise<{
  available: boolean;
  note?: string;
  subs: StripeSub[];
}> {
  try {
    const { getStripe } = await import('./leadprime-finance');
    const stripe = getStripe();
    if (!stripe) return { available: false, note: 'Stripe no configurado (falta la API key)', subs: [] };

    const subs: StripeSub[] = [];
    for (const status of ['active', 'trialing'] as const) {
      const list = stripe.subscriptions.list({
        status,
        limit: 100,
        expand: ['data.customer', 'data.items.data.price'],
      });
      for await (const s of list) {
        // Importe mensual normalizado: Stripe puede facturar anual o semestral.
        let cents = 0;
        let product: string | null = null;
        for (const item of s.items?.data ?? []) {
          const price: any = item.price;
          const qty = item.quantity ?? 1;
          const unit = Number(price?.unit_amount ?? 0);
          const interval = price?.recurring?.interval ?? 'month';
          const count = Number(price?.recurring?.interval_count ?? 1) || 1;
          const perMonth =
            interval === 'year' ? unit / (12 * count)
            : interval === 'week' ? (unit * 52) / (12 * count)
            : interval === 'day' ? (unit * 365) / (12 * count)
            : unit / count;
          cents += perMonth * qty;
          product = product ?? (typeof price?.product === 'string' ? price.product : price?.product?.name ?? null);
        }
        const customer: any = s.customer;
        subs.push({
          id: s.id,
          customerId: typeof customer === 'string' ? customer : customer?.id ?? null,
          email: typeof customer === 'object' ? customer?.email ?? null : null,
          monthlyUsd: Math.round(cents) / 100,
          product,
        });
      }
    }
    return { available: true, subs };
  } catch (err: any) {
    return { available: false, note: `No se pudo consultar Stripe: ${err.message}`, subs: [] };
  }
}

// ── Cálculo principal ─────────────────────────────────────────────────────────

export async function getRecurringRevenue(pool: Pool): Promise<RecurringRevenue> {
  const out: RecurringRevenue = {
    available: false,
    mrrUsd: 0,
    arrUsd: 0,
    activeSubscriptions: 0,
    activeAccounts: 0,
    manualMrrUsd: 0,
    manualSubscriptions: 0,
    stripeMrrUsd: 0,
    stripeSubscriptions: 0,
    unverifiedMrrUsd: 0,
    unverifiedSubscriptions: 0,
    stripeCheck: { available: false, activeSubscriptions: 0 },
    stripeOrphans: [],
    byPlan: [],
    lines: [],
    excluded: [],
    reviewGroups: [],
    movements: {
      newCount: 0,
      newMrrUsd: 0,
      churnedCount: 0,
      churnedMrrUsd: 0,
      netNewMrrUsd: 0,
      atRiskCount: 0,
      atRiskMrrUsd: 0,
      logoChurnRatePct: null,
    },
  };

  try {
    // UNA consulta para todo: activas, nuevas, churn y riesgo salen del mismo
    // conjunto de filas, con las mismas exclusiones. Dos consultas distintas es
    // exactamente lo que produjo $1,345 en una pantalla y $1,594 en la otra.
    const res = await pool.query(
      `SELECT s.contractor_id,
              s.plan_name,
              s.status,
              s.created_at,
              s.canceled_at,
              s.cancel_at_period_end,
              s.stripe_subscription_id,
              s.stripe_customer_id,
              c.email,
              c.phone,
              c.name,
              COALESCE(cp.business_name, c.company_name) AS business_name,
              -- Precio REAL del catálogo. NUNCA base_price_cents (DEFAULT 1500,
              -- que hacía valer $15 hasta a las cuentas gratis).
              COALESCE(pd.monthly_price_cents, 0)        AS plan_price_cents,
              -- Pago fuera de Stripe (Zelle): precio ACORDADO, que puede diferir
              -- del catálogo porque los tiers gestionados se negocian.
              csc.billing_mode,
              csc.monthly_price_cents                    AS agreed_price_cents,
              csc.status                                 AS config_status
         FROM subscriptions s
         JOIN contractors c            ON c.id = s.contractor_id
         LEFT JOIN company_profiles cp ON cp.contractor_id = s.contractor_id
         LEFT JOIN plan_definitions pd ON pd.plan_name = s.plan_name
         LEFT JOIN contractor_subscription_config csc
                ON csc.contractor_id = s.contractor_id AND csc.enabled = true
        WHERE s.status = ANY($1)`,
      [ALL_STATUSES]
    );

    // Una fila por contractor_id: los LEFT JOIN pueden multiplicar filas (dos
    // company_profiles, dos configs), y sin esto una cuenta se contaba dos veces
    // y hasta se marcaba duplicada de sí misma.
    const byContractor = new Map<string, any>();
    for (const row of res.rows) {
      const prev = byContractor.get(row.contractor_id);
      if (!prev || priceCentsFor(row) > priceCentsFor(prev)) byContractor.set(row.contractor_id, row);
    }
    const rows = Array.from(byContractor.values());
    const activeRows = rows.filter((r) => ACTIVE_STATUSES.includes(r.status));

    const dupes = markDuplicates(activeRows);
    const stripeInfo = await fetchStripeActiveSubs();
    out.stripeCheck = {
      available: stripeInfo.available,
      note: stripeInfo.note,
      activeSubscriptions: stripeInfo.subs.length,
    };

    // Índices para cruzar: por id de suscripción, por cliente y por correo.
    const stripeById = new Map(stripeInfo.subs.map((s) => [s.id, s]));
    const stripeByCustomer = new Map(stripeInfo.subs.filter((s) => s.customerId).map((s) => [s.customerId!, s]));
    const stripeByEmail = new Map(
      stripeInfo.subs.filter((s) => s.email).map((s) => [s.email!.toLowerCase(), s])
    );
    const matchedStripeIds = new Set<string>();

    const planMap = new Map<string, { mrr: number; subs: number; isManual: boolean }>();
    const monthStart = new Date();
    monthStart.setUTCDate(1);
    monthStart.setUTCHours(0, 0, 0, 0);

    for (const row of activeRows) {
      out.activeAccounts += 1;
      const isManual = row.billing_mode === 'external_zelle' && row.config_status === 'applied';
      const monthlyUsd = priceCentsFor(row) / 100;

      if (isDemoAccount(row)) {
        out.excluded.push({ contractorId: row.contractor_id, reason: 'cuenta demo', email: row.email });
        continue;
      }
      if (dupes.duplicateIds.has(row.contractor_id)) {
        // Solo llegan aquí cuentas SIN plan de pago: la regla nunca excluye
        // ingreso. Se deja constancia de con cuál se repite.
        const primary = dupes.primaryOf.get(row.contractor_id);
        const primaryEmail = primary ? byContractor.get(primary)?.email : null;
        out.excluded.push({
          contractorId: row.contractor_id,
          reason: `cuenta duplicada sin plan de pago${primaryEmail ? ` (misma que ${primaryEmail})` : ''}`,
          email: row.email,
        });
        continue;
      }
      if (monthlyUsd <= 0) {
        // Pay-As-You-Go y planes sin precio: NO son ingreso recurrente.
        out.excluded.push({
          contractorId: row.contractor_id,
          reason: `plan sin mensualidad (${row.plan_name || 'sin plan'})`,
          email: row.email,
        });
        continue;
      }

      // ── Cruce contra Stripe ──
      const match =
        (row.stripe_subscription_id && stripeById.get(row.stripe_subscription_id)) ||
        (row.stripe_customer_id && stripeByCustomer.get(row.stripe_customer_id)) ||
        (row.email && stripeByEmail.get(String(row.email).toLowerCase())) ||
        null;
      if (match) matchedStripeIds.add(match.id);

      const billingSource: BillingSource = !stripeInfo.available
        ? 'unknown'
        : match
          ? 'stripe'
          : 'manual';

      out.lines.push({
        contractorId: row.contractor_id,
        planName: row.plan_name || 'desconocido',
        monthlyUsd: Math.round(monthlyUsd * 100) / 100,
        status: row.status,
        isManual,
        billingSource,
        stripeSubscriptionId: match?.id ?? null,
        stripeMonthlyUsd: match?.monthlyUsd ?? null,
        needsReview: dupes.reviewIds.has(row.contractor_id),
        email: row.email,
        businessName: row.business_name,
      });

      out.mrrUsd += monthlyUsd;
      out.activeSubscriptions += 1;
      if (isManual) {
        out.manualMrrUsd += monthlyUsd;
        out.manualSubscriptions += 1;
      }
      if (billingSource === 'stripe') {
        out.stripeMrrUsd += monthlyUsd;
        out.stripeSubscriptions += 1;
      } else if (billingSource === 'manual') {
        out.unverifiedMrrUsd += monthlyUsd;
        out.unverifiedSubscriptions += 1;
      }

      // Movimientos del mes, del MISMO conjunto de líneas.
      if (row.created_at && new Date(row.created_at) >= monthStart) {
        out.movements.newCount += 1;
        out.movements.newMrrUsd += monthlyUsd;
      }
      if (row.cancel_at_period_end === true) {
        out.movements.atRiskCount += 1;
        out.movements.atRiskMrrUsd += monthlyUsd;
      }

      const planKey = isManual ? `${row.plan_name} (Manual / Zelle)` : row.plan_name || 'desconocido';
      const acc = planMap.get(planKey) || { mrr: 0, subs: 0, isManual };
      acc.mrr += monthlyUsd;
      acc.subs += 1;
      planMap.set(planKey, acc);
    }

    // Churn del mes: cuentas canceladas dentro del mes, valoradas al mismo precio.
    for (const row of rows) {
      if (ACTIVE_STATUSES.includes(row.status)) continue;
      if (!row.canceled_at || new Date(row.canceled_at) < monthStart) continue;
      const monthlyUsd = priceCentsFor(row) / 100;
      if (monthlyUsd <= 0) continue; // cancelar una cuenta gratis no es churn de ingreso
      out.movements.churnedCount += 1;
      out.movements.churnedMrrUsd += monthlyUsd;
    }

    // Suscripciones que existen en Stripe y no tienen contraparte local: no se
    // suman al MRR (no son de LeadPrime o están sin vincular) pero se REPORTAN,
    // porque un cobro invisible es tan malo como un ingreso sin origen.
    if (stripeInfo.available) {
      for (const s of stripeInfo.subs) {
        if (matchedStripeIds.has(s.id)) continue;
        out.stripeOrphans.push({
          subscriptionId: s.id,
          email: s.email,
          monthlyUsd: s.monthlyUsd,
          product: s.product,
        });
      }
    }

    // Grupos de cuentas de pago que coinciden — se suman todas, decide el dueño.
    out.reviewGroups = dupes.reviewGroups.map((g) => ({
      contractorIds: g.ids,
      emails: g.ids.map((id) => byContractor.get(id)?.email ?? id),
    }));

    const r2 = (n: number) => Math.round(n * 100) / 100;
    out.mrrUsd = r2(out.mrrUsd);
    out.manualMrrUsd = r2(out.manualMrrUsd);
    out.stripeMrrUsd = r2(out.stripeMrrUsd);
    out.unverifiedMrrUsd = r2(out.unverifiedMrrUsd);
    out.arrUsd = r2(out.mrrUsd * 12);
    out.movements.newMrrUsd = r2(out.movements.newMrrUsd);
    out.movements.churnedMrrUsd = r2(out.movements.churnedMrrUsd);
    out.movements.atRiskMrrUsd = r2(out.movements.atRiskMrrUsd);
    out.movements.netNewMrrUsd = r2(out.movements.newMrrUsd - out.movements.churnedMrrUsd);
    const denom = out.activeSubscriptions + out.movements.churnedCount;
    out.movements.logoChurnRatePct =
      denom > 0 ? Math.round((out.movements.churnedCount / denom) * 1000) / 10 : null;

    out.byPlan = Array.from(planMap.entries())
      .map(([plan, v]) => ({
        plan,
        mrrUsd: r2(v.mrr),
        subscriptions: v.subs,
        isManual: v.isManual,
      }))
      .sort((a, b) => b.mrrUsd - a.mrrUsd);
    out.available = true;
  } catch (err: any) {
    out.note = `No se pudo calcular el MRR: ${err.message}`;
  }

  return out;
}
