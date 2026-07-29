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

---

# Anexo — Móvil: el admin de socios (`kai.chyrris.com`)

**Fecha:** 2026-07-26 · **Reportado por Gelasio desde el teléfono**

La auditoría anterior cubrió el portal del socio (`partners.chyrris.com`), no el **admin de Kai**. Ahí estaba el problema: no se podían subir documentos desde el teléfono.

## La causa

`TabsTrigger` de shadcn tiene `h-[calc(100%-1px)]` — cada pestaña mide el alto del **contenedor completo**, no el de su fila. La lista tenía `flex-wrap`, así que a 375px las cinco pestañas se envolvían en tres filas y **las cinco se dibujaban a la misma altura, una encima de otra**. Las tres últimas quedaban tapadas.

Reproducido con Playwright antes del arreglo:

```
pestaña Referidos:     visible=true  clic=true
pestaña Comisiones:    visible=true  clic=true
pestaña Documentos:    visible=true  clic=FALSE   ← la de subir archivos
pestaña Invitaciones:  visible=true  clic=FALSE
pestaña Liquidaciones: visible=true  clic=FALSE
botón "Subir documento" no encontrado
DESBORDE HORIZONTAL: 53px  (en las 4 pantallas)
```

No era un problema de estética: la pestaña Documentos era **físicamente intocable**, y es la única vía para subirle un archivo a un socio.

## Los arreglos

1. **Pestañas que se desplazan en vez de envolverse.** Una sola fila dentro de un contenedor con scroll horizontal, que es el patrón estándar en móvil y mantiene válido el `h-[calc(100%-1px)]`. Radix trae la pestaña activa a la vista sola.
2. **Alto táctil.** `h-11` en teléfono (`sm:h-9` en escritorio): las pestañas medían ~30px, por debajo de cualquier objetivo cómodo para el dedo.
3. **La fila de acciones del encabezado desbordaba** 53px — "Nuevo socio" quedaba cortado contra el borde. Le faltaba `flex-wrap`.
4. **Selector de archivo.** El control nativo mostraba *"Choose File / No file chosen"* — texto en inglés dentro de una interfaz en español, y un objetivo diminuto. Ahora es un botón real de ancho completo que muestra el nombre y el peso del archivo elegido, igual que en el lado del socio.
5. **Nombre del documento**, el control que se toca para abrirlo desde el teléfono: `py-2` para darle área de dedo.
6. **La ✕ de los diálogos** pasó a `p-2` con desplazamiento compensado — misma apariencia, área táctil de dedo. Es el primitivo compartido, así que mejora todos los diálogos de Kai sin mover un pixel visible.

## Verificación

**Subida real de punta a punta desde un iPhone simulado** (375px, touch, user-agent de Safari iOS), con R2 apuntando a un stub S3 local:

```
abrí la ficha del socio
toqué la pestaña Documentos
abrí el diálogo
elegí categoría Reporte y puse título
el botón muestra el archivo elegido: sí
toqué Subir documento

RESULTADO: el documento aparece en la lista del socio → SÍ
desborde horizontal: 0px

PUT recibido por el stub S3:
  /partner-portal-documents/partner-documents/1/report/…-reporte-movil.pdf  (38 bytes)
```

El PUT confirma la ruta completa: bucket aislado + prefijo por socio.

**Barrido de 18 estados** — admin a 375px (lista, alta, ficha, las 5 pestañas, editar, eliminar), admin a **320px** (el ancho más estrecho aún en uso), y las 3 páginas del portal del socio:

```
--- HALLAZGOS ---
ninguno
```

Cero desbordes horizontales, cero errores de JavaScript, cero controles por debajo de 32px de alto.

Capturas: `v6-admin-detalle-movil`, `v6-admin-documentos-movil`, `v6-admin-subida-movil`, `v6-admin-detalle-320px`.
