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
 * Ahora ambas leen de aquí, y el precio sale del CATÁLOGO del plan
 * (plan_definitions.monthly_price_cents), nunca de una constante:
 * pay_as_you_go tiene precio 0 → aporta $0, que es la verdad.
 *
 * INGRESO MANUAL (Zelle): las suscripciones cobradas fuera de Stripe SÍ son
 * ingreso real y cuentan como MRR — decisión del dueño. El contratista no pudo
 * pagar por el portal ACH y paga por transferencia; es temporal y a propósito,
 * pendiente de migrar a cobro automático. Se marca con `isManual` para que la
 * UI lo etiquete ("Manual / Zelle") y no parezca un error del sistema, pero
 * NUNCA se excluye de ningún cálculo.
 */
import { Pool } from 'pg';
import { findDuplicateAccounts } from '@shared/duplicate-accounts';

export interface MrrLine {
  contractorId: string;
  planName: string;
  /** Precio mensual real en USD: catálogo del plan, o el acordado si es manual. */
  monthlyUsd: number;
  status: string;
  /** true = cobrado fuera de Stripe (Zelle/transferencia). Ingreso real. */
  isManual: boolean;
  /** true = la cuenta parece duplicada de otra (se excluye de los conteos). */
  isDuplicate: boolean;
  email: string | null;
  businessName: string | null;
}

export interface RecurringRevenue {
  available: boolean;
  note?: string;
  /** MRR total en USD (Stripe + manual). */
  mrrUsd: number;
  arrUsd: number;
  /** Suscripciones que REALMENTE aportan (precio > 0, sin duplicados ni demo). */
  activeSubscriptions: number;
  /** Parte del MRR cobrada fuera de Stripe — para la etiqueta de la UI. */
  manualMrrUsd: number;
  manualSubscriptions: number;
  byPlan: Array<{ plan: string; mrrUsd: number; subscriptions: number; isManual: boolean }>;
  lines: MrlLineExport[];
  /** Cuentas descartadas y por qué (transparencia: nada desaparece en silencio). */
  excluded: Array<{ contractorId: string; reason: string; email: string | null }>;
}

type MrlLineExport = MrrLine;

const ACTIVE_STATUSES = ['active', 'trialing'];

/** Cuenta demo de App Review: nunca es ingreso. */
function isDemoAccount(row: any): boolean {
  const email = String(row.email || '').toLowerCase();
  const demoId = process.env.DEMO_CONTRACTOR_ID;
  if (demoId && row.contractor_id === demoId) return true;
  return email.includes('apple-review+') || email.includes('@leadprime.demo');
}

/**
 * Marca como duplicadas las cuentas que comparten teléfono (o nombre+negocio)
 * con otra. Se conserva como "principal" la de MAYOR precio de plan — si un
 * dueño tiene una Pro y una Pay-As-You-Go, la que cuenta es la Pro.
 * NO borra ni fusiona nada: solo etiqueta. Fusionar es decisión del dueño.
 *
 * La regla vive en shared/duplicate-accounts.ts para que la tabla de usuarios
 * del admin marque exactamente las mismas cuentas que aquí se excluyen del MRR.
 */
function markDuplicates(rows: any[]): Set<string> {
  return findDuplicateAccounts(
    rows.map((r) => ({
      id: r.contractor_id,
      phone: r.phone,
      name: r.name,
      businessName: r.business_name,
      weight: Number(r.plan_price_cents || 0),
    }))
  ).duplicateIds;
}

/**
 * Calcula el ingreso recurrente real. Una sola consulta, una sola verdad.
 */
export async function getRecurringRevenue(pool: Pool): Promise<RecurringRevenue> {
  const out: RecurringRevenue = {
    available: false,
    mrrUsd: 0,
    arrUsd: 0,
    activeSubscriptions: 0,
    manualMrrUsd: 0,
    manualSubscriptions: 0,
    byPlan: [],
    lines: [],
    excluded: [],
  };

  try {
    const res = await pool.query(
      `SELECT s.contractor_id,
              s.plan_name,
              s.status,
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
      [ACTIVE_STATUSES]
    );

    const duplicates = markDuplicates(res.rows);
    const planMap = new Map<string, { mrr: number; subs: number; isManual: boolean }>();

    for (const row of res.rows) {
      const isManual = row.billing_mode === 'external_zelle' && row.config_status === 'applied';
      // Manual: el precio acordado manda (el catálogo puede no reflejar la
      // negociación). Stripe: precio de catálogo del plan.
      const cents = isManual
        ? Number(row.agreed_price_cents || row.plan_price_cents || 0)
        : Number(row.plan_price_cents || 0);
      const monthlyUsd = cents / 100;

      if (isDemoAccount(row)) {
        out.excluded.push({ contractorId: row.contractor_id, reason: 'cuenta demo', email: row.email });
        continue;
      }
      if (duplicates.has(row.contractor_id)) {
        out.excluded.push({ contractorId: row.contractor_id, reason: 'cuenta duplicada del mismo dueño', email: row.email });
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

      out.lines.push({
        contractorId: row.contractor_id,
        planName: row.plan_name || 'desconocido',
        monthlyUsd: Math.round(monthlyUsd * 100) / 100,
        status: row.status,
        isManual,
        isDuplicate: false,
        email: row.email,
        businessName: row.business_name,
      });

      out.mrrUsd += monthlyUsd;
      out.activeSubscriptions += 1;
      if (isManual) {
        out.manualMrrUsd += monthlyUsd;
        out.manualSubscriptions += 1;
      }

      const planKey = isManual ? `${row.plan_name} (Manual / Zelle)` : row.plan_name || 'desconocido';
      const acc = planMap.get(planKey) || { mrr: 0, subs: 0, isManual };
      acc.mrr += monthlyUsd;
      acc.subs += 1;
      planMap.set(planKey, acc);
    }

    out.mrrUsd = Math.round(out.mrrUsd * 100) / 100;
    out.manualMrrUsd = Math.round(out.manualMrrUsd * 100) / 100;
    out.arrUsd = Math.round(out.mrrUsd * 12 * 100) / 100;
    out.byPlan = Array.from(planMap.entries())
      .map(([plan, v]) => ({
        plan,
        mrrUsd: Math.round(v.mrr * 100) / 100,
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
