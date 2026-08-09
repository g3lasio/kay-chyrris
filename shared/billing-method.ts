/**
 * billing-method.ts — CÓMO se cobra una suscripción, y si eso es ingreso.
 *
 * REGLA DEL DUEÑO (ago 2026): lo que decide si una suscripción cuenta como MRR
 * es el MÉTODO DE COBRO, no si la cuenta parece duplicada.
 *
 *   · stripe   → cobro automático con tarjeta      → CUENTA
 *   · ach      → cobro automático por ACH (Stripe) → CUENTA
 *   · zelle    → transferencia manual              → CUENTA (ingreso real)
 *   · courtesy → cortesía, nunca se cobra          → NO CUENTA, jamás
 *
 * QUÉ SUSTITUYE: antes se excluían cuentas por "parecer duplicadas" (mismo
 * teléfono o nombre). Ese criterio sacó del MRR una suscripción de pago REAL de
 * $249/mes por coincidir de nombre con otra cuenta. El método de cobro es un
 * dato explícito y verificable; el parecido de nombres es una suposición.
 *
 * Las cuentas de cortesía SÍ se muestran, con su total aparte, para que se vea
 * cuánto valor se está regalando. Simplemente no suman al MRR ni al ARR.
 */

export type BillingMethod = 'stripe' | 'ach' | 'zelle' | 'courtesy' | 'unknown';

/**
 * Valores tal cual se guardan en contractor_subscription_config.billing_mode.
 * Los tres primeros son los históricos; se conservan como alias porque las
 * filas existentes en producción los usan y NO se reescriben.
 */
const LEGACY_ALIASES: Record<string, BillingMethod> = {
  stripe_ach: 'ach',          // el flujo de checkout ACH de Stripe
  comp_no_charge: 'courtesy', // cortesía: nunca se cobró nada
  external_zelle: 'zelle',    // transferencia fuera de Stripe
};

export function normalizeBillingMethod(raw: string | null | undefined): BillingMethod {
  const v = String(raw ?? '').trim().toLowerCase();
  if (!v) return 'unknown';
  if (LEGACY_ALIASES[v]) return LEGACY_ALIASES[v];
  if (v === 'stripe' || v === 'ach' || v === 'zelle' || v === 'courtesy') return v;
  // 'comp', 'cortesia', 'free'… cualquier variante de regalo es cortesía.
  if (/comp|cortes|free|gift/.test(v)) return 'courtesy';
  if (/zelle|transfer/.test(v)) return 'zelle';
  if (/ach/.test(v)) return 'ach';
  if (/stripe|card|tarjeta/.test(v)) return 'stripe';
  return 'unknown';
}

/**
 * ¿Este método produce ingreso recurrente?
 *
 * Cortesía NUNCA, sin excepción. 'unknown' sí cuenta: una suscripción activa
 * sin método registrado es lo más probable que se esté cobrando por Stripe, y
 * borrar ingreso por falta de una etiqueta sería repetir el error anterior —
 * el panel la marca para que alguien le ponga el método correcto.
 */
export function countsAsMrr(method: BillingMethod): boolean {
  return method !== 'courtesy';
}

/** Etiqueta corta para la UI. */
export const BILLING_METHOD_LABEL: Record<BillingMethod, string> = {
  stripe: 'Stripe',
  ach: 'ACH',
  zelle: 'Zelle',
  courtesy: 'Cortesía',
  unknown: 'Sin método',
};

/** Las cuatro opciones seleccionables por el admin, en orden de uso. */
export const BILLING_METHOD_OPTIONS: Array<{ value: BillingMethod; label: string; hint: string }> = [
  { value: 'stripe', label: 'Stripe (tarjeta)', hint: 'Cobro automático con tarjeta. Cuenta como MRR.' },
  { value: 'ach', label: 'ACH (Stripe)', hint: 'Cobro automático por transferencia bancaria. Cuenta como MRR.' },
  { value: 'zelle', label: 'Zelle / transferencia manual', hint: 'Se cobra a mano fuera de Stripe. Cuenta como MRR: es ingreso real.' },
  { value: 'courtesy', label: 'Cortesía (sin cargo)', hint: 'No se cobra nada. NUNCA cuenta como MRR ni como ARR.' },
];
