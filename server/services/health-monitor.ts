/**
 * health-monitor.ts — VIGILANCIA ACTIVA del ecosistema (Fases 1 y 2).
 *
 * El panel de salud era 100% "pull": los clasificadores existían pero solo
 * pintaban colores en una página que alguien tenía que abrir. Si Anthropic se
 * quedaba sin crédito a las 3 AM, nos enterábamos por las quejas.
 *
 * Este servicio corre EN EL SERVIDOR cada PROBE_INTERVAL_MS y hace dos cosas
 * que antes no existían:
 *
 *   1. SONDAS REALES (Fase 2) — pega al endpoint de SERVICIO de cada proveedor
 *      (no al de facturación), mide latencia y guarda el resultado. De ahí
 *      salen uptime %, latencia p50/p95 y tasa de error por proveedor.
 *   2. ALERTAS (Fase 1) — evalúa reglas sobre las sondas + los detectores que
 *      ya existían (gasto/cuotas, infra, billing, issues) y NOTIFICA por SMS,
 *      email y notificación in-app, con deduplicación, cooldown y aviso de
 *      recuperación.
 *
 * Diseño defensivo: ningún fallo de sonda o de notificación puede tumbar el
 * servidor; todo va envuelto en try/catch y se registra.
 */
import { Pool } from 'pg';

// ─── Configuración ────────────────────────────────────────────────────────────

/** Cada cuánto se sondea a todos los proveedores. */
const PROBE_INTERVAL_MS = Number(process.env.HEALTH_PROBE_INTERVAL_MS || 5 * 60 * 1000);
/** Fallos consecutivos antes de declarar caído a un proveedor (evita falsos positivos por un blip). */
const FAILURES_BEFORE_ALERT = 2;
/** Re-notificar una alerta que sigue abierta como máximo cada 6 h. */
const RENOTIFY_COOLDOWN_MS = 6 * 60 * 60 * 1000;
/** Timeout de cada sonda. */
const PROBE_TIMEOUT_MS = 10_000;
/** Retención de sondas (se purgan las más viejas para no inflar la tabla). */
const PROBE_RETENTION_DAYS = 30;

export type AlertSeverity = 'critical' | 'warning';

export interface ProbeResult {
  provider: string;
  ok: boolean;
  latencyMs: number | null;
  statusCode: number | null;
  error: string | null;
  skipped?: boolean;
}

// ─── Pool propio (BD de Kai) ──────────────────────────────────────────────────

let monitorPool: Pool | null = null;
function getMonitorPool(): Pool {
  if (!monitorPool) {
    const connectionString = process.env.AUTH_DATABASE_URL;
    if (!connectionString) throw new Error('AUTH_DATABASE_URL no configurado — el monitor de salud necesita la BD de Kai');
    monitorPool = new Pool({
      connectionString,
      max: 3,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
      ...(connectionString.includes('sslmode=') ? {} : { ssl: { rejectUnauthorized: false } }),
    });
  }
  return monitorPool;
}

