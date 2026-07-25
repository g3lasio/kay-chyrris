# IMPLEMENTATION REPORT — Portal de Socios (Partner Referral Portal)

**Fecha:** 2026-07-25 · **Repo:** `g3lasio/kay-chyrris` (Kai) · **Branch:** `claude/partner-portal-multitenant-qobhrm`
**Alcance:** Portal de socios multi-tenant en `partners.chyrris.com` dentro de la misma app de Kai (Opción A: mismo repo, mismo deploy de Railway, misma DB Neon), con login OTP por Resend, onboarding de 4 pasos, dashboard de referidos/comisiones, gestión de socios en el admin de Kai, y motor de comisiones 20%/10% sobre revenue efectivamente cobrado.

---

## Resumen ejecutivo

| Fase | Estado | Evidencia |
|---|---|---|
| Arquitectura de dominio + aislamiento de sesiones | ✅ Código completo | curl con `Host:` headers (abajo, §1) |
| Modelo de datos (7 tablas `referral_*` / `partner_*`) | ✅ Migración aditiva + bootstrap idempotente | `drizzle/0001_daffy_magdalene.sql`, 43/43 checks E2E |
| FASE 1 — Auth OTP con Resend | ✅ | checks E2E + curl (§2) |
| FASE 2 — Admin de socios en Kai | ✅ | screenshot `admin-partners-desktop.png` |
| FASE 3 — Captura de referidos + motor de comisión | ✅ | 43/43 checks E2E con Postgres real (§3) |
| FASE 4 — Dashboard del socio (responsive) | ✅ | screenshots web + móvil 375px (§4) |
| Validación técnica | ✅ `tsc` limpio · build de producción OK · 31 tests vitest OK | §5 |
| Pasos externos (Railway/Cloudflare/Resend/Neon prod) | ⚠️ Requieren acción de Gelasio | §7 |

**Validación E2E: 43/43 checks OK** contra PostgreSQL real (16.13) con una réplica del esquema de LeadPrime (nombres/columnas de producción). En este entorno de desarrollo no hay credenciales de la Neon de producción — Manus debe repetir la validación de §6 en producción tras el deploy.

---

## 1. Arquitectura de dominio y aislamiento (regla: un solo deploy, dos dominios)

**Implementación:**
- `server/partner/hostname.ts` — clasifica cada request por `Host`: `partners.chyrris.com` (o cualquier `partners.*`) → portal; cualquier otro dominio real → admin; `localhost`/IPs/previews → neutro (ambas áreas funcionan para desarrollo).
- `server/_core/context.ts` — en el dominio de socios **jamás se lee la cookie de admin** (y viceversa). No es un filtro de UI: ningún procedimiento de admin puede ejecutarse por `partners.chyrris.com` aunque se envíe una cookie de admin válida.
- Sesiones 100% independientes: tabla `partner_sessions` + cookie `partner_session_id` vs `admin_sessions` + `app_session_id`. `partnerProcedure` (nuevo en `server/_core/trpc.ts`) solo acepta sesión de socio.
- El login de admin (`auth.verifyPasscode`) devuelve `Not available` desde el dominio de socios, incluso con el passcode correcto.
- SPA compartida: `client/src/App.tsx` renderiza `PartnerApp` (branding LeadPrime, tema claro) cuando el hostname es de socios; el admin de Kai queda intacto en cualquier otro host. Override de desarrollo: `?portal=partners`.

**Evidencia (curl real contra el server de producción local — `docs/partner-portal/curl-evidence.txt`):**

```
### Login de ADMIN desde partners.chyrris.com con passcode CORRECTO → bloqueado
$ curl -H 'Host: partners.chyrris.com' -X POST .../auth.verifyPasscode
{"result":{"data":{"json":{"success":false,"error":"Not available"}}}}

### Cookie de admin VÁLIDA (obtenida en kai.chyrris.com) reutilizada en partners.chyrris.com → UNAUTHORIZED
$ curl -H 'Host: partners.chyrris.com' -H "Cookie: app_session_id=<válida>" .../partnerAdmin.list
{"error":{"json":{"message":"Please login (10001)","code":-32001,...}}}

### La misma cookie vía kai.chyrris.com → OK (lista de socios)
{"result":{"data":{"json":[{"id":2,"name":"Otra Escuela de Licencias",...
```

## 2. FASE 1 — Autenticación OTP (Resend)

