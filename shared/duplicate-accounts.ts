/**
 * duplicate-accounts.ts — REGLA ÚNICA para detectar cuentas del mismo dueño.
 *
 * Vive en shared/ porque la usan los dos lados y no pueden discrepar: el
 * servidor la aplica para excluir duplicados del MRR (leadprime-mrr.ts) y la
 * tabla de usuarios la aplica para marcarlos visiblemente. Si cada uno tuviera
 * su propia versión, el panel diría "duplicado" en una pantalla y contaría la
 * cuenta como buena en otra.
 *
 * QUÉ HACE Y QUÉ NO:
 *   · Detecta y ETIQUETA. Nada más.
 *   · NO borra, NO fusiona, NO modifica ninguna fila. Unir dos cuentas de un
 *     mismo cliente es decisión del dueño del negocio, no del panel.
 *
 * Criterio (deliberadamente conservador, para no marcar falsos positivos):
 *   1. Mismo teléfono, comparando los ÚLTIMOS 10 DÍGITOS — el mismo número
 *      escrito como +1 (555) 010-2030 y 5550102030 debe coincidir.
 *   2. Si no hay teléfono: mismo nombre de negocio (o nombre de persona)
 *      normalizado.
 * Dos cuentas que solo comparten dominio de correo NO se marcan: en una
 * empresa con varios contratistas eso sería normal.
 */

export interface DuplicateCandidate {
  id: string;
  phone?: string | null;
  name?: string | null;
  businessName?: string | null;
  /** Peso para elegir la principal: se conserva la de mayor valor. */
  weight?: number;
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

export interface DuplicateGroups {
  /** ids marcados como duplicados (todos menos la principal de cada grupo). */
  duplicateIds: Set<string>;
  /** id duplicado → id de la cuenta principal, para poder señalar cuál es cuál. */
  primaryOf: Map<string, string>;
  /** id principal → cuántas cuentas más comparten su clave. */
  groupSize: Map<string, number>;
}

/**
 * Agrupa y marca. La cuenta PRINCIPAL de cada grupo es la de mayor `weight`
 * (precio del plan en el servidor, saldo/plan en la tabla); las demás quedan
 * marcadas como duplicadas.
 */
export function findDuplicateAccounts(candidates: DuplicateCandidate[]): DuplicateGroups {
  const groups = new Map<string, DuplicateCandidate[]>();
  for (const c of candidates) {
    const key = accountGroupKey(c);
    if (!key) continue;
    const list = groups.get(key);
    if (list) list.push(c);
    else groups.set(key, [c]);
  }

  const duplicateIds = new Set<string>();
  const primaryOf = new Map<string, string>();
  const groupSize = new Map<string, number>();

  for (const group of Array.from(groups.values())) {
    if (group.length < 2) continue;
    const sorted = [...group].sort((a, b) => (b.weight ?? 0) - (a.weight ?? 0));
    const primary = sorted[0];
    groupSize.set(primary.id, group.length);
    for (const dup of sorted.slice(1)) {
      duplicateIds.add(dup.id);
      primaryOf.set(dup.id, primary.id);
    }
  }

  return { duplicateIds, primaryOf, groupSize };
}
