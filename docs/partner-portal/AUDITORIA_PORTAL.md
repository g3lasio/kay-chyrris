# Auditoría final del Portal de Socios — visual, lógica y seguridad

**Fecha:** 2026-07-26 · **Alcance:** páginas y backend del portal (`partners.chyrris.com`)

Inspección completa sobre el portal ya en producción. Resultado: **la estructura está sana** — el aislamiento multi-tenant, la autenticación y el motor de comisión resistieron todas las sondas. Se corrigieron **tres defectos**, ninguno crítico, todos reales.

---

## Lo que se corrigió

### 1. Las tarjetas de subida ignoraban lo ya entregado *(funcional, visible)*

En **Documentación**, las cuatro tarjetas (`term sheet`, `contrato`, `ACH`, `W-9`) se renderizaban sin la prop `done`, así que siempre decían *"Subir contrato"* — mientras la tabla justo debajo, en la misma pantalla, mostraba ese mismo contrato como **Verificado**. El socio veía dos mensajes contradictorios y podía subir duplicados sin darse cuenta.

El componente ya soportaba el estado (`Reemplazar` con palomita verde) y se usaba bien en el onboarding; simplemente no se le pasaba en esta página.

**Verificado en navegador real:**
```
PRIME (3 firmados subidos): Reemplazar=3  Subir=1   ← el W-9 que falta
SUR   (nada subido):        Reemplazar=0  Subir=4
```

### 2. El correo de bienvenida bloqueaba la carga del panel *(robustez)*

El envío se disparaba desde `getOnboardingState()`, que es una **query** que el dashboard consulta en cada carga, y se hacía con `await`. El SDK de Resend usa `fetch` sin timeout por defecto: un envío colgado habría convertido en un error justo la carga en la que el socio termina su onboarding — el peor momento posible.

Ahora es fire-and-forget con su propio `try/catch`, así que el correo nunca puede tumbar la query en la que viaja. Las garantías de "una sola vez" no cambian: siguen viviendo en el claim atómico de BD, no en el orden de ejecución. El E2E se ajustó para esperar el envío en vez de asumirlo síncrono — 19/19 sigue pasando.

Además, tras un envío exitoso se limpia la caché de sesión del socio, para que la siguiente carga tome el atajo en memoria en vez de repetir el `UPDATE` guardado (correcto, pero innecesario) durante un minuto.

### 3. Comparación no constante del secreto del webhook *(seguridad, severidad baja)*

`POST /api/referrals/attribute` comparaba el header con `!==`. Ese secreto es lo único que separa al internet público de la capacidad de **secuestrar atribuciones** (y con ellas, comisiones). Una comparación byte a byte con salida temprana filtra el secreto de a un carácter para quien pueda medir tiempos de respuesta.

Ahora usa `timingSafeEqual`, con trabajo comparable también en la rama de longitud distinta.

**Verificado contra el servidor:**
```
secreto correcto        → pasa el gate
secreto, misma longitud → Unauthorized
secreto, otra longitud  → Unauthorized
sin header              → Unauthorized
código inválido         → "Attribution rejected"  (mensaje idéntico al de
contratista inexistente → "Attribution rejected"   contratista desconocido)
```
El último par importa: los dos casos devuelven exactamente el mismo texto, así que el endpoint no sirve como oráculo para descubrir códigos de referido válidos.

---

## Lo que se revisó y quedó igual

### Aislamiento multi-tenant — sondas contra el servidor vivo

```
Socio B pidiendo los documentos 1–4 del socio A  → 404 en los cuatro
Sin sesión, pidiendo el dashboard                → 401
Sesión de SOCIO invocando partnerAdmin.list      → 401
Cookie de sesión inventada                       → sin sesión (null)
```

En el router del portal **ninguna** consulta acepta un `partnerId` del cliente: los 3 puntos donde aparece lo toman de `ctx.partner.id` (sesión) o filtran por él en SQL. Los 20 procedimientos de `partnerAdmin` usan `protectedProcedure` sin excepción — no hay ni un `publicProcedure` ni un `partnerProcedure` filtrado.

### Autenticación OTP

Códigos de 6 dígitos con `crypto.getRandomValues`, guardados con bcrypt, 10 min de vida. Contador de intentos **atómico en SQL** (`attempts = attempts + 1` con guarda), así que llamadas concurrentes no pueden leer todas `attempts=0` y saltarse el tope. Respuesta neutral siempre, con relleno de tiempo real vía `bcrypt.hash` para que la latencia no delate si el correo existe. Socios `paused`/`inactive` pierden acceso a mitad de sesión, no solo al entrar.

### Subida de archivos

`fileName` se sanea con `[^\w.\-]+ → _`, lo que elimina las barras: probé mentalmente `../../otro-socio/x.pdf` y colapsa a `.._.._otro-socio_x.pdf` — no hay traversal posible fuera del prefijo `partner-documents/<partnerId>/`. Lista blanca de MIME sin `image/svg+xml` (que puede llevar script). Tope de 10 MB. Los objetos son privados y solo se sirven por URL prefirmada de 15 minutos.

### Redirect de invitaciones

`/i/:token` **no** es un redirect abierto: el destino siempre se construye desde `REFERRAL_SIGNUP_URL` más el código del propio socio, nunca desde la entrada del usuario. Un token inventado cae al signup plano.
```
/i/tok_demo_0001        → https://leadprime.chyrris.com/signup?ref=PRIME
/i/https:%2F%2Fevil.com → https://leadprime.chyrris.com/signup
```

### Invitaciones a graduados

Tope diario por socio, deduplicación por (socio, correo), bloqueo de auto-invitación, y el asunto del correo se limpia de `\r\n` (inyección de cabeceras). Todo lo interpolado en el HTML pasa por `esc()`.

### Visual — 10 capturas, escritorio 1440px y móvil 375px

Login, onboarding, panel, documentación e invitaciones, en ambos anchos. **Cero desbordes horizontales** (medido con `scrollWidth - clientWidth` en cada página). Sin errores de JavaScript.

Los únicos 500 aparecen en el visor de PDF del onboarding y son R2 sin credenciales en el entorno local; en producción el visor funciona. Aun así verifiqué la degradación: el visor no se queda colgado — resuelve al mensaje *"No se pudo cargar la vista previa"* en ~6 s tras agotar reintentos, y la etapa 1 sigue siendo completable.

---

## Validación

| Check | Resultado |
|---|---|
| `pnpm run check` (tsc) | ✅ |
| `pnpm run build` | ✅ |
| Unit tests | ✅ 32/32 |
| E2E bienvenida | ✅ 19/19 |
| E2E admin | ✅ 21/21 |
| E2E mejoras | ✅ 25/25 |
| E2E base — motor de comisión | ✅ 46/46 |

Nota: `owlfenc-postgres.test.ts` y `owlfenc-db.test.ts` (7 tests) fallan por falta de una base de OwlFenc real en este entorno. Es preexistente y ajeno al portal.
