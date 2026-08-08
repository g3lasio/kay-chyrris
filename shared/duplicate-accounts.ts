/**
 * duplicate-accounts.ts — REGLA ÚNICA para detectar cuentas del mismo dueño.
 *
 * Vive en shared/ porque la usan los dos lados y no pueden discrepar: el
 * servidor la aplica al calcular el MRR y la tabla de usuarios la aplica para
 * marcar las cuentas. Si cada uno tuviera su versión, el panel diría
 * "duplicada" en una pantalla y contaría la cuenta como buena en otra.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * REGLA DE ORO (decisión del dueño, ago 2026): NUNCA se excluye del MRR una
 * cuenta con suscripción de PAGO activa.
 *
 * La versión anterior elegía una "principal" por precio de plan y descartaba el
 * resto del grupo. Con eso sacó del MRR a info@owlfenc.com — network_elite
 * ACTIVA de $249/mes con $996 de ingreso acumulado — solo porque coincidía de
 * nombre con otra cuenta de pago. Elegir cuál sobrevive por coincidencia de
 * nombre es arbitrario y borra dinero real del tablero.
 *
 * Ahora:
 *   · Solo se agrupan como duplicadas las cuentas SIN plan de pago. Excluirlas
 *     no mueve un centavo (aportan $0), así que es una operación segura.
 *   · Si dos cuentas DE PAGO coinciden, se marcan para revisión HUMANA y se
 *     suman las dos. El panel avisa; el dueño decide. El código no descarta.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * QUÉ HACE Y QUÉ NO: detecta y ETIQUETA. No borra, no fusiona, no modifica
 * ninguna fila. Unir dos cuentas de un mismo cliente es decisión del dueño.
 *
 * Criterio de agrupación (conservador, para no marcar falsos positivos):
 *   1. Mismo teléfono, comparando los ÚLTIMOS 10 DÍGITOS — el mismo número
 *      escrito como +1 (555) 010-2030 y 5550102030 debe coincidir.
 *   2. Si no hay teléfono: mismo nombre de negocio (o de persona) normalizado.
 * Compartir dominio de correo NO cuenta: en una empresa con varios contratistas
 * eso es normal.
 */

export interface DuplicateCandidate {
  id: string;
  phone?: string | null;
  name?: string | null;
  businessName?: string | null;
  /**
   * Precio mensual del plan en centavos. > 0 significa suscripción de PAGO:
   * esa cuenta es intocable para el MRR.
   */
  monthlyPriceCents?: number;
}

export interface DuplicateGroups {
  /**
   * Cuentas a excluir de los conteos. SOLO contiene cuentas sin plan de pago —
   * por construcción nunca sale de aquí un dólar de ingreso.
   */
  duplicateIds: Set<string>;
  /**
   * Cuentas DE PAGO que coinciden con otra cuenta de pago. NO se excluyen: se
   * suman completas y se marcan para que una persona decida.
   */
  reviewIds: Set<string>;
  /** id duplicado → id de la cuenta principal, para señalar cuál es cuál. */
  primaryOf: Map<string, string>;
  /** id principal → cuántas cuentas comparten su clave. */
  groupSize: Map<string, number>;
  /** Grupos con 2+ cuentas de pago, para reportarlos explícitamente. */
  reviewGroups: Array<{ key: string; ids: string[] }>;
}

/** Últimos 10 dígitos del teléfono, o null si no hay suficientes. */
export function phoneKey(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = String(phone).replace(/\D/g, '');
  return digits.length >= 10 ? digits.slice(-10) : null;
}

/** Clave de agrupación: teléfono si lo hay, si no nombre de negocio/persona. */
export function accountGroupKey(c: DuplicateCandidate): string | null {
  const byPhone = phoneKey(c.phone);
  if (byPhone) return `p:${byPhone}`;
  const name = (c.businessName || c.name || '').trim().toLowerCase();
  return name ? `n:${name}` : null;
}

function isPaid(c: DuplicateCandidate): boolean {
  return Number(c.monthlyPriceCents || 0) > 0;
}

export function findDuplicateAccounts(candidates: DuplicateCandidate[]): DuplicateGroups {
  const duplicateIds = new Set<string>();
  const reviewIds = new Set<string>();
  const primaryOf = new Map<string, string>();
  const groupSize = new Map<string, number>();
  const reviewGroups: Array<{ key: string; ids: string[] }> = [];

  // 1) UNA entrada por id. La consulta del MRR hace JOIN con subscriptions,
  //    company_profiles y contractor_subscription_config: una cuenta con dos
  //    filas de suscripción sale DUPLICADA en el resultado y, sin esto, se
  //    marcaba a sí misma como duplicada de sí misma. Eso fue exactamente lo
  //    que le pasó a MORENITA Management, que no comparte nombre con nadie.
  //    Se conserva la variante de mayor precio por si las filas difieren.
  const byId = new Map<string, DuplicateCandidate>();
  for (const c of candidates) {
    const prev = byId.get(c.id);
    if (!prev || Number(c.monthlyPriceCents || 0) > Number(prev.monthlyPriceCents || 0)) {
      byId.set(c.id, c);
    }
  }

  // 2) Agrupar por clave de contacto.
  const groups = new Map<string, DuplicateCandidate[]>();
  for (const c of Array.from(byId.values())) {
    const key = accountGroupKey(c);
    if (!key) continue;
    const list = groups.get(key);
    if (list) list.push(c);
    else groups.set(key, [c]);
  }

  for (const [key, group] of Array.from(groups.entries())) {
    if (group.length < 2) continue;

    const paid = group.filter(isPaid).sort(
      (a, b) => Number(b.monthlyPriceCents || 0) - Number(a.monthlyPriceCents || 0)
    );
    const unpaid = group.filter((c) => !isPaid(c));

    // La principal es la cuenta de pago más cara; si ninguna paga, la primera.
    const primary = paid[0] ?? group[0];
    groupSize.set(primary.id, group.length);

    if (paid.length >= 2) {
      // Dos cuentas de pago con el mismo contacto: NINGUNA se descarta. Se
      // suman las dos y se avisa para que una persona lo resuelva.
      for (const p of paid) reviewIds.add(p.id);
      reviewGroups.push({ key, ids: paid.map((p) => p.id) });
    }

    // Solo las cuentas SIN plan de pago se excluyen de los conteos: aportan $0,
    // así que sacarlas no puede borrar ingreso. La principal nunca se excluye a
    // sí misma — si el grupo es todo gratis, la principal ES una de las gratis.
    for (const u of unpaid) {
      if (u.id === primary.id) continue;
      duplicateIds.add(u.id);
      primaryOf.set(u.id, primary.id);
    }
  }

  return { duplicateIds, reviewIds, primaryOf, groupSize, reviewGroups };
}
