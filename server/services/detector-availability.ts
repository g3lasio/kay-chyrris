/**
 * detector-availability.ts — separa "no disponible" de "está fallando".
 *
 * POR QUÉ EXISTE (auditoría visual ago 2026): la tarjeta "Detector notes"
 * mezclaba tres cosas muy distintas en la misma lista gris:
 *
 *   1. pg_stat_statements no está habilitado en Neon  → función OPCIONAL que
 *      nunca se activó. No es un fallo.
 *   2. billing_retry_queue no existe                  → tabla que LeadPrime no
 *      creó nunca. El detector no aplica.
 *   3. Neon API 403 (requiere plan Scale)             → endpoint de pago que
 *      nuestro plan no incluye.
 *
 * Ninguna de las tres es un problema que se pueda "arreglar" revisando el
 * sistema: son capacidades ausentes. Mezcladas con errores reales (una query
 * que revienta, un proveedor que devuelve 500) hacen ruido y entrenan al ojo a
 * ignorar la lista entera — justo la lista donde aparecerían los fallos de
 * verdad.
 *
 * Aquí se clasifica cada nota en:
 *   · 'unavailable' → capacidad ausente. Va a una sección gris aparte, con el
 *                     paso concreto para habilitarla si se quiere.
 *   · 'issue'       → algo se rompió. Se queda en "Detector notes".
 *
 * La clasificación se hace por patrón sobre el texto de la nota porque los
 * detectores ya emiten mensajes consistentes ("<detector>: <mensaje>"); así no
 * hay que reescribir los ~40 sitios que llaman a notes.push().
 */

export type DetectorNoteKind = 'unavailable' | 'issue';

export interface ClassifiedNote {
  /** Prefijo del detector: "hotQueries", "neon", "retryQueueBacklog", … */
  detector: string;
  /** Texto sin el prefijo. */
  message: string;
  kind: DetectorNoteKind;
  /** Qué haría falta para habilitarlo. Solo se llena en 'unavailable'. */
  enableWith?: string;
}

/**
 * Reglas ordenadas: la primera que hace match manda. Cada una lleva el paso
 * real para habilitar la capacidad — una nota gris sin salida es igual de
 * inútil que una roja falsa.
 */
const UNAVAILABLE_RULES: Array<{ test: RegExp; enableWith?: string }> = [
  {
    test: /pg_stat_statements/i,
    enableWith:
      'Opcional: en Neon → Settings → Extensions, habilitar pg_stat_statements (CREATE EXTENSION + shared_preload_libraries). Sirve para ver qué query martillea la DB.',
  },
  {
    test: /billing_retry_queue|retry queue table|queue table not present/i,
    enableWith:
      'LeadPrime nunca creó esa tabla. El detector queda inactivo hasta que exista una cola de reintentos real; hoy los reintentos los maneja Stripe.',
  },
  {
    // Neon consumption API: 403/402 = plan-gated, no un fallo nuestro.
    test: /neon api (402|403)|requires? .*(scale|business) plan|not available on your plan/i,
    enableWith:
      'La API de consumo de Neon solo está en plan Scale. Sin ella el costo de compute se estima por cadencia de workers (ver "Riesgo de compute"), no por $ exacto.',
  },
  {
    test: /(NEON_API_KEY|NEON_PROJECT_ID|SAM_GOV_PROXY_URL|[A-Z0-9_]{6,}) (?:environment variable )?not set/,
    enableWith: 'Falta la variable de entorno en Railway. Al agregarla el detector se enciende solo.',
  },
  {
    test: /extension not enabled|not installed|no está habilitad/i,
  },
  {
    test: /table (?:\/column )?(?:unavailable|not present|does not exist)|table\/column unavailable|not available$|no disponible$|not accessible$/i,
  },
  {
    // "byProduct: usage_events not available", "billed: usage_events not available"
    test: /\b\w+ not available\b/i,
  },
];

/** Detectores cuya ausencia SIEMPRE es capacidad ausente, diga lo que diga. */
const ALWAYS_OPTIONAL = new Set(['hotQueries', 'retryQueueBacklog']);

export function classifyNote(raw: string): ClassifiedNote {
  const text = String(raw || '').trim();
  const sep = text.indexOf(':');
  const detector = sep > 0 && sep < 40 ? text.slice(0, sep).trim() : 'general';
  const message = sep > 0 && sep < 40 ? text.slice(sep + 1).trim() : text;

  for (const rule of UNAVAILABLE_RULES) {
    if (rule.test.test(text)) {
      return { detector, message, kind: 'unavailable', enableWith: rule.enableWith };
    }
  }
  if (ALWAYS_OPTIONAL.has(detector)) {
    return { detector, message, kind: 'unavailable' };
  }
  return { detector, message, kind: 'issue' };
}

/**
 * Parte una lista de notas en las dos cubetas. `issues` conserva el texto
 * completo original (es lo que ya se mostraba); `unavailable` va estructurado
 * porque la UI lo pinta distinto.
 */
export function splitNotes(notes: string[]): {
  issues: string[];
  unavailable: ClassifiedNote[];
} {
  const issues: string[] = [];
  const unavailable: ClassifiedNote[] = [];
  const seen = new Set<string>();

  for (const raw of notes || []) {
    const text = String(raw || '').trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    const c = classifyNote(text);
    if (c.kind === 'unavailable') unavailable.push(c);
    else issues.push(text);
  }
  return { issues, unavailable };
}
