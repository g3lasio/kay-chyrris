/**
 * partner-referral-health.ts — vigilancia del programa de socios.
 *
 * POR QUÉ EXISTE: el programa llevaba desde su lanzamiento con CERO
 * atribuciones para los TRES socios, y nadie se enteró hasta que un socio se
 * quejó. El panel mostraba "Referidos 0" como si fuera un dato normal —
 * indistinguible de "el socio todavía no ha compartido su link".
 *
 * La causa era una colisión de rutas: el link /r/CODIGO lo atendía ReviewPilot
 * y devolvía 404. Ese fallo es INVISIBLE desde Kai, porque Kai solo ve su
 * propia tabla de atribuciones, que simplemente estaba vacía.
 *
 * Estos detectores hacen visible justo eso:
 *   1. Socios activos sin NINGÚN clic registrado en su link. Cero atribuciones
 *      puede ser normal; cero clics durante días con socios activos significa
 *      que el link no está llegando o no está funcionando.
 *   2. Clics que NO resolvieron a un socio — el síntoma exacto del 404.
 *   3. La ruta del link corto respondiendo 404 (se comprueba de verdad, con un
 *      GET real al link de un socio activo).
 *   4. Atribuciones capturadas en LeadPrime que Kai nunca confirmó.
 *
 * READ-ONLY: no escribe nada, ni en Kai ni en LeadPrime.
 */
import { Pool } from 'pg';
import { isScopeLimited } from './api-key-scope';

export interface PartnerReferralHealth {
  available: boolean;
  note?: string;
  /** Socios activos, para dar contexto a los ceros. */
  activePartners: number;
  /** Socios activos con 0 referidos Y 0 clics: el patrón de "link roto". */
  silentPartners: Array<{ name: string; code: string; attributions: number; clicks: number }>;
  /** Clics que no resolvieron ningún socio (código inválido o ruta rota). */
  unresolvedClicks7d: number;
  /** Capturadas en LeadPrime pero sin confirmar en Kai. */
  pendingAttributions: number;
  /** Comprobación real del link corto: GET y código HTTP. */
  linkCheck: {
    checked: boolean;
    url?: string;
    status?: number;
    ok: boolean;
    note?: string;
  };
  /**
   * Estado del canal de correo. Importa más de lo que parece: el portal de
   * socios entra con un código de un solo uso POR CORREO. Con el correo caído,
   * un socio no puede entrar a ver sus referidos aunque la atribución funcione
   * perfectamente — y las invitaciones tampoco salen.
   */
  emailChannel: { ok: boolean; note?: string };
  /** Resumen accionable para la UI: null = todo bien. */
  verdict: { level: 'ok' | 'warn' | 'alarm'; reason: string } | null;
}

/** Días sin clics tras los cuales un socio activo se considera "mudo". */
const SILENT_DAYS = Number(process.env.PARTNER_SILENT_DAYS || 7);

export async function getPartnerReferralHealth(
  kaiPool: Pool,
  leadPrimePool: Pool
): Promise<PartnerReferralHealth> {
  const out: PartnerReferralHealth = {
    available: false,
    activePartners: 0,
    silentPartners: [],
    unresolvedClicks7d: 0,
    pendingAttributions: 0,
    linkCheck: { checked: false, ok: true },
    emailChannel: { ok: true },
    verdict: null,
  };

  try {
    // Socios activos + sus atribuciones (tablas de Kai).
    const partners = await kaiPool.query(
      `SELECT p.id, p.name, p.referral_code,
              COUNT(a.id)::int AS attributions
         FROM referral_partners p
         LEFT JOIN referral_attributions a ON a.partner_id = p.id
        WHERE p.status = 'active'
        GROUP BY p.id, p.name, p.referral_code`
    );
    out.activePartners = partners.rows.length;

    // Clics (tabla de LeadPrime — migración 284). Si aún no existe, se degrada
    // sin romper: el resto de los detectores siguen sirviendo.
    let clicksByCode = new Map<string, number>();
    try {
      const clicks = await leadPrimePool.query(
        `SELECT UPPER(referral_code) AS code, COUNT(*)::int AS n
           FROM referral_link_clicks
          WHERE created_at >= NOW() - INTERVAL '${SILENT_DAYS} days'
          GROUP BY UPPER(referral_code)`
      );
      clicksByCode = new Map(clicks.rows.map((r: any) => [r.code, r.n]));

      const unresolved = await leadPrimePool.query(
        `SELECT COUNT(*)::int AS n FROM referral_link_clicks
          WHERE resolved = false AND created_at >= NOW() - INTERVAL '7 days'`
      );
      out.unresolvedClicks7d = unresolved.rows[0]?.n ?? 0;
    } catch (err: any) {
      out.note = `clics no disponibles (${err.code === '42P01' ? 'falta la migración 284 en LeadPrime' : err.message})`;
    }

    try {
      const pending = await leadPrimePool.query(
        `SELECT COUNT(*)::int AS n FROM contractors
          WHERE referral_code IS NOT NULL AND referral_reported_at IS NULL`
      );
      out.pendingAttributions = pending.rows[0]?.n ?? 0;
    } catch {
      /* columna aún sin migrar: no es un fallo */
    }

    for (const p of partners.rows) {
      const code = String(p.referral_code || '').toUpperCase();
      const clicks = clicksByCode.get(code) ?? 0;
      const attributions = Number(p.attributions || 0);
      if (attributions === 0 && clicks === 0) {
        out.silentPartners.push({ name: p.name, code: p.referral_code, attributions, clicks });
      }
    }

    // Comprobación REAL del link: si el redirect está roto, esto lo ve. Es la
    // única forma de distinguir "nadie hizo clic" de "el clic no funciona".
    const sample = partners.rows[0];
    if (sample) {
      const { buildShortReferralLink } = await import('../partner/commission-engine');
      const url = buildShortReferralLink(sample.referral_code);
      out.linkCheck = await probeReferralLink(url);
    }

    out.emailChannel = await checkEmailChannel(kaiPool);
    out.verdict = buildVerdict(out);
    out.available = true;
  } catch (err: any) {
    out.note = `No se pudo evaluar el programa de socios: ${err.message}`;
  }

  return out;
}

