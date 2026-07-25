# IMPLEMENTATION REPORT — Portal de Socios · Mejoras (v2)

**Fecha:** 2026-07-25 · **Repo:** `g3lasio/kay-chyrris` (Kai) · **Branch:** `claude/partner-portal-enhancements`
**Base:** el Portal de Socios ya en producción (`partners.chyrris.com`, validado por Manus). Estas 7 mejoras se AGREGAN sobre lo que ya funciona.

> **Nota de branch:** `main` tiene el portal pero **NO** los 13 fixes de seguridad del review anterior (quedaron en la branch `claude/partner-portal-multitenant-qobhrm`, sin mergear). Esta branch parte de esa base con fixes, así que al mergear trae **los fixes de seguridad + las 7 mejoras**. Detalle en §8.

---

## Resumen ejecutivo

| # | Mejora | Estado | Evidencia |
|---|---|---|---|
| 1 | Viaje del socio por etapas (reemplaza checklist plano) | ✅ | screenshots onboarding web+móvil; E2E etapas |
| 2 | Admin sube documentos informativos por socio | ✅ | screenshot admin detalle; E2E aislamiento |
| 3 | Sección "Documentación" enriquecida | ✅ | screenshot documentos |
| 4 | Dashboard de referidos enriquecido | ✅ | screenshot dashboard; E2E plan/costo + fecha estimada + historial |
| 5 | Invitación de referidos por el socio (consentimiento) | ✅ | screenshot invitaciones; E2E invitación→atribución |
| 6 | Espacio de links de LeadPrime (configurable) | ✅ | screenshot dashboard + ajustes admin |
| 7 | Eslogan en el footer (sin atribución) | ✅ | visible en todas las pantallas |
| — | Validación técnica | ✅ `tsc` limpio · build OK · 15 unit + 46 E2E base + 20 E2E mejoras | §9 |

**E2E de mejoras: 20/20 OK** y **E2E base (motor): 46/46 OK**, ambos contra PostgreSQL real con réplica del esquema de LeadPrime. Aislamiento multi-tenant de documentos e invitaciones verificado con dos socios; invitaciones que atribuyen por email; historial mensual que cuadra con query directa.

---

## 1. Viaje del socio por etapas (Mejora 1)

El checklist plano de 4 pasos se convirtió en **3 etapas que se desbloquean secuencialmente**, con indicador de progreso tipo camino (círculos 1·2·3 + barra):

- **Etapa 1 — Revisa los materiales:** el socio ve los documentos informativos que LeadPrime subió para él, **embebidos en un visor** (`PdfViewer`, iframe, sin descarga obligatoria) y marca "He revisado estos materiales" (checkbox → `materials_reviewed_at`, **registro interno, no firma legal**). La etapa 2 queda bloqueada (candado) hasta completar la 1.
- **Etapa 2 — Documentos firmados:** sube el **term sheet firmado** y el **contrato firmado**. El texto aclara que se firman por **LeadSign** (fuera del portal); el portal solo almacena y muestra estado (pendiente/subido/verificado).
- **Etapa 3 — Datos de pago:** autorización **ACH** + confirmar datos de contacto (se mantiene). W-9 disponible como opcional.
- Al completar las 3 → `onboarding_complete=true` → se desbloquea el dashboard.

Server: `getOnboardingState()` reescrito a `OnboardingJourney` (`stages`, `currentStage`, `completedStages`, `complete`). `markMaterialsReviewed()` nuevo. Cliente: `OnboardingChecklist.tsx` reconstruido como viaje + `PdfViewer.tsx`.

## 2. Admin: documentos informativos por socio (Mejora 2)

En la ficha de cada socio (Kai → LeadPrime → Socios → tab **Documentos**), LeadPrime sube documentos **informativos** para ESE socio: **proyección de revenue**, **documento de features**, **term sheet informativo**. Se marcan `verified` automáticamente y aparecen en la Etapa 1 del socio correspondiente. El admin puede reemplazar (subir otro) o eliminar (papelera).

