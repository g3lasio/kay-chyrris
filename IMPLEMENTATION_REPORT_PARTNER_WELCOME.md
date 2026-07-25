# IMPLEMENTATION REPORT — Bienvenida al completar el onboarding

**Fecha:** 2026-07-25 · **Repo:** `g3lasio/kay-chyrris` · **Rama:** `main`

## La pregunta y la respuesta

**¿Le llegaba algo al socio al terminar su onboarding?** No. El flag `onboarding_complete` se volteaba en silencio, se desbloqueaba el panel de referidos y ya. Ni correo, ni celebración en el portal. El socio cruzaba la meta sin que nadie se lo reconociera.

Ahora sí llegan **dos cosas**, en el mismo instante en que cierra la tercera etapa.

## 1. Correo de bienvenida

Se envía **una sola vez**, cuando las tres etapas quedan completas. Contiene:

- Saludo al contacto por su nombre y confirmación de que ya es socio activo.
- **El eslogan destacado** en un bloque de cita con la barra dorada de la marca — no escondido en el pie:
  > *El que no vive para servir, no sirve para vivir.*
- El mensaje motivador, escrito para conectar con ese eslogan y no sonar a plantilla:
  > *Eso es exactamente lo que empieza hoy. Cada contratista que llegue a LeadPrime por tu recomendación es alguien a quien le abres una puerta: más trabajo, mejor organización, un negocio que crece. La comisión es la consecuencia, no el objetivo. Sirve bien y lo demás llega solo.*
- Sus **dos enlaces de referido** (el corto para bio y el completo), sus tarifas reales de año 1 y año 2 leídas de su ficha, y un botón al panel.

Asunto: **"¡Listo! Ya eres socio activo de LeadPrime"**.

## 2. Bienvenida dentro del portal

Al desbloquearse el panel, arriba del todo aparece una tarjeta de celebración con el mismo eslogan y el mismo mensaje. Es **descartable** (una ✕): la celebración es por llegar, no debe estorbar cada visita. El descarte se guarda por socio en `localStorage`.

## El detalle que importa: enviarlo UNA sola vez

El disparo vive en `getOnboardingState()`, que el dashboard consulta **en cada carga**. Un envío ingenuo ahí mandaría el correo una y otra vez. Tres protecciones:

1. **Claim atómico.** Se reclama el envío con un `UPDATE ... WHERE welcome_email_sent_at IS NULL RETURNING id`; solo el que gana la fila envía. Cuatro cargas simultáneas del dashboard mandan **un** correo, no cuatro.
2. **Una vez para siempre, no una vez por transición.** Si a un socio le rechazan un documento y vuelve a completar el viaje, no recibe una segunda bienvenida — la marca en BD es permanente, no se ata al flanco de subida del flag.
3. **El fallo libera el claim.** Si Resend falla, la marca se borra y la siguiente carga reintenta. Una bienvenida perdida por un error transitorio no volvería nunca. Y si `RESEND_API_KEY` no existe, no se reclama nada: el socio la recibe cuando la variable esté puesta.

Columna nueva: `referral_partners.welcome_email_sent_at`, aditiva e idempotente, en `ensure-tables.ts` (Railway corre `pnpm start`, no `drizzle-kit migrate`) y en `drizzle/0004_welcome_email.sql`.

## Validación

Nuevo E2E `scripts/validate-partner-welcome-e2e.ts`. El SDK de Resend respeta `RESEND_BASE_URL`, así que lo apunté a un **stub HTTP local** que captura el correo real compuesto — destinatario, asunto y cuerpo — sin necesitar cuenta de Resend.

```
✅ Socio recién creado: no se envía bienvenida — enviados=0
✅ Etapas 1 y 2 completas: sigue sin enviarse (falta pago) — enviados=0
✅ Onboarding marcado completo
✅ Al completar las 3 etapas llega la bienvenida — enviados=1
✅ Va al correo del socio — socios@primecontractors.edu
✅ Asunto de bienvenida — ¡Listo! Ya eres socio activo de LeadPrime
✅ Incluye el eslogan
✅ Incluye el mensaje motivador
✅ Incluye el link corto de referido
✅ Incluye las tarifas del socio (20% / 10%)
✅ Registra la marca de envío en la BD
✅ Recargar el dashboard 5 veces NO reenvía — enviados=1
✅ Quitar un documento revierte el onboarding a incompleto
✅ Volver a completar NO envía una segunda bienvenida — enviados=1
✅ 4 cargas simultáneas envían UNA sola bienvenida (claim atómico) — enviados=1
✅ Si el envío falla, la marca se libera (no se pierde la bienvenida)
✅ La siguiente carga reintenta y sí envía — enviados=1
✅ El correo de cada socio lleva SU propio código de referido
✅ Total de bienvenidas = 3 socios completos, una cada uno — enviados=3
══════ BIENVENIDA: 19/19 checks OK ══════
```

Tarjeta del portal, verificada en navegador real:

```
1. Aparece en la primera visita: OK
2. Desaparece al cerrar: OK
3. Sigue oculto tras recargar: OK
4. Descarte por socio (clave): lp_partner_welcome_seen_1
5. Otro navegador/sesión lo vuelve a ver: OK
```

El punto 5 es el límite conocido de `localStorage`: si el socio entra desde otro navegador, la tarjeta reaparece. Es aceptable para una celebración descartable — no vale una columna en BD ni un round-trip extra.

| Check | Resultado |
|---|---|
| `pnpm run check` (tsc) | ✅ |
| `pnpm run build` | ✅ |
| Unit tests | ✅ 32/32 |
| **E2E bienvenida** | ✅ **19/19** |
| E2E admin | ✅ 21/21 sin regresión |
| E2E mejoras | ✅ 25/25 sin regresión |
| E2E base — motor de comisión | ✅ 46/46 sin regresión |

Screenshots en `docs/partner-portal/screenshots/`: `v5-welcome-desktop`, `v5-welcome-mobile` (375px), `v5-welcome-dismissed`.

## Lo que NO se tocó

Motor de comisión, aislamiento multi-tenant, lógica de atribución y el flujo de pagos: intactos. El correo de cada socio lleva su propio código — verificado explícitamente en el E2E.
