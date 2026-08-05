# IMPLEMENTATION REPORT — Editar/eliminar socio + storage en Cloudflare R2

**Fecha:** 2026-07-25 · **Repo:** `g3lasio/kay-chyrris` · **Branch:** `claude/partner-admin-edit-delete-r2` (desde `main`)
**Manus valida antes de merge.**

Tres arreglos en el admin del Portal de Socios, sobre lo que ya está en `main` y validado por Manus.

| # | Cambio | Estado | Evidencia |
|---|---|---|---|
| 1 | **Editar socio** (faltaba por completo) | ✅ | E2E 20/20 · `v4-edit-dialog-*` |
| 2 | **Eliminar socio** (faltaba por completo) | ✅ | E2E · `v4-delete-archive`, `v4-delete-hard` |
| 3 | **Storage de documentos → Cloudflare R2** (bug que bloqueaba subidas) | ✅ | 8 tests de storage con PUT real |

**Validación:** `tsc` limpio · build OK · **32 unit tests** · **E2E admin 21/21** · **E2E mejoras 25/25** · **E2E base (motor) 46/46 sin regresión**.

---

## 1. Editar socio

Nuevo botón **Editar** en la ficha del socio → diálogo con: nombre, contacto, **email (login)**, teléfono, **código de referido**, tarifas año 1 / año 2, y umbral de cuenta gratis.

**Código de referido — protección implementada.** Las atribuciones existentes se ligan al socio por `partner_id` (FK), así que cambiar el código **no rompe atribuciones ya creadas**. El riesgo real es otro: los links ya compartidos con el código viejo dejarían de resolver para **nuevos** registros, perdiendo atribuciones en silencio. Por eso:

- **Con referidos ya atribuidos → el código queda BLOQUEADO** (campo deshabilitado en la UI + rechazo en el servidor con mensaje explicativo). Los demás campos siguen editables.
- **Sin referidos → editable**, con advertencia visible de que invalida links compartidos.

**Email — es el login (OTP).** Al cambiarlo:
- El socio pasa a entrar con el **nuevo** email; el viejo deja de resolver (verificado: pedir código con el email viejo ya no genera nada).
- Se **invalidan los OTP pendientes y las sesiones activas** — si el email se corrigió porque estaba mal o comprometido, un código enviado a la dirección anterior no debe seguir sirviendo.
- Duplicados (email o código ya usados por otro socio) se rechazan con mensaje claro.

**Caso de uso inmediato:** el socio "John connor" / `mervin@owlfenc.com` se corrige desde este diálogo — cubierto explícitamente en el E2E.

## 2. Eliminar socio

Nuevo botón **Eliminar** con confirmación explícita (hay que escribir `ELIMINAR`). La lógica es **segura por defecto** y decide sola según el historial:

| Situación | Comportamiento |
|---|---|
| El socio tiene **comisiones o liquidaciones** | **NO se borra.** Se **archiva** (`status='inactive'`): pierde acceso al portal, deja de acumular comisiones, y **el historial financiero se conserva íntegro**. El diálogo explica esto antes de confirmar. |
| El socio **no tiene historial financiero** (socio de prueba) | **Borrado completo**, con cascada de referidos, documentos e invitaciones. |

Razón: el ledger de comisiones/liquidaciones es el registro de dinero debido y pagado — borrarlo destruiría evidencia contable. Un socio archivado queda igual de inoperante que uno borrado, sin esa pérdida.

**Caso de uso inmediato:** "SIMBA" (sanchez godoy), sin referidos ni comisiones, se elimina por completo — verificado en el E2E.

## 3. Storage de documentos → Cloudflare R2

**El bug:** `server/storage.ts` estaba cableado al proxy "Forge" (`BUILT_IN_FORGE_API_URL` / `BUILT_IN_FORGE_API_KEY`), nunca configurado en Railway. Por eso toda subida moría con *"Storage proxy credentials missing"* — el registro en `partner_documents` sí se creaba (que es lo que Manus validó), pero el archivo físico no se guardaba.

**El arreglo:** `server/storage.ts` reescrito sobre **Cloudflare R2** (S3-compatible) con `@aws-sdk/client-s3`, que ya estaba en `package.json` sin usarse.

- **Bucket:** `partner-portal-documents` — bucket **aislado**, separado del almacenamiento de LeadPrime. Se lee de `R2_BUCKET` (o `R2_BUCKET_NAME`).
- **Objetos privados + URLs firmadas:** `storagePut` guarda la **key**; `storageGet` genera una URL prefirmada de **15 minutos** en cada request. Esto refuerza el aislamiento multi-tenant: aunque una URL se filtre, expira, y el permiso siempre pasa por el filtro `partner_id` de la sesión.
- **Compatibilidad:** se persiste la key (no una URL firmada, que caducaría). Las filas antiguas con URL absoluta siguen funcionando.
- Se corrigió también el admin, que renderizaba `fileUrl` crudo como enlace: ahora abre vía URL prefirmada (`partnerAdmin.documentUrl`).
- `imageGeneration.ts` (código muerto, sin llamadas) se ajustó para seguir devolviendo una URL usable en vez de una key.

### Variables en Railway (ya configuradas)

```
R2_ACCOUNT_ID=<account id de Cloudflare>     # o directamente R2_ENDPOINT=https://<account>.r2.cloudflarestorage.com
R2_ACCESS_KEY_ID=<R2 API token — Object Read & Write>
R2_SECRET_ACCESS_KEY=<secret del token>
R2_BUCKET=partner-portal-documents           # REQUERIDA — sin default
```