**Modelo de documentos** (distinción clave del brief):
- **Informativos (sube el admin, `uploaded_by='admin'`):** `revenue_projection`, `features`, `term_sheet_info`.
- **Firmados (sube el socio vía LeadSign, `uploaded_by='partner'`):** `term_sheet_signed`, `contract`, `ach_authorization`, `w9`.

Aislamiento: `adminUploadPartnerDocument(partnerId, …)` escribe solo bajo ese `partner_id`; el portal filtra por `ctx.partner.id`. Verificado en E2E (socio B no ve el doc informativo de A).

## 3. Sección "Documentación" enriquecida (Mejora 3)

`PartnerDocuments.tsx` ahora muestra el **expediente completo** en dos bloques: **"Materiales de LeadPrime"** (informativos, solo lectura) y **"Tus documentos firmados"** (term sheet, contrato, ACH, W-9 con subida + estado). Un solo lugar con todo el estado.

## 4. Dashboard de referidos enriquecido (Mejora 4)

Por cada referido la tabla ahora muestra: **negocio, fecha de inicio, estado, etapa (Año 1·20% / Año 2·10%), plan + su costo mensual** (`base_price_cents` de LeadPrime), y la **1ª comisión estimada** — para activos "Generando", para pendientes `signup + ~35 días` (ciclo ACH). Sin PII del contratista (se sigue exponiendo solo el nombre de negocio + plan).

Además, **historial de ingresos mes a mes** (`getMonthlyIncomeHistory`, 12 meses continuos, reversiones netas) en una gráfica de área — para que el socio vea crecer su ingreso recurrente. `isAnimationActive={false}` para render determinista.

## 5. Invitación de referidos por el socio — modelo con consentimiento (Mejora 5)

Sección **"Invitar"** en el portal: el socio escribe **un** email de graduado → el sistema envía por Resend un **enlace personalizado** (`partners.chyrris.com/i/<token>` → 302 al signup de LeadPrime con `?ref=CODE`). El graduado **completa su propio registro** (su consentimiento). El socio ve el estado: **Enviada → Registrada → Activa**.

- **NO se suben listas de terceros:** un correo a la vez, con límite diario (100/socio) y de-dupe por (socio, email). Bloqueo de auto-invitación.
- La atribución **siempre** pasa por el registro del graduado (por `?ref=`), no por subir datos. El status se sincroniza en el sweep del motor (`syncInvitationStatuses` cruza el email de la invitación con el contractor de LeadPrime y su atribución: `registered` al detectar el registro, `active` al primer pago).
- **Modo de aprobación configurable** (`app_settings.invitation_mode`, default `auto`): en `approval`, la invitación queda `pending_approval` hasta que un admin la aprueba desde la ficha del socio (tab Invitaciones). **Decisión documentada:** default automático (fricción mínima); LeadPrime puede exigir aprobación con un clic en Ajustes.

## 6. Espacio de links de LeadPrime (Mejora 6)

Tarjeta **"Links de LeadPrime para compartir"** en el dashboard (landing + sitio de producción, copiables). Como los links exactos los aporta Gelasio, son **configurables desde el admin** (Kai → Socios → ⚙ Ajustes → `app_settings`), con defaults sensatos hasta que se definan. También se pueden fijar por env (`LEADPRIME_LANDING_URL`, `LEADPRIME_PRODUCTION_URL`).

## 7. Eslogan en el footer (Mejora 7)

**"El que no vive para servir, no sirve para vivir."** — sin atribución, discreto, en el footer del portal (todas las pantallas) y en la bienvenida del onboarding y el pie de los emails. El mensaje central sigue siendo funcional.

## 8. Estado de branch / seguridad

`main` = portal **sin** los 13 fixes de seguridad del review previo (incluidos 2 críticos: doble liquidación y doble reversión de reembolso; brute-force de OTP; endpoint de atribución sin auth). Esta branch parte de la rama con esos fixes ya aplicados y verificados, por lo que **el merge de esta branch lleva a `main` los fixes de seguridad + las 7 mejoras**. Recomendado revisar/mergear esta branch (no la vieja) para cerrar ambos.