/** Crea las tablas del monitor si no existen (idempotente, en cada arranque). */
export async function ensureMonitorTables(): Promise<void> {
  const pool = getMonitorPool();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS provider_probes (
      id          BIGSERIAL PRIMARY KEY,
      provider    VARCHAR(50)  NOT NULL,
      ok          BOOLEAN      NOT NULL,
      latency_ms  INTEGER,
      status_code INTEGER,
      error       TEXT,
      checked_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_provider_probes_lookup ON provider_probes (provider, checked_at DESC)`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS system_alerts (
      id            BIGSERIAL PRIMARY KEY,
      alert_key     VARCHAR(200) NOT NULL,
      severity      VARCHAR(20)  NOT NULL,
      source        VARCHAR(50)  NOT NULL,
      title         TEXT         NOT NULL,
      detail        TEXT,
      status        VARCHAR(20)  NOT NULL DEFAULT 'open',
      occurrences   INTEGER      NOT NULL DEFAULT 1,
      first_seen_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
      last_seen_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
      notified_at   TIMESTAMPTZ,
      resolved_at   TIMESTAMPTZ
    )
  `);
  // Una sola alerta ABIERTA por clave; las resueltas quedan como histórico.
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_system_alerts_open
      ON system_alerts (alert_key) WHERE status = 'open'
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_system_alerts_recent ON system_alerts (last_seen_at DESC)`);
}

// ─── Sondas reales por proveedor (Fase 2) ─────────────────────────────────────

async function httpProbe(
  provider: string,
  url: string,
  init: RequestInit & { okStatuses?: number[] } = {}
): Promise<ProbeResult> {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    const resp = await fetch(url, { ...init, signal: controller.signal });
    const latencyMs = Date.now() - started;
    const okStatuses = init.okStatuses ?? [];
    const ok = resp.ok || okStatuses.includes(resp.status);
    let error: string | null = null;
    if (!ok) {
      const body = await resp.text().catch(() => '');
      error = `HTTP ${resp.status}${body ? ` — ${body.slice(0, 200)}` : ''}`;
    }
    return { provider, ok, latencyMs, statusCode: resp.status, error };
  } catch (e: any) {
    const latencyMs = Date.now() - started;
    const aborted = e?.name === 'AbortError';
    return {
      provider,
      ok: false,
      latencyMs,
      statusCode: null,
      error: aborted ? `timeout tras ${PROBE_TIMEOUT_MS}ms` : String(e?.message || e),
    };
  } finally {
    clearTimeout(timer);
  }
}

function skipped(provider: string, reason: string): ProbeResult {
  return { provider, ok: true, latencyMs: null, statusCode: null, error: reason, skipped: true };
}

async function dbProbe(provider: string, connectionString: string | undefined): Promise<ProbeResult> {
  if (!connectionString) return skipped(provider, 'connection string no configurada');
  const started = Date.now();
  const pool = new Pool({
    connectionString,
    max: 1,
    connectionTimeoutMillis: PROBE_TIMEOUT_MS,
    ...(connectionString.includes('sslmode=') ? {} : { ssl: { rejectUnauthorized: false } }),
  });
  try {
    await pool.query('SELECT 1');
    return { provider, ok: true, latencyMs: Date.now() - started, statusCode: null, error: null };
  } catch (e: any) {
    return { provider, ok: false, latencyMs: Date.now() - started, statusCode: null, error: String(e?.message || e) };
  } finally {
    await pool.end().catch(() => { /* ignorar */ });
  }
}

/**
 * Sondas al plano de SERVICIO de cada proveedor (no al de facturación): estas
 * sí detectan que la API real está caída, lenta o con la key rechazada.
 */
export async function probeAllProviders(): Promise<ProbeResult[]> {
  const probes: Array<Promise<ProbeResult>> = [];

  // Anthropic — /v1/models valida la key de INFERENCIA (la que usan los agentes).
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  probes.push(anthropicKey
    ? httpProbe('anthropic', 'https://api.anthropic.com/v1/models?limit=1', {
        headers: { 'x-api-key': anthropicKey, 'anthropic-version': '2023-06-01' },
      })
    : Promise.resolve(skipped('anthropic', 'ANTHROPIC_API_KEY no configurada')));

  // OpenAI
  const openaiKey = process.env.OPENAI_API_KEY;
  probes.push(openaiKey
    ? httpProbe('openai', 'https://api.openai.com/v1/models', {
        headers: { Authorization: `Bearer ${openaiKey}` },
      })
    : Promise.resolve(skipped('openai', 'OPENAI_API_KEY no configurada')));

  // Twilio — cuenta (valida SID + token reales).
  const twSid = process.env.TWILIO_ACCOUNT_SID;
  const twToken = process.env.TWILIO_AUTH_TOKEN;
  probes.push(twSid && twToken
    ? httpProbe('twilio', `https://api.twilio.com/2010-04-01/Accounts/${twSid}.json`, {
        headers: { Authorization: 'Basic ' + Buffer.from(`${twSid}:${twToken}`).toString('base64') },
      })
    : Promise.resolve(skipped('twilio', 'TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN no configurados')));

  // ElevenLabs
  const elKey = process.env.ELEVENLABS_API_KEY;
  probes.push(elKey
    ? httpProbe('elevenlabs', 'https://api.elevenlabs.io/v1/user/subscription', {
        headers: { 'xi-api-key': elKey },
      })
    : Promise.resolve(skipped('elevenlabs', 'ELEVENLABS_API_KEY no configurada')));

  // Stripe — balance (endpoint barato que valida la key secreta).
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  probes.push(stripeKey
    ? httpProbe('stripe', 'https://api.stripe.com/v1/balance', {
        headers: { Authorization: `Bearer ${stripeKey}` },
      })
    : Promise.resolve(skipped('stripe', 'STRIPE_SECRET_KEY no configurada')));

  // Resend — dominios (valida la key de envío).
  const resendKey = process.env.RESEND_API_KEY;
  probes.push(resendKey
    ? httpProbe('resend', 'https://api.resend.com/domains', {
        headers: { Authorization: `Bearer ${resendKey}` },
      })
    : Promise.resolve(skipped('resend', 'RESEND_API_KEY no configurada')));

  // API de LeadPrime (la app que sirve a los usuarios).
  const lpUrl = process.env.LEADPRIME_API_URL || 'https://leadprime.chyrris.com';
  probes.push(httpProbe('leadprime_api', `${lpUrl}/api/status`));

  // Bases de datos.
  probes.push(dbProbe('leadprime_db', process.env.LEADPRIME_DATABASE_URL));
  probes.push(dbProbe('kai_db', process.env.AUTH_DATABASE_URL));
  probes.push(dbProbe('owlfenc_db', process.env.OWLFENC_DATABASE_URL));

  const settled = await Promise.allSettled(probes);
  return settled.map((r, i) =>
    r.status === 'fulfilled'
      ? r.value
      : { provider: `probe_${i}`, ok: false, latencyMs: null, statusCode: null, error: String(r.reason) }
  );
}