/**
 * GET al link corto SIN seguir el redirect: un 302 es exactamente lo que se
 * espera (el visitante va al registro). Un 404 o un 200 con HTML significa que
 * la ruta la está atendiendo otra cosa — el fallo original.
 */
async function probeReferralLink(url: string): Promise<PartnerReferralHealth['linkCheck']> {
  try {
    const resp = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(8000) });
    const status = resp.status;
    // 3xx = el redirect existe y funciona. Todo lo demás es sospechoso.
    const ok = status >= 300 && status < 400;
    return {
      checked: true,
      url,
      status,
      ok,
      note: ok
        ? undefined
        : status === 404
          ? 'El link devuelve 404: la ruta no existe o la atiende otro handler (así estuvo el programa desde su lanzamiento).'
          : `El link respondió ${status} en vez de un redirect al registro.`,
    };
  } catch (err: any) {
    return { checked: false, url, ok: true, note: `No se pudo comprobar el link: ${err.message}` };
  }
}

/**
 * Lee la última sonda de Resend que ya guarda el monitor de salud, en vez de
 * volver a pegarle a la API. El correo es el ÚNICO camino de entrada al portal
 * de socios (código de un solo uso), así que un 401 aquí significa que el socio
 * no puede entrar a ver sus referidos aunque todo lo demás funcione.
 */
async function checkEmailChannel(kaiPool: Pool): Promise<{ ok: boolean; note?: string }> {
  try {
    const r = await kaiPool.query(
      `SELECT ok, status_code, error FROM provider_probes
        WHERE provider = 'resend'
        ORDER BY checked_at DESC LIMIT 1`
    );
    const row = r.rows[0];
    if (!row) return { ok: true, note: 'sin sondas de correo todavía' };
    if (row.ok) return { ok: true };
    // Un `restricted_api_key` NO es una caída: significa que la key SOLO puede
    // enviar, que es justo lo que necesitamos. Antes esto se leía al revés y
    // llevó a reportar que los socios no podían entrar a su portal cuando el
    // correo estaba sano.
    if (isScopeLimited(row.status_code ?? 401, row.error ?? '')) {
      return { ok: true, note: 'la key de correo está acotada a envío — que es exactamente lo que hace falta' };
    }
    return {
      ok: false,
      note: `El envío de correo está fallando: ${row.error ?? 'error desconocido'}. ` +
        `Como el acceso al portal de socios es por código de un solo uso por correo, mientras siga así un socio no puede entrar a ver sus referidos.`,
    };
  } catch {
    return { ok: true, note: 'no se pudo leer el estado del correo' };
  }
}

function buildVerdict(h: PartnerReferralHealth): PartnerReferralHealth['verdict'] {
  if (h.linkCheck.checked && !h.linkCheck.ok) {
    return {
      level: 'alarm',
      reason: `El link de referido responde ${h.linkCheck.status}. Ningún clic de ningún socio se está atribuyendo.`,
    };
  }
  if (h.unresolvedClicks7d > 0) {
    return {
      level: 'alarm',
      reason: `${h.unresolvedClicks7d} clic(s) en links de referido no resolvieron a ningún socio en 7 días.`,
    };
  }
  if (h.activePartners > 0 && h.silentPartners.length === h.activePartners) {
    return {
      level: 'warn',
      reason:
        `Los ${h.activePartners} socios activos llevan ${SILENT_DAYS} días con 0 referidos y 0 clics. ` +
        `Puede ser que no compartan su link — o que el link no funcione.`,
    };
  }
  if (h.pendingAttributions > 0) {
    return {
      level: 'warn',
      reason: `${h.pendingAttributions} atribución(es) capturadas en LeadPrime que Kai nunca confirmó.`,
    };
  }
  if (!h.emailChannel.ok) {
    return {
      level: 'warn',
      reason: `La atribución funciona, pero los socios no pueden entrar a su portal: ${h.emailChannel.note}`,
    };
  }
  return null;
}