## 9. Validación

| Check | Resultado |
|---|---|
| `pnpm run check` (tsc) | ✅ Sin errores |
| `pnpm run build` | ✅ OK |
| Unit tests (`server/partner`) | ✅ 15/15 |
| E2E base — motor de comisión (`validate-partner-portal-e2e.ts`) | ✅ 46/46 (sin regresión; onboarding actualizado a 3 etapas) |
| E2E mejoras (`validate-partner-enhancements-e2e.ts`) | ✅ 20/20 |
| Review adversarial (aislamiento, onboarding/dashboard, regresiones) | ✅ Ejecutado; hallazgos confirmados corregidos (ver §11) |

**Evidencia E2E mejoras (extracto):**
```
✅ Bootstrap v2: columnas/tablas/enum nuevos existen
✅ Etapa 1: materiales presentes pero aún NO revisados (bloquea etapa 2)
✅ AISLAMIENTO: socio B no ve el documento informativo de A
✅ AISLAMIENTO: onboarding de B no cuenta materiales de A
✅ Etapa 1 → 2 → 3 se desbloquean; onboarding COMPLETO y persistido
✅ Dashboard: referido activo trae plan + costo mensual (network_elite · $150.00)
✅ Dashboard: referido pendiente muestra 1ª comisión estimada (~35 días)
✅ Historial mensual: 12 puntos y suma cuadra con query directa
✅ Invitación creada (auto) → 'sent'; auto-invitación y duplicado bloqueados
✅ AISLAMIENTO: socio B no ve las invitaciones de A
✅ Enlace de invitación redirige al signup con ?ref del socio
✅ Invitación → registrada y activa al detectar el registro del graduado (por email)
✅ Settings: links guardados; modo aprobación → 'pending_approval' → admin aprueba → 'sent'
══════ MEJORAS: 20/20 checks OK ══════
```

Screenshots web + móvil (375px) en `docs/partner-portal/screenshots/` (prefijo `v2-`): onboarding por etapas, dashboard enriquecido (con gráfica de ingresos), invitaciones, documentación, admin (lista + detalle con subida informativa e invitaciones).

## 10. Lo que NO se tocó (confirmación)

Motor de comisión validado por Manus, atribución por `?ref=`, aislamiento multi-tenant, pagos Stax/Stripe y el admin de Kai existente — todo intacto. Solo se AGREGÓ. El E2E base (46/46) confirma que el motor sigue cuadrando.

## 11. Problemas y decisiones

| Tema | Decisión |
|---|---|
| Kai no corre migraciones en deploy | `ensure-tables.ts` extendido idempotente (ALTER TYPE ADD VALUE IF NOT EXISTS, ADD COLUMN IF NOT EXISTS, CREATE TABLE IF NOT EXISTS); migración drizzle 0002 también idempotente |
| Ciclo de imports invitaciones↔motor | El motor importa `syncInvitationStatuses` con `import()` dinámico (sin ciclo estático) |
| Firma de documentos | Se firman por LeadSign (externo); el portal solo almacena/muestra estado — reflejado en la UI |
| Aprobación de invitaciones | Default `auto`; `approval` configurable desde admin |
| Links exactos de LeadPrime pendientes | Configurables desde admin con defaults; documentado |
| Gráfica de ingresos parpadeaba en captura | Animación de recharts desactivada (render determinista) |

---

## LISTO PARA VALIDACIÓN DE MANUS

Pendientes para Gelasio (no codificables desde aquí): los **links exactos** de LeadPrime (landing/producción) — mientras tanto configurables desde Ajustes; decidir si las invitaciones van **automáticas o con aprobación** (default automático, cambiable con un clic). Todo lo demás está implementado, probado (20/20 + 46/46 E2E + screenshots web/móvil) y sin tocar los sistemas protegidos.