async function recordProbes(results: ProbeResult[]): Promise<void> {
  const pool = getMonitorPool();
  for (const r of results) {
    if (r.skipped) continue; // un proveedor no configurado no es un fallo
    await pool.query(
      `INSERT INTO provider_probes (provider, ok, latency_ms, status_code, error)
       VALUES ($1, $2, $3, $4, $5)`,
      [r.provider, r.ok, r.latencyMs, r.statusCode, r.error]
    ).catch((e: any) => console.error('[HealthMonitor] no se pudo guardar la sonda:', e.message));
  }
  // Purga de histórico viejo.
  await pool.query(
    `DELETE FROM provider_probes WHERE checked_at < NOW() - INTERVAL '${PROBE_RETENTION_DAYS} days'`
  ).catch(() => { /* no crítico */ });
}

// ─── Motor de alertas (Fase 1) ────────────────────────────────────────────────

export interface AlertInput {
  key: string;
  severity: AlertSeverity;
  source: string;
  title: string;
  detail: string;
}

/**
 * Registra una alerta y decide si toca notificar:
 *   · nueva            → notifica de inmediato
 *   · ya abierta       → incrementa el contador; re-notifica solo tras el cooldown
 * Devuelve true si se notificó.
 */
async function raiseAlert(alert: AlertInput): Promise<boolean> {
  const pool = getMonitorPool();
  const existing = await pool.query(
    `SELECT id, notified_at, occurrences FROM system_alerts WHERE alert_key = $1 AND status = 'open'`,
    [alert.key]
  );

  let shouldNotify = false;
  if (existing.rows.length === 0) {
    await pool.query(
      `INSERT INTO system_alerts (alert_key, severity, source, title, detail, status)
       VALUES ($1, $2, $3, $4, $5, 'open')
       ON CONFLICT (alert_key) WHERE status = 'open' DO NOTHING`,
      [alert.key, alert.severity, alert.source, alert.title, alert.detail]
    );
    shouldNotify = true;
  } else {
    const row = existing.rows[0];
    const lastNotified = row.notified_at ? new Date(row.notified_at).getTime() : 0;
    shouldNotify = Date.now() - lastNotified > RENOTIFY_COOLDOWN_MS;
    await pool.query(
      `UPDATE system_alerts
          SET occurrences = occurrences + 1, last_seen_at = NOW(),
              severity = $2, detail = $3
        WHERE id = $1`,
      [row.id, alert.severity, alert.detail]
    );
  }

  if (!shouldNotify) return false;
  const delivered = await notify(alert);
  if (delivered) {
    await pool.query(
      `UPDATE system_alerts SET notified_at = NOW() WHERE alert_key = $1 AND status = 'open'`,
      [alert.key]
    );
  }
  return delivered;
}

/** Cierra las alertas abiertas cuya condición ya no se cumple y avisa de la recuperación. */
async function resolveAlertsNotIn(activeKeys: Set<string>): Promise<void> {
  const pool = getMonitorPool();
  const open = await pool.query(`SELECT id, alert_key, title, notified_at FROM system_alerts WHERE status = 'open'`);
  for (const row of open.rows) {
    if (activeKeys.has(row.alert_key)) continue;
    await pool.query(
      `UPDATE system_alerts SET status = 'resolved', resolved_at = NOW() WHERE id = $1`,
      [row.id]
    );
    // Solo avisar la recuperación de lo que se notificó como problema.
    if (row.notified_at) {
      await notify({
        key: `${row.alert_key}:resolved`,
        severity: 'warning',
        source: 'recovery',
        title: `RESUELTO — ${row.title}`,
        detail: 'La condición dejó de detectarse. No se requiere acción.',
      }).catch(() => { /* la resolución ya quedó registrada */ });
    }
  }
}

// ─── Canales de notificación ──────────────────────────────────────────────────