- `server/partner/partner-auth.ts`: OTP de 6 dígitos criptográficamente aleatorio, guardado **hasheado con bcrypt** (verificado: `$2b$10$…` en DB), expiración **10 min**, un solo uso, **máx 5 solicitudes/email/hora** y **máx 5 intentos por código**.
- Respuesta **neutra idéntica** exista o no el email (verificado por igualdad literal del mensaje). Emails a socios `paused`/`inactive` tampoco reciben código.
- **Sin auto-registro:** no existe ninguna ruta que cree un socio fuera de `partnerAdmin.create` (protegida por sesión de admin).
- Primer login activa al socio (`invited` → `active`). Sesión de 7 días con cache de 60s (mismo patrón que el admin).
- `server/partner/partner-emails.ts`: plantillas HTML con branding LeadPrime (navy/azul) para OTP e invitación. **Remitente:** `PARTNER_EMAIL_FROM` (default `LeadPrime <no-reply@chyrris.com>`) — ver pendientes §7.

```
### curl real: email válido y email inexistente → misma respuesta
{"result":{"data":{"json":{"success":true,"message":"Si tu correo está registrado, recibirás un código de acceso en unos segundos."}}}}
### código incorrecto → rechazado
{"result":{"data":{"json":{"success":false,"error":"Código inválido o expirado"}}}}
```

## 3. FASES 2–3 — Admin de socios + motor de comisión

**Admin (kai.chyrris.com → LeadPrime → “Socios”):** crear socio (dispara invitación Resend), listar con agregados, detalle con 4 pestañas (referidos, comisiones, documentos, liquidaciones), verificar documentos, marcar contrato firmado (LeadSign), generar liquidación por periodo, marcar pagada, reversión manual de comisión, atribución manual, reenviar invitación, pausar/reactivar, editar tarifas, y botón "Sincronizar comisiones". Sigue el patrón tRPC + dialogs del admin existente.

**Captura de referidos (`?ref=CODE`):** tres vías, todas idempotentes (`UNIQUE(referred_user_id)` — el primer código gana):
1. `GET /api/referrals/validate?code=X` y `POST /api/referrals/attribute` (públicos, rate-limited 60/min/IP, secreto opcional `REFERRAL_WEBHOOK_SECRET`) para que el signup de LeadPrime los llame.
2. Sweep automático de `contractors.referral_code` (columna nullable aditiva — SQL listo en `scripts/leadprime-add-referral-code.sql`; el engine la detecta por `information_schema` y no falla si aún no existe).
3. Atribución manual desde el admin.

> ⚠️ La cookie/localStorage de 30 días y el guardado del `?ref=` viven en el frontend de LeadPrime (repo separado `g3lasio/leadprime`) — snippet requerido documentado en §7.3. Kai quedó listo para recibirlo por cualquiera de las 3 vías.

**Motor (`server/partner/commission-engine.ts`)** — corre cada 6h + al arranque + botón manual. Solo LEE de LeadPrime y escribe en tablas `referral_*` de Kai:
- **Cobro real** = invoices con `amount_paid > 0` (espejo de Stripe; clave `lp-inv:<stripe_invoice_id>`) + top-ups de wallet con dinero real (`purchase`,`stripe_purchase`,`stripe_recharge`,`recharge`; clave `lp-wtx:<id>`). `subscription_recharge` **excluido** para no comisionar dos veces el mismo dólar de la suscripción.
- Primer cobro (procesado en orden cronológico) llena `first_payment_date`, activa la atribución y ancla el reloj de 12 meses. `charge_date ≤ first_payment + 12 meses` → `tier_year1_pct` (20%); después → `tier_year2_pct` (10%).
- **Reembolsos:** filas negativas compensatorias (`is_reversal=true`), ledger append-only. Automático desde Stripe (refunds de 90 días → match por invoice, clave `lp-refund:<id>`, proporcional en parciales) + reversión manual desde el admin para lo que Stripe no cubre (top-ups, contracargos). `UNIQUE(source_payment_id, is_reversal)` impide duplicados.
- **Cancelaciones:** referido cuyas suscripciones quedan todas `canceled` → atribución `inactive` (deja de generar; lo generado se conserva). Resuscripción de quien ya pagó → reactivación. Usuarios solo-wallet sin suscripción no se tocan.
- Sync serializado (una corrida a la vez) e idempotente (segunda corrida = 0 filas nuevas, verificado).

**Evidencia — validación E2E contra Postgres real (`scripts/validate-partner-portal-e2e.ts`, 43/43 OK):**