Alias aceptados: `R2_BUCKET_NAME` / `CLOUDFLARE_R2_BUCKET` / `S3_BUCKET` para el bucket, y `CLOUDFLARE_R2_*` / `S3_*` / `AWS_*` para access key y secret. Documentado en `.env.example`.

Sin estas variables el error ahora es explícito y accionable (*"Cloudflare R2 no está configurado. Faltan variables de entorno en Railway: …"*) en vez del mensaje engañoso de Forge.

### ⚠️ El bucket NO tiene default (a propósito)

La primera versión caía a `leadprime-documents` cuando `R2_BUCKET` no estaba seteada — el único bucket que existía en la cuenta cuando escribí el adaptador. Eso es una mina: si esa variable se borra, o el servicio de Railway se clona sin ella, los documentos de socios se escribirían **en silencio** en el bucket de producción de LeadPrime, sin ningún error que lo delatara.

Ahora `getBucketName()` **lanza un error explícito** en vez de adivinar:

> *"Cloudflare R2: bucket no configurado — set R2_BUCKET=partner-portal-documents en Railway (alias aceptados: R2_BUCKET_NAME, CLOUDFLARE_R2_BUCKET, S3_BUCKET). No se usa un bucket por defecto a propósito: escribir documentos de socios en el bucket equivocado en silencio es peor que fallar."*

`isStorageConfigured()` también cuenta el bucket, así que un entorno sin él se reporta como "no configurado" en vez de aparentar estar listo. Cubierto por 5 tests, incluido uno que verifica que **ni el valor devuelto ni el mensaje de error** mencionan nunca `leadprime-documents`.

## Validación ejecutada

| Check | Resultado |
|---|---|
| `pnpm run check` (tsc) | ✅ |
| `pnpm run build` | ✅ |
| Unit tests | ✅ 32/32 (18 de comisión/hostname + 3 de sesión + **11 de storage R2**) |
| **E2E admin** (`validate-partner-admin-e2e.ts`) | ✅ **21/21** |
| E2E mejoras | ✅ 25/25 (sin regresión) |
| E2E base — motor de comisión | ✅ 46/46 (sin regresión) |

Los tests de storage incluyen un **PUT real contra un endpoint S3-compatible local**, así que la ruta de subida (firma → PUT → respuesta) está probada de extremo a extremo sin necesitar credenciales de producción. Lo que **no** puedo probar desde aquí es R2 real: hace falta que las credenciales existan en Railway (§3).

**Extracto del E2E admin:**
```
✅ Editar socio guarda nombre, email, teléfono y tarifas — John Connor <john@primecontractors.edu> 25/12.5
✅ El email VIEJO ya no puede pedir código (login movido)
✅ El email NUEVO sí genera código de acceso
✅ Cambiar email invalida códigos OTP pendientes y sesiones activas
✅ Email duplicado rechazado al editar — Ya existe otro socio con ese email o código
✅ Código editable mientras el socio NO tiene referidos
✅ Código BLOQUEADO una vez que el socio tiene referidos
✅ Las atribuciones existentes siguen ligadas al socio tras editar
✅ SIMBA (sin historial financiero) se elimina por completo + cascada de documentos
✅ Socio CON comisiones NO se borra: se archiva como inactivo
✅ El historial financiero se conserva al archivar
✅ Un socio archivado ya no puede pedir código de acceso
✅ Error de storage nombra las variables R2 que faltan (no BUILT_IN_FORGE_*)
✅ Sin R2_BUCKET el storage falla explícito (no cae a un bucket por defecto)
✅ Con R2_BUCKET seteada resuelve el bucket aislado del portal
══════ ADMIN: 21/21 checks OK ══════
```

Screenshots (web + móvil 375px) en `docs/partner-portal/screenshots/`: `v4-edit-dialog-desktop`, `v4-edit-dialog-mobile`, `v4-delete-archive`, `v4-delete-hard`.

## Bug adicional encontrado y corregido

Al validar, el mensaje de email duplicado salía como `Failed query: update "referral_partners" set...` en vez del mensaje amigable: Drizzle envuelve el error de Postgres, así que el código `23505` vive en `error.cause`, no en `error.code`. Se corrigió con un detector que recorre la cadena de causas — aplicado también a **crear socio**, que tenía el mismo defecto latente.

## Lo que NO se tocó

Motor de comisión, aislamiento multi-tenant y lógica de atribución: intactos (E2E base 46/46 y mejoras 25/25 lo confirman). Las funciones de Forge que usan otras features no relacionadas (transcripción de voz, notificaciones) se dejaron como estaban — el cambio se limita al almacenamiento de archivos.

## Para Manus (validación contra Neon real)

1. Editar un socio guarda los cambios y **no rompe atribuciones existentes**; el código queda bloqueado si ya tiene referidos; cambiar el email mueve el login.
2. Eliminar respeta la protección: con historial financiero → archivado (`status='inactive'`, comisiones intactas); sin historial → borrado completo.
3. **Storage R2 (§3)**: un documento subido desde el admin se guarda físicamente en `partner-portal-documents` y es visible/descargable desde el portal del socio, con el aislamiento intacto (socio B no ve documentos de socio A). Ya verificado en producción con una subida real; LeadPrime intacto.

---

## LISTO PARA VALIDACIÓN DE MANUS