// ── Salud del propio canal de alertas ────────────────────────────────────────
// LECCIÓN DEL INCIDENTE (ago 2026): Resend llevaba ~1.5 meses devolviendo 401
// restricted_api_key. TODAS las alertas críticas quedaron "sin notificar" y por
// eso nadie se enteró del bug de créditos. Un sistema de avisos que no puede
// avisar es peor que no tener ninguno: da falsa tranquilidad.
//
// Regla: una alerta que NO se puede entregar es, por sí sola, una alerta.
const channelFailures: Record<'sms' | 'email', number> = { sms: 0, email: 0 };
const CHANNEL_FAILURES_BEFORE_ESCALATION = 3;
let lastUndeliverableEscalationAt = 0;

/** Envía por SMS + email. Devuelve true si al menos un canal entregó. */
async function notify(alert: AlertInput): Promise<boolean> {
  const icon = alert.severity === 'critical' ? '🚨' : '⚠️';
  const subject = `${icon} Chyrris KAI — ${alert.title}`;
  const body = `${alert.detail}\n\nFuente: ${alert.source}\nSeveridad: ${alert.severity}\nHora: ${new Date().toLocaleString('es-MX')}`;

  const [smsRes, emailRes] = await Promise.allSettled([
    sendAlertSms(`${icon} KAI: ${alert.title}. ${alert.detail}`.slice(0, 300)),
    sendAlertEmail(subject, body),
  ]);
  const smsOk = smsRes.status === 'fulfilled' && smsRes.value === true;
  const emailOk = emailRes.status === 'fulfilled' && emailRes.value === true;

  // Contador por canal: un canal muerto se detecta aunque el otro funcione.
  channelFailures.sms = smsOk ? 0 : channelFailures.sms + 1;
  channelFailures.email = emailOk ? 0 : channelFailures.email + 1;

  const delivered = smsOk || emailOk;
  if (!delivered) {
    console.error(`[HealthMonitor] ⛔ ALERTA SIN ENTREGAR (${alert.key}): ${alert.title} — ${alert.detail}`);
    await escalateUndeliverable(alert);
  }
  return delivered;
}

/**
 * Ningún canal entregó. Se deja constancia PERMANENTE en el dashboard (una
 * alerta crítica propia, que no depende de ningún canal externo para verse) y
 * se registra en consola con todo el detalle, que es lo único que queda cuando
 * el correo y el SMS están caídos a la vez.
 */
async function escalateUndeliverable(original: AlertInput): Promise<void> {
  try {
    const pool = getMonitorPool();
    const detail =
      `Ni SMS ni email pudieron entregar la alerta "${original.title}". ` +
      `Fallos consecutivos — SMS: ${channelFailures.sms}, email: ${channelFailures.email}. ` +
      `Mientras esto siga así, NINGUNA alerta llega: el panel es la única fuente de verdad. ` +
      `Revisa RESEND_API_KEY (necesita permiso de ENVÍO, no solo lectura), OWNER_ALERT_EMAIL, ` +
      `OWNER_ALERT_PHONE y las credenciales de Twilio.`;
    await pool.query(
      `INSERT INTO system_alerts (alert_key, severity, source, title, detail, status)
       VALUES ($1, 'critical', 'alert_channel', $2, $3, 'open')
       ON CONFLICT (alert_key) WHERE status = 'open'
       DO UPDATE SET occurrences = system_alerts.occurrences + 1,
                     last_seen_at = NOW(), detail = EXCLUDED.detail`,
      ['alert_channel:undeliverable', '⛔ CANAL DE ALERTAS CAÍDO — no se puede notificar nada', detail]
    );
    // Log periódico (máx. 1/hora) para que quede en los logs de Railway aunque
    // nadie abra el panel.
    if (Date.now() - lastUndeliverableEscalationAt > 60 * 60 * 1000) {
      lastUndeliverableEscalationAt = Date.now();
      console.error(`[HealthMonitor] ⛔⛔ ${detail}`);
    }
  } catch (e: any) {
    console.error('[HealthMonitor] no se pudo registrar el fallo de entrega:', e.message);
  }
}

/**
 * ¿Algún canal de notificación lleva demasiados fallos seguidos? Se evalúa en
 * cada ciclo para que un canal muerto salga a la luz aunque no haya ninguna
 * otra alerta que enviar (que era justo el caso: sin alertas nuevas, el
 * Resend caído era invisible).
 */
function deadChannels(): Array<{ channel: string; failures: number }> {
  const dead: Array<{ channel: string; failures: number }> = [];
  for (const [channel, failures] of Object.entries(channelFailures)) {
    if (failures >= CHANNEL_FAILURES_BEFORE_ESCALATION) dead.push({ channel, failures });
  }
  return dead;
}