```
✅ Atribución vía endpoint (código case-insensitive)
✅ Usuario orgánico (sin código) NO tiene atribución
✅ Registro con código empieza pending_first_payment con first_payment_date NULL
✅ Primer cobro llena first_payment_date y activa la atribución — first_payment=2026-06-05
✅ Comisión 20% sobre invoice de $150 → $30
✅ Top-up real de wallet ($50) genera comisión; subscription_recharge NO
✅ Usuario orgánico que paga NO genera comisión
✅ Referido sin pago NO genera comisión
✅ Cobro dentro de 12 meses → 20%; después de 12 meses → 10% — 2025-05 @20% · 2026-07 @10%
✅ Usuario cancelado → atribución inactive (comisiones previas se conservan)
✅ Sync idempotente: segunda corrida no duplica nada
✅ Reembolso → fila negativa compensatoria (is_reversal)
✅ Doble reversión bloqueada (UNIQUE source+is_reversal)
✅ Suma del dashboard coincide con query directa en la DB — dashboard=220.00 sql=220.00
✅ AISLAMIENTO: socio B ve 0 referidos y $0.00 (los datos de PRIME no se filtran)
✅ AISLAMIENTO: socio B no puede leer documentos por ID ajeno
✅ Liquidación suma pendientes netos (reversiones incluidas) — total=220.00 (7 filas)
(…43 checks en total — correr con: pnpm exec tsx scripts/validate-partner-portal-e2e.ts)
```

## 4. FASE 4 — Dashboard del socio (responsive, branding LeadPrime)

`client/src/partner/**` — tema claro con la paleta oficial (navy `#0B1A2B`, azul `#2E8BE6`, verde `#2AA875`, dorado `#C79A45`, fondo `#F4F7F9`) scoped a `.partner-portal` (el admin de Kai conserva su tema oscuro). Logos oficiales del zip en `client/public/brand/` (optimizados 589KB→17KB sin pérdida visible; favicon desde `leadprime-mark.png`).

- **Onboarding 4 pasos** con barra de progreso que **bloquea el dashboard**: contrato (LeadSign/subida), W-9 (con botón de descarga del PDF oficial del IRS), autorización ACH, confirmación de contacto. Subidas → `partner_documents` vía el storage proxy de Kai (`partner-documents/<partnerId>/…`), 10MB máx, PDF/imagen.
- **Dashboard:** KPIs (referidos totales, activos y pagando, comisión del mes, acumulado del año + por liquidar), tarjeta de cuenta gratis con barra ("2 de 10"), enlace de referido `leadprime.chyrris.com/signup?ref=CODE` con botón copiar, tabla de referidos (negocio, registro, estado, etapa Año 1·20%/Año 2·10%, plan, comisión/mes) — **sin ningún dato sensible del contratista** (verificado: la respuesta del API no contiene emails, teléfonos ni IDs de pago) — e historial de liquidaciones.
- **Zona de documentos** (`/documentos`): ver/subir/actualizar W-9, ACH y contrato después del onboarding.
- **Responsive verificado a 375px**: tabla → tarjetas en móvil, nav inferior, KPIs sin truncar.

**Screenshots** (en `docs/partner-portal/screenshots/`): `partner-login-{desktop,mobile}`, `partner-onboarding-{desktop,mobile}`, `partner-dashboard-{desktop,mobile}`, `partner-documents-desktop`, `admin-partners-desktop`.

## 5. Validación técnica

| Check | Resultado |
|---|---|
| `pnpm run check` (tsc) | ✅ Sin errores |
| `pnpm run build` (vite + esbuild) | ✅ OK |
| Tests vitest nuevos (motor + hostname, 14) | ✅ 14/14 |
| Tests vitest preexistentes | ✅ Los 17 que no requieren DBs vivas pasan; los 7 de `owlfenc-db/owlfenc-postgres` fallan **igual en main** (necesitan DBs reales; verificado con `git stash`) |
| E2E contra Postgres real | ✅ 43/43, re-ejecutable |
| Server de producción (dist) + curl + Playwright | ✅ Portal y admin operando en paralelo en el mismo proceso |
| Review adversarial multi-agente (aislamiento, motor, regresiones) | ✅ Ejecutado; hallazgos confirmados corregidos antes del push |

## 6. Guía de validación en producción para Manus (post-deploy)

1. **Dominio:** `partners.chyrris.com` carga el portal (login LeadPrime); `kai.chyrris.com` sigue mostrando el admin. Repetir los curls de §1 contra producción.
2. **Tablas:** al primer arranque, `ensurePartnerTables()` crea las `referral_*` en la DB de auth de Kai (log `[Partner Tables] referral_* tables ensured`). Query: `SELECT table_name FROM information_schema.tables WHERE table_name LIKE 'referral%' OR table_name LIKE 'partner_%';`
3. **Socio de prueba:** crear desde Kai → llega invitación Resend → fila `status='invited'` → login OTP → `active`.
4. **Motor:** correr `scripts/leadprime-add-referral-code.sql` en la Neon de LeadPrime; registrar usuario de prueba con `?ref=PRIME` (o `POST /api/referrals/attribute`); simular cobro; pulsar "Sincronizar comisiones"; verificar con las queries del E2E (§3). Casos: con/sin código, con/sin pago, año 2 (ajustar `first_payment_date` manualmente hacia atrás >12 meses), reembolso.
5. **Aislamiento:** dos socios de prueba, login con cada uno, confirmar que ninguno ve datos del otro.
6. **Responsive:** abrir el portal en un móvil real o viewport 375px.

