/**
 * api-key-scope.ts — distinguir "la key no sirve" de "la key no puede hacer ESTO".
 *
 * EL ERROR QUE ESTO CORRIGE (ago 2026): la sonda de Resend pedía
 * `GET /domains` —una operación de LECTURA— con una API key restringida a
 * ENVÍO. Resend respondía, correctamente:
 *
 *     401 { "name": "restricted_api_key",
 *           "message": "This API key is restricted to only send emails" }
 *
 * Ese mensaje NO dice que la key no pueda enviar. Dice que SOLO puede enviar.
 * O sea: la credencial estaba perfecta y el detector estaba mal. Aun así el
 * panel declaró "⛔ CANAL DE ALERTAS CAÍDO", acumuló cientos de fallos
 * consecutivos, y el consejo que daba —"genera una key con permiso de envío"—
 * era exactamente al revés de la realidad. Todo ese ruido salió de leer un
 * error de ALCANCE como si fuera una caída.
 *
 * El mismo error estaba en el detector de gasto: consulta las Admin/Billing API
 * de Anthropic y OpenAI con la key de inferencia, recibe 401 y concluye "API key
 * RECHAZADA — el servicio está caído para los usuarios". Falso: la inferencia
 * puede estar funcionando perfectamente; lo único que no se puede leer es la
 * facturación.
 *
 * REGLA: un 401/403 que identifica un problema de ALCANCE (scope/permiso) es
 * una capacidad ausente, no una caída. Solo un rechazo de la credencial en sí
 * (inválida, revocada, expirada) es un fallo real.
 */

/** Cómo interpretar un 401/403 de un proveedor. */
export type KeyVerdict =
  /** La credencial es válida; el endpoint pedido está fuera de su alcance. */
  | 'scope_limited'
  /** La credencial fue rechazada de verdad: inválida, revocada o expirada. */
  | 'rejected';

/**
 * Señales de "alcance restringido" en el cuerpo del error. Se buscan como texto
 * porque cada proveedor las nombra distinto y ninguno usa un código estándar.
 */
const SCOPE_PATTERNS: RegExp[] = [
  // Resend: la key es de envío y se pidió lectura (o viceversa).
  /restricted_api_key/i,
  /restricted to only send/i,
  // Anthropic / OpenAI: endpoints de Admin/Billing con una key de inferencia.
  /admin api key/i,
  /requires? an? admin/i,
  /insufficient (permissions?|scope)/i,
  /missing scopes?/i,
  /not allowed to (access|use|read)/i,
  /you do not have permission to (access|read)/i,
  /this endpoint (requires|is restricted)/i,
  /scope/i,
];

/** Señales inequívocas de credencial rechazada. Ganan sobre las de alcance. */
const REJECTED_PATTERNS: RegExp[] = [
  /invalid[_ ]?api[_ ]?key/i,
  /incorrect api key/i,
  /api key (not found|expired|revoked|disabled)/i,
  /authentication[_ ]?error/i,
  /unauthorized: invalid/i,
];

/**
 * Clasifica una respuesta 401/403. `body` es el cuerpo del error tal cual.
 *
 * Ante la duda devuelve 'rejected': un fallo real silenciado es peor que una
 * alerta de más. La excepción son las señales de alcance explícitas, que sí son
 * inequívocas.
 */
export function classifyAuthFailure(status: number, body: string | null | undefined): KeyVerdict {
  const text = String(body ?? '');
  if (REJECTED_PATTERNS.some((re) => re.test(text))) return 'rejected';
  if (SCOPE_PATTERNS.some((re) => re.test(text))) return 'scope_limited';
  // Un 403 desnudo suele ser permiso; un 401 desnudo suele ser credencial.
  return status === 403 ? 'scope_limited' : 'rejected';
}

/** ¿Este 401/403 significa "la key sirve, pero no para esto"? */
export function isScopeLimited(status: number, body: string | null | undefined): boolean {
  if (status !== 401 && status !== 403) return false;
  return classifyAuthFailure(status, body) === 'scope_limited';
}

/**
 * Texto para el panel cuando la key está acotada. Explica que NO hay nada roto,
 * porque el mensaje anterior mandaba al dueño a rotar una credencial que
 * funcionaba.
 */
export function scopeLimitedNote(provider: string, capability: string): string {
  return (
    `La API key de ${provider} es válida pero está restringida: no tiene alcance para ${capability}. ` +
    `NO es una caída y no hay que rotar nada — lo único que falta es ese dato en el panel. ` +
    `Si se quiere ver, hay que ampliar los permisos de la key en el proveedor.`
  );
}