async function sendAlertSms(message: string): Promise<boolean> {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_ALERT_FROM || process.env.TWILIO_PHONE_NUMBER;
  const to = process.env.OWNER_ALERT_PHONE;
  if (!sid || !token || !from || !to) return false;
  try {
    const resp = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: 'POST',
      headers: {
        Authorization: 'Basic ' + Buffer.from(`${sid}:${token}`).toString('base64'),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ From: from, To: to, Body: message }).toString(),
    });
    if (!resp.ok) {
      console.error('[HealthMonitor] SMS de alerta falló:', resp.status, await resp.text().catch(() => ''));
      return false;
    }
    return true;
  } catch (e: any) {
    console.error('[HealthMonitor] SMS de alerta falló:', e.message);
    return false;
  }
}

async function sendAlertEmail(subject: string, body: string): Promise<boolean> {
  const key = process.env.RESEND_API_KEY;
  const to = process.env.OWNER_ALERT_EMAIL;
  const from = process.env.ALERT_FROM_EMAIL || 'alerts@chyrris.com';
  if (!key || !to) return false;
  try {
    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: `Chyrris KAI <${from}>`,
        to: [to],
        subject,
        text: body,
      }),
    });
    if (!resp.ok) {
      console.error('[HealthMonitor] email de alerta falló:', resp.status, await resp.text().catch(() => ''));
      return false;
    }
    return true;
  } catch (e: any) {
    console.error('[HealthMonitor] email de alerta falló:', e.message);
    return false;
  }
}

// ─── Reglas ───────────────────────────────────────────────────────────────────

/** ¿Cuántas de las últimas N sondas de este proveedor fallaron consecutivamente? */
async function consecutiveFailures(provider: string): Promise<number> {
  const pool = getMonitorPool();
  const res = await pool.query(
    `SELECT ok FROM provider_probes WHERE provider = $1 ORDER BY checked_at DESC LIMIT $2`,
    [provider, FAILURES_BEFORE_ALERT]
  );
  let n = 0;
  for (const row of res.rows) {
    if (row.ok) break;
    n++;
  }
  return n;
}

/** Nombre legible para las alertas. */
const PROVIDER_LABEL: Record<string, string> = {
  anthropic: 'Anthropic (Claude)',
  openai: 'OpenAI',
  twilio: 'Twilio',
  elevenlabs: 'ElevenLabs',
  stripe: 'Stripe',
  resend: 'Resend (email)',
  leadprime_api: 'API de LeadPrime',
  leadprime_db: 'Base de datos LeadPrime',
  kai_db: 'Base de datos Kai',
  owlfenc_db: 'Base de datos Owl Fenc',
};

function label(provider: string): string {
  return PROVIDER_LABEL[provider] ?? provider;
}

/**
 * Evalúa TODAS las reglas y levanta/cierra alertas.
 * Las fuentes son: sondas + gasto/cuotas + infra + billing + issues.
 */