## 7. Pendientes que requieren decisión/acción de GELASIO

1. **Railway:** agregar `partners.chyrris.com` como custom domain adicional del servicio de Kai (Settings → Domains). Railway emite el certificado.
2. **Cloudflare:** CNAME `partners` → el target que Railway indique, proxy naranja activado.
3. **Resend:** confirmar el dominio verificado para el remitente y setear `PARTNER_EMAIL_FROM` en Railway (el código usa `no-reply@chyrris.com` por defecto — si `chyrris.com` no está verificado en Resend, los emails no saldrán). `RESEND_API_KEY` ya debe existir en Railway (nunca en el repo).
4. **Variables nuevas en Railway (opcionales, tienen defaults):** `PARTNER_EMAIL_FROM`, `PARTNER_PORTAL_URL`, `PARTNER_PORTAL_HOST`, `REFERRAL_SIGNUP_URL`, `REFERRAL_WEBHOOK_SECRET` (recomendada).
5. **LeadPrime (repo separado, 2 cambios mínimos):** (a) correr `scripts/leadprime-add-referral-code.sql` en su Neon; (b) en el signup, capturar `?ref=` (cookie/localStorage 30 días) y guardarlo en `contractors.referral_code` **o** llamar `POST https://kai.chyrris.com/api/referrals/attribute {referralCode, contractorId}` al crear la cuenta. Con (a) basta: Kai barre la columna automáticamente.
6. **Método de pago de liquidaciones:** el admin registra método libre (ACH/cheque/Zelle) al marcar pagada — definir el proceso operativo real.
7. **Texto final de los emails** (invitación/OTP): borradores en español listos en `server/partner/partner-emails.ts` — revisar tono/es-en.
8. **Primer socio real:** crear "Prime Contractors License Institute Inc." con código `PRIME` desde Kai → Socios → Nuevo socio.

## 8. Problemas encontrados y resolución

| Problema | Decisión conservadora |
|---|---|
| Kai no corre migraciones drizzle en el deploy (start.js solo build+start) | Bootstrap idempotente al arranque (`ensurePartnerTables`, patrón `seedApplications`); la migración canónica queda en `drizzle/0001_daffy_magdalene.sql` |
| El signup de LeadPrime vive en otro repo — no se puede tocar desde aquí | Kai expone 3 vías de atribución (endpoints públicos + sweep de columna + manual); cambio LeadPrime documentado en §7.5 |
| `subscription_recharge` duplicaría la comisión del invoice de suscripción | Excluido del motor (documentado en el código) |
| Reembolsos no existen en el ledger local de LeadPrime | Sweep de Stripe (90 días, proporcional) + reversión manual como respaldo |
| Invoices sin `stripe_invoice_id` no tienen clave idempotente | Se omiten con warning en logs (no se arriesga doble comisión) |
| Socio `paused` | Deja de acumular comisiones nuevas y pierde acceso al portal de inmediato; historial intacto |
| Bundle admin compartido en el dominio de socios (Opción A, una sola SPA) | Datos protegidos a nivel API por hostname+sesión (§1); si en el futuro se quiere separar también el JS, el código de `client/src/partner/` está listo para extraerse |
| KPIs truncados a 375px | Rediseño de tarjeta KPI (ícono junto al label) — verificado con screenshot |

## 9. Lo que NO se tocó (confirmación)

- **Pagos Stripe/Stax y suscripciones:** el motor solo hace `SELECT` sobre `invoices`/`wallet_transactions`/`subscriptions` y lecturas de Stripe (refunds). Cero writes, cero cambios de lógica de cobro.
- **Admin de Kai:** solo se AGREGÓ (ruta `/leadprime/partners`, ítem "Socios", routers `partnerAdmin/partnerAuth/partnerPortal`). Los routers, páginas y auth existentes no cambiaron de comportamiento (único cambio en código existente: `auth.verifyPasscode` rechaza el dominio de socios; en `kai.chyrris.com` funciona igual — verificado por curl).
- **Datos de usuarios/contractors:** solo lectura del mínimo para atribución; el portal del socio nunca expone PII del contratista.
- **Signup de LeadPrime:** sin cambios desde este repo (solo el SQL aditivo opcional de §7.5).

---

## LISTO PARA VALIDACIÓN VISUAL DE GELASIO

Falta únicamente: dominio en Railway+Cloudflare (§7.1–7.2), remitente verificado en Resend (§7.3), los 2 cambios mínimos en LeadPrime (§7.5), y sus decisiones sobre método de liquidación y texto final de emails (§7.6–7.7). Todo lo demás está implementado, probado (43/43 E2E + curl + screenshots web/móvil) y sin tocar los sistemas protegidos.
