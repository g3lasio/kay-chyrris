# Subida de documentos en el admin de socios + categoría Reporte

**Branch:** `claude/partner-portal-admin-docs-upload` (desde `main`) · **Manus valida antes de merge**

Cierra el hueco de UI: en Kai (ficha del socio → pestaña **Documentos**) el admin
ahora tiene un flujo claro para **subir documentos** para ese socio, y una
**categoría nueva "Reporte"** con título libre. El backend de `partner_documents`
y el aislamiento ya estaban validados por Manus; esto conecta la UI y agrega la
categoría de reportes.

## Qué se agregó

1. **Botón "Subir documento"** en la pestaña Documentos → abre un diálogo con:
   - **Categoría**: Materiales informativos (proyección de revenue / documento de
     features / term sheet informativo) o **Reporte**.
   - **Título del reporte** (campo libre, requerido solo para Reporte — ej.
     "Reporte Q3 2026 de referidos").
   - **Archivo** (PDF/imagen, máx 10 MB).
   - Al subir → se asigna automáticamente a ESE socio (`partner_id` de la ficha).

2. **Categoría "Reporte"** (nueva): documento libre y recurrente para reportes
   trimestrales u otros entregables post-onboarding. Se guarda con `doc_type='report'`
   y su `title`. Aparece en el portal del socio en una sección **"Reportes"**
   (aparte de "Materiales de LeadPrime" y "Tus documentos firmados"). NO cuenta
   como material de onboarding (Etapa 1).

3. **Expediente completo en el admin**: la tabla de la pestaña muestra TODO —
   lo que subió el admin (materiales + reportes, etiqueta **LeadPrime**, con
   botón eliminar) y lo que subió el **socio** firmado (term sheet, contrato,
   ACH, W-9), con su **estado** (subido / verificado) y botón **Verificar**.

4. **Aislamiento multi-tenant**: cada documento pertenece a un solo socio. El
   endpoint asigna por el `partner_id` de la ficha; el portal filtra por la
   sesión del socio. Ningún socio ve los de otro (E2E lo prueba con dos socios).

## Modelo de datos (aditivo)

- `partner_doc_type` enum → agregado `report`.
- `partner_documents` → columna nullable `title` (título de admin para reportes).
- Migración `drizzle/0003_flashy_meltdown.sql` (idempotente) + `ensure-tables.ts`
  (ALTER TYPE ADD VALUE IF NOT EXISTS, ADD COLUMN IF NOT EXISTS).

## Validación

- `tsc` limpio · build OK · 18 unit tests.
- **E2E mejoras 25/25** (4 nuevos de reportes: título requerido, aislamiento
  entre socios, el reporte no cuenta como material de onboarding).
- **E2E base 46/46** (sin regresión al motor de comisión).
- **Fresh-DB bootstrap**: DB vacía → tablas + columna `title` + enum `report`
  creados; idempotente.
- Screenshots web + móvil del flujo completo (admin sube → aparece en el portal
  del socio): `docs/partner-portal/screenshots/v3-*`.

## Para Manus

Validar contra Neon real: que la subida guarde en `partner_documents` con el
`partner_id` correcto, que el reporte aparezca en el portal del socio correcto
(sección Reportes) con su título, y que el aislamiento se mantenga (socio A no ve
documentos de socio B). No toca el motor de comisión ni el aislamiento ya validado.