export async function evaluateAlerts(probes: ProbeResult[]): Promise<{ raised: number; active: string[] }> {
  const active = new Set<string>();
  let raised = 0;
  const fire = async (a: AlertInput) => {
    active.add(a.key);
    if (await raiseAlert(a)) raised++;
  };

  // ── 1. Proveedor caído (sondas reales) ──────────────────────────────────────
  for (const p of probes) {
    if (p.skipped || p.ok) continue;
    const fails = await consecutiveFailures(p.provider);
    if (fails >= FAILURES_BEFORE_ALERT) {
      // Resend NO es un proveedor cualquiera: es el canal por el que salen las
      // alertas. Si está caído, el aviso de que está caído tampoco puede salir
      // por ahí — por eso se marca explícitamente y el texto le dice al
      // operador que el resto de las alertas están mudas.
      const isAlertChannel = p.provider === 'resend';
      const is401 = p.statusCode === 401 || /401|restricted_api_key/i.test(p.error ?? '');
      await fire({
        key: `provider_down:${p.provider}`,
        severity: 'critical',
        source: isAlertChannel ? 'alert_channel' : 'probe',
        title: isAlertChannel
          ? `⛔ CANAL DE ALERTAS CAÍDO — ${label(p.provider)} rechaza los envíos`
          : `${label(p.provider)} NO RESPONDE`,
        detail: isAlertChannel
          ? `${fails} sondas consecutivas fallidas. ${is401
              ? 'HTTP 401: la API key existe pero NO tiene permiso de ENVÍO (restricted_api_key). ' +
                'Genera una key con permiso "Sending access" en resend.com/api-keys y actualiza RESEND_API_KEY.'
              : `Último error: ${p.error ?? 'desconocido'}`} ` +
            `Mientras siga así NINGUNA alerta por correo llega y el panel es la única fuente de verdad.`
          : `${fails} sondas consecutivas fallidas. Último error: ${p.error ?? 'desconocido'}`,
      });
    }
  }

  // ── 1b. Canal de notificación muerto (aunque no haya nada más que avisar) ──
  // Sin esta regla, un canal caído solo se descubría al intentar enviar una
  // alerta — y si no había alertas nuevas, permanecía invisible. Exactamente
  // lo que pasó: Resend llevaba mes y medio en 401 y nadie lo supo.
  for (const dead of deadChannels()) {
    await fire({
      key: `alert_channel_dead:${dead.channel}`,
      severity: 'critical',
      source: 'alert_channel',
      title: `⛔ Canal de alertas "${dead.channel}" sin entregar (${dead.failures} intentos seguidos)`,
      detail:
        `El canal ${dead.channel} lleva ${dead.failures} envíos fallidos consecutivos. ` +
        `Las alertas críticas no están llegando por esa vía. ` +
        `Si el otro canal también falla, el panel es lo único que queda.`,
    });
  }

  // ── 2. Gasto / cuotas / keys (detectores que ya existían) ───────────────────
  try {
    const { getServiceSpend } = await import('./leadprime-service-spend');
    const spend: any = await getServiceSpend();
    for (const svc of (spend?.providers ?? [])) {
      const name = svc.provider ?? 'proveedor';
      if (svc.keyIssue) {
        await fire({
          key: `key_issue:${name}`,
          severity: 'critical',
          source: 'spend',
          title: `API key RECHAZADA — ${label(name)}`,
          detail: svc.note || 'El proveedor rechazó las credenciales (401/403). El servicio está caído para los usuarios.',
        });
      }
      if (svc.paymentIssue) {
        await fire({
          key: `payment_issue:${name}`,
          severity: 'critical',
          source: 'spend',
          title: `PAGO RECHAZADO / SIN CRÉDITO — ${label(name)}`,
          detail: svc.note || 'El proveedor reporta problema de pago (402). Recarga o actualiza el método de pago.',
        });
      }
      // Saldo prepago bajo (Twilio): sin saldo, los SMS y llamadas de TODOS
      // los usuarios dejan de salir. Es la falla más silenciosa y más cara.
      if (typeof svc.balanceUsd === 'number') {
        const critical = Number(process.env.TWILIO_BALANCE_CRITICAL_USD || 20);
        const fixedWarn = Number(process.env.TWILIO_BALANCE_WARN_USD || 50);
        // Umbral RELATIVO al gasto proyectado: un saldo de $34 es cómodo si
        // gastas $10/mes y es una emergencia si gastas $51. El fijo solo actúa
        // como piso cuando aún no hay proyección.
        const ratio = Number(process.env.TWILIO_BALANCE_MIN_RATIO || 1.5);
        const projected = svc.projectedMonthUsd ?? 0;
        const relativeWarn = projected > 0 ? projected * ratio : 0;
        const warn = Math.max(fixedWarn, relativeWarn);
        if (svc.balanceUsd <= warn) {
          await fire({
            key: `low_balance:${name}`,
            severity: svc.balanceUsd <= critical ? 'critical' : 'warning',
            source: 'balance',
            title: `SALDO BAJO — ${label(name)}: $${svc.balanceUsd.toFixed(2)}`,
            detail:
              `Al agotarse el saldo dejan de enviarse SMS y llamadas de TODOS los usuarios a la vez. ` +
              `Saldo $${svc.balanceUsd.toFixed(2)} vs gasto proyectado del mes $${projected.toFixed(2)}` +
              (projected > 0 ? ` (${(svc.balanceUsd / projected).toFixed(2)}x — el mínimo sano es ${ratio}x)` : '') +
              `. Recarga la cuenta.`,
          });
        }
      }
      if (typeof svc.usagePct === 'number' && svc.usagePct >= 0.9) {
        await fire({
          key: `quota:${name}`,
          severity: 'warning',
          source: 'spend',
          title: `Cuota al ${Math.round(svc.usagePct * 100)}% — ${label(name)}`,
          detail: `${svc.limitLabel ?? 'Límite del plan'} — se agota pronto${svc.resetAt ? ` (reinicia ${svc.resetAt})` : ''}.`,
        });
      }
    }
  } catch (e: any) {
    console.error('[HealthMonitor] no se pudo evaluar el gasto por servicio:', e.message);
  }

  // ── 3. Infraestructura y workers ────────────────────────────────────────────
  try {
    const { getInfraHealth } = await import('./leadprime-infra-health');
    const infra: any = await getInfraHealth();
    for (const w of (infra?.workers?.rows ?? [])) {
      if (w?.lastError) {
        await fire({
          key: `worker_error:${w.workerName}`,
          severity: 'warning',
          source: 'infra',
          title: `Worker con error — ${w.workerName}`,
          detail: String(w.lastError).slice(0, 400),
        });
      }
    }
    if (infra?.costPerUser?.severity === 'alarm') {
      await fire({
        key: 'infra:cost_per_user',
        severity: 'warning',
        source: 'infra',
        title: 'Costo de infraestructura por usuario en ALARMA',
        detail: `${infra.costPerUser.cuHoursPerActiveUser ?? '?'} CU-h por usuario activo. Revisa los workers que mantienen la BD despierta 24/7.`,
      });
    }
  } catch (e: any) {
    console.error('[HealthMonitor] no se pudo evaluar la infraestructura:', e.message);
  }

  // ── 4. Billing (dinero que se pierde en silencio) ───────────────────────────
  try {
    const { getBillingHealth } = await import('./leadprime-billing-health');
    const billing: any = await getBillingHealth();
    const negatives = billing?.negativeBalances?.count ?? 0;
    if (negatives > 0) {
      await fire({
        key: 'billing:negative_balances',
        severity: 'warning',
        source: 'billing',
        title: `${negatives} cuenta(s) con saldo NEGATIVO`,
        detail: 'Hay wallets en negativo: se consumió servicio sin fondos. Revisa la pestaña Billing.',
      });
    }
    const failures = billing?.reconcileFailures30d?.count ?? billing?.reconcileFailures?.count ?? 0;
    if (failures > 0) {
      await fire({
        key: 'billing:reconcile_failures',
        severity: 'warning',
        source: 'billing',
        title: `${failures} fallo(s) de reconciliación de cobros`,
        detail: 'Uso consumido que no se pudo cobrar. Cada fallo es ingreso perdido si no se corrige.',
      });
    }
  } catch (e: any) {
    console.error('[HealthMonitor] no se pudo evaluar el billing:', e.message);
  }

  // ── 5. Pico de issues reportados por los sistemas ───────────────────────────
  try {
    const { getSystemIssueStats } = await import('./leadprime-db');
    const stats: any = await getSystemIssueStats();
    const nuevos = stats?.byStatus?.new ?? 0;
    if (nuevos >= 10) {
      await fire({
        key: 'issues:backlog',
        severity: 'warning',
        source: 'issues',
        title: `${nuevos} issues del sistema SIN revisar`,
        detail: 'Los sistemas están reportando fallas que nadie ha atendido. Revisa System Issues.',
      });
    }
  } catch (e: any) {
    console.error('[HealthMonitor] no se pudo evaluar los issues:', e.message);
  }

  await resolveAlertsNotIn(active).catch((e: any) =>
    console.error('[HealthMonitor] no se pudieron resolver alertas:', e.message)
  );

  return { raised, active: Array.from(active) };
}

// ─── Ciclo principal ──────────────────────────────────────────────────────────

let running = false;

/** Una pasada completa: sondear → guardar → evaluar reglas → notificar. */
export async function runHealthCycle(): Promise<{ probes: ProbeResult[]; raised: number; active: string[] }> {
  if (running) return { probes: [], raised: 0, active: [] };
  running = true;
  try {
    await ensureMonitorTables();
    const probes = await probeAllProviders();
    await recordProbes(probes);
    const { raised, active } = await evaluateAlerts(probes);
    const down = probes.filter(p => !p.ok && !p.skipped).map(p => p.provider);
    console.log(
      `[HealthMonitor] ciclo listo — sondas: ${probes.length}, caídos: ${down.length ? down.join(', ') : 'ninguno'}, alertas activas: ${active.length}, notificadas: ${raised}`
    );
    return { probes, raised, active };
  } catch (e: any) {
    console.error('[HealthMonitor] el ciclo falló:', e.message);
    return { probes: [], raised: 0, active: [] };
  } finally {
    running = false;
  }
}

let timer: NodeJS.Timeout | null = null;

/** Arranca la vigilancia periódica (se llama una vez al iniciar el servidor). */
export function startHealthMonitor(): void {
  if (timer) return;
  if (!process.env.AUTH_DATABASE_URL) {
    console.warn('[HealthMonitor] DESACTIVADO — falta AUTH_DATABASE_URL');
    return;
  }
  if (process.env.HEALTH_MONITOR_ENABLED === 'false') {
    console.log('[HealthMonitor] DESACTIVADO por HEALTH_MONITOR_ENABLED=false');
    return;
  }
  // Primer ciclo poco después del arranque (deja que el servidor termine de subir).
  setTimeout(() => { runHealthCycle().catch(() => { /* ya se registra dentro */ }); }, 30_000);
  timer = setInterval(() => { runHealthCycle().catch(() => { /* ya se registra dentro */ }); }, PROBE_INTERVAL_MS);
  console.log(`[HealthMonitor] ACTIVO — sondeo cada ${Math.round(PROBE_INTERVAL_MS / 60000)} min con alertas por SMS/email`);
}

// ─── Lecturas para el panel ───────────────────────────────────────────────────

export interface ProviderUptime {
  provider: string;
  label: string;
  checks: number;
  uptimePct: number;
  errorPct: number;
  p50Ms: number | null;
  p95Ms: number | null;
  lastOk: boolean | null;
  lastError: string | null;
  lastCheckedAt: string | null;
}

/** Uptime, latencia y tasa de error por proveedor en las últimas N horas. */
export async function getProviderUptime(hours = 24): Promise<ProviderUptime[]> {
  await ensureMonitorTables();
  const pool = getMonitorPool();
  const res = await pool.query(
    `SELECT provider,
            COUNT(*)::int                                          AS checks,
            SUM(CASE WHEN ok THEN 1 ELSE 0 END)::int               AS ok_count,
            PERCENTILE_DISC(0.5) WITHIN GROUP (ORDER BY latency_ms) AS p50,
            PERCENTILE_DISC(0.95) WITHIN GROUP (ORDER BY latency_ms) AS p95
       FROM provider_probes
      WHERE checked_at >= NOW() - ($1 || ' hours')::interval
      GROUP BY provider
      ORDER BY provider`,
    [String(hours)]
  );
  const last = await pool.query(
    `SELECT DISTINCT ON (provider) provider, ok, error, checked_at
       FROM provider_probes
      ORDER BY provider, checked_at DESC`
  );
  const lastByProvider = new Map(last.rows.map((r: any) => [r.provider, r]));

  return res.rows.map((r: any) => {
    const checks = Number(r.checks) || 0;
    const okCount = Number(r.ok_count) || 0;
    const l = lastByProvider.get(r.provider);
    return {
      provider: r.provider,
      label: label(r.provider),
      checks,
      uptimePct: checks ? (okCount / checks) * 100 : 0,
      errorPct: checks ? ((checks - okCount) / checks) * 100 : 0,
      p50Ms: r.p50 != null ? Number(r.p50) : null,
      p95Ms: r.p95 != null ? Number(r.p95) : null,
      lastOk: l ? l.ok : null,
      lastError: l?.error ?? null,
      lastCheckedAt: l?.checked_at ? new Date(l.checked_at).toISOString() : null,
    };
  });
}

export interface SystemAlert {
  id: number;
  alertKey: string;
  severity: string;
  source: string;
  title: string;
  detail: string | null;
  status: string;
  occurrences: number;
  firstSeenAt: string;
  lastSeenAt: string;
  notifiedAt: string | null;
  resolvedAt: string | null;
}

/** Alertas abiertas + histórico reciente. */
export async function getAlerts(options: { status?: 'open' | 'all'; limit?: number } = {}): Promise<SystemAlert[]> {
  await ensureMonitorTables();
  const pool = getMonitorPool();
  const { status = 'open', limit = 100 } = options;
  const res = await pool.query(
    `SELECT * FROM system_alerts
      ${status === 'open' ? `WHERE status = 'open'` : ''}
      ORDER BY (status = 'open') DESC,
               CASE severity WHEN 'critical' THEN 0 ELSE 1 END,
               last_seen_at DESC
      LIMIT $1`,
    [limit]
  );
  return res.rows.map((r: any) => ({
    id: Number(r.id),
    alertKey: r.alert_key,
    severity: r.severity,
    source: r.source,
    title: r.title,
    detail: r.detail,
    status: r.status,
    occurrences: Number(r.occurrences) || 1,
    firstSeenAt: new Date(r.first_seen_at).toISOString(),
    lastSeenAt: new Date(r.last_seen_at).toISOString(),
    notifiedAt: r.notified_at ? new Date(r.notified_at).toISOString() : null,
    resolvedAt: r.resolved_at ? new Date(r.resolved_at).toISOString() : null,
  }));
}

/** Marca una alerta como reconocida (deja de re-notificar; el ciclo la cierra al resolverse). */
export async function acknowledgeAlert(id: number): Promise<void> {
  await ensureMonitorTables();
  const pool = getMonitorPool();
  await pool.query(`UPDATE system_alerts SET notified_at = NOW() WHERE id = $1 AND status = 'open'`, [id]);
}
