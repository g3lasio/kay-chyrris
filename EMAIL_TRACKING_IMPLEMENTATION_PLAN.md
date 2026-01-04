# 📋 Plan de Implementación: Email Tracking System

**Proyecto:** Owl Fenc  
**Objetivo:** Rastrear TODOS los envíos de email para control de límite Resend (500/día)  
**Prioridad:** 🚨 CRÍTICA

---

## 🎯 Objetivo

Implementar un sistema centralizado que registre cada email enviado por Owl Fenc en Firestore collection `email_logs`, permitiendo:

1. Conteo preciso de emails por día (global)
2. Conteo preciso de emails por usuario
3. Alertas tempranas cuando se acerca al límite
4. Análisis de qué features consumen más emails

---

## 📊 Estado Actual

### ✅ Chyrris KAI (Backend de monitoreo)
- **LISTO:** Ya consulta `email_logs` collection
- **LISTO:** Ya calcula emails/día y % de uso
- **LISTO:** Frontend muestra datos en Usage System
- **PROBLEMA:** Collection `email_logs` está vacía porque Owl Fenc no escribe ahí

### ❌ Owl Fenc (App principal)
- **PROBLEMA:** NO existe tracking de emails
- **PROBLEMA:** NO escribe a `email_logs` collection
- **RIESGO:** Podemos exceder 500 emails/día sin saberlo

---

## 🏗️ Arquitectura de Solución

### Punto de Integración Único

**Archivo:** `server/services/resendService.ts`  
**Línea:** 282 (donde se llama `resend.emails.send()`)

**Ventaja:** Modificando 1 solo archivo, capturamos TODOS los emails del sistema.

### Flujo Propuesto

```
┌─────────────────────────────────────────────────────────────┐
│ 1. Usuario solicita envío (invoice, estimate, etc.)         │
└──────────────────────┬──────────────────────────────────────┘
                       ↓
┌─────────────────────────────────────────────────────────────┐
│ 2. Servicio específico (invoiceEmailService, etc.)          │
│    Prepara datos del email                                   │
└──────────────────────┬──────────────────────────────────────┘
                       ↓
┌─────────────────────────────────────────────────────────────┐
│ 3. resendService.sendEmail()                                 │
│    - Valida datos                                            │
│    - Prepara payload                                         │
└──────────────────────┬──────────────────────────────────────┘
                       ↓
┌─────────────────────────────────────────────────────────────┐
│ 4. resend.emails.send(payload) ← ENVÍO REAL                 │
└──────────────────────┬──────────────────────────────────────┘
                       ↓
┌─────────────────────────────────────────────────────────────┐
│ 5. ✅ NUEVO: emailTrackingService.logEmailSent()            │
│    - Escribe a Firestore email_logs                          │
│    - NO bloquea si falla                                     │
└──────────────────────┬──────────────────────────────────────┘
                       ↓
┌─────────────────────────────────────────────────────────────┐
│ 6. Chyrris KAI lee email_logs y muestra estadísticas        │
└─────────────────────────────────────────────────────────────┘
```

---

## 📝 Implementación Paso a Paso

### Paso 1: Crear Email Tracking Service

**Archivo:** `server/services/emailTrackingService.ts` (NUEVO)

```typescript
import { db } from '../lib/firebase';

export interface EmailLogData {
  userId: string;
  emailType: string; // 'invoice', 'estimate', 'contract', 'payment', 'notification', 'otp', 'other'
  recipient: string;
  subject: string;
  success: boolean;
  sentAt: Date;
  resendMessageId?: string;
  errorMessage?: string;
}

/**
 * Log email send to Firestore for tracking and analytics
 * IMPORTANT: This function should NEVER throw errors to avoid blocking email sends
 */
export async function logEmailSent(data: EmailLogData): Promise<void> {
  try {
    console.log('[EMAIL-TRACKING] Logging email send:', {
      userId: data.userId,
      emailType: data.emailType,
      recipient: data.recipient,
      success: data.success
    });

    await db.collection('email_logs').add({
      userId: data.userId,
      emailType: data.emailType,
      recipient: data.recipient,
      subject: data.subject,
      success: data.success,
      sentAt: data.sentAt,
      resendMessageId: data.resendMessageId,
      errorMessage: data.errorMessage,
      createdAt: new Date()
    });

    console.log('[EMAIL-TRACKING] Email logged successfully');
  } catch (error) {
    // CRITICAL: Never throw errors - tracking failures should not block email sends
    console.error('[EMAIL-TRACKING] Error logging email (non-blocking):', error);
  }
}

/**
 * Get today's email count (for limit checking)
 */
export async function getTodayEmailCount(): Promise<number> {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const snapshot = await db.collection('email_logs')
      .where('sentAt', '>=', today)
      .where('success', '==', true)
      .count()
      .get();

    return snapshot.data().count;
  } catch (error) {
    console.error('[EMAIL-TRACKING] Error getting today email count:', error);
    return 0;
  }
}

/**
 * Check if we're approaching the daily limit (500 emails/day for Resend free tier)
 */
export async function checkEmailLimit(): Promise<{
  count: number;
  limit: number;
  percentage: number;
  warning: boolean;
  critical: boolean;
}> {
  const count = await getTodayEmailCount();
  const limit = 500; // Resend free tier limit
  const percentage = (count / limit) * 100;

  return {
    count,
    limit,
    percentage,
    warning: percentage >= 80, // Warning at 80% (400 emails)
    critical: percentage >= 90 // Critical at 90% (450 emails)
  };
}
```

---

### Paso 2: Modificar resendService.ts

**Archivo:** `server/services/resendService.ts`  
**Línea:** 282 (después de `resend.emails.send()`)

```typescript
// IMPORTAR al inicio del archivo
import * as emailTrackingService from './emailTrackingService';

// ... código existente ...

// MODIFICAR la función sendEmail() alrededor de la línea 282:

async sendEmail(emailData: EmailData): Promise<boolean> {
  try {
    // ... validaciones existentes ...

    const result = await resend.emails.send(emailPayload);

    // ✅ NUEVO: Track email send
    await emailTrackingService.logEmailSent({
      userId: emailData.userId || 'system', // Pasar desde servicios superiores
      emailType: emailData.emailType || 'general',
      recipient: emailData.to,
      subject: emailData.subject,
      success: !!result.data?.id,
      sentAt: new Date(),
      resendMessageId: result.data?.id,
      errorMessage: result.error?.message
    });

    if (result.data?.id) {
      console.log('✅ [RESEND] Email enviado exitosamente');
      return true;
    } else {
      console.error('❌ [RESEND] Respuesta sin ID:', result);
      return false;
    }
  } catch (error) {
    console.error('❌ [RESEND] Error:', error);

    // ✅ NUEVO: Track failed email
    await emailTrackingService.logEmailSent({
      userId: emailData.userId || 'system',
      emailType: emailData.emailType || 'general',
      recipient: emailData.to,
      subject: emailData.subject,
      success: false,
      sentAt: new Date(),
      errorMessage: error instanceof Error ? error.message : 'Unknown error'
    });

    return false;
  }
}
```

---

### Paso 3: Actualizar Interface EmailData

**Archivo:** `server/services/resendService.ts`  
**Línea:** 29 (interface EmailData)

```typescript
export interface EmailData {
  to: string;
  subject: string;
  html: string;
  from?: string;
  replyTo?: string;
  attachments?: Array<{
    filename: string;
    content: Buffer | string;
    contentType?: string;
  }>;
  // ✅ NUEVOS CAMPOS para tracking
  userId?: string; // Firebase UID del usuario que envía
  emailType?: string; // Tipo de email: 'invoice', 'estimate', 'contract', etc.
}
```

---

### Paso 4: Actualizar Servicios de Email

Modificar cada servicio para pasar `userId` y `emailType` al llamar `resendService.sendEmail()`.

#### 4.1 invoiceEmailService.ts

```typescript
// Línea 183 (aproximadamente)
const emailSent = await resendService.sendEmail({
  to: data.client.email,
  subject: `Factura ${data.invoice.number} - ${data.contractor.company}`,
  html: html,
  replyTo: data.contractor.email,
  // ✅ NUEVO
  userId: data.userId, // Pasar desde la función sendInvoiceEmail
  emailType: 'invoice'
});
```

#### 4.2 estimateEmailService.ts

```typescript
await resendService.sendEmail({
  to: estimateData.client.email,
  subject: `Presupuesto ${estimateData.estimate.number}`,
  html: html,
  replyTo: estimateData.contractor.email,
  // ✅ NUEVO
  userId: estimateData.userId,
  emailType: 'estimate'
});
```

#### 4.3 Otros servicios

Repetir el patrón para:
- `contractorEmailService.ts` → `emailType: 'contract'`
- `projectPaymentService.ts` → `emailType: 'payment'`
- `subscriptionEmailService.ts` → `emailType: 'subscription'`
- `trialNotificationService.ts` → `emailType: 'notification'`
- `otp-service.ts` → `emailType: 'otp'`
- `emailService.ts` → `emailType: 'general'`

---

## 🧪 Testing

### Test 1: Envío de Invoice

```bash
# En Owl Fenc, enviar un invoice de prueba
# Verificar en Firestore console que se creó documento en email_logs
```

**Verificación en Firestore:**
```
Collection: email_logs
Document ID: (auto-generated)
{
  userId: "qztot1YEy3UWz605gIH2iwwWhW53",
  emailType: "invoice",
  recipient: "client@example.com",
  subject: "Factura #12345 - Owl Fenc",
  success: true,
  sentAt: Timestamp,
  resendMessageId: "re_abc123",
  createdAt: Timestamp
}
```

### Test 2: Verificar en Chyrris KAI

```bash
# Abrir Chyrris KAI → Usage System
# Verificar que "Emails Sent (Today)" muestra 1
# Verificar que el usuario muestra 1 en columna "Emails"
```

### Test 3: Enviar múltiples emails

```bash
# Enviar 5 invoices diferentes
# Verificar que el contador aumenta a 5
# Verificar que cada usuario muestra su count individual
```

---

## ⚠️ Consideraciones Importantes

### 1. No Bloquear Envíos
- El tracking NUNCA debe impedir que un email se envíe
- Si `logEmailSent()` falla, solo se registra en console.error
- El usuario no debe ver errores de tracking

### 2. Performance
- `logEmailSent()` es async pero no esperamos su resultado
- No añade latencia significativa al envío de emails
- Firestore maneja escrituras concurrentes sin problema

### 3. Datos Sensibles
- NO guardar contenido HTML del email (solo metadata)
- NO guardar información de pago en logs
- Recipient email es necesario para debugging

### 4. Límite de Resend
- Resend free tier: 500 emails/día
- Alertar a admin cuando > 400 emails (80%)
- Considerar upgrade si se acerca al límite frecuentemente

---

## 📊 Schema de email_logs Collection

```typescript
interface EmailLog {
  userId: string; // Firebase UID
  emailType: string; // 'invoice' | 'estimate' | 'contract' | etc.
  recipient: string; // Email del destinatario
  subject: string; // Asunto del email
  success: boolean; // true si se envió correctamente
  sentAt: Timestamp; // Fecha/hora de envío
  resendMessageId?: string; // ID de Resend (si success=true)
  errorMessage?: string; // Mensaje de error (si success=false)
  createdAt: Timestamp; // Timestamp de creación del log
}
```

---

## 🚀 Roadmap de Implementación

### Fase 1: Core Implementation (1-2 horas)
- [ ] Crear `emailTrackingService.ts`
- [ ] Modificar `resendService.ts` para tracking
- [ ] Actualizar interface `EmailData`
- [ ] Test básico con 1 invoice

### Fase 2: Service Integration (2-3 horas)
- [ ] Actualizar `invoiceEmailService.ts`
- [ ] Actualizar `estimateEmailService.ts`
- [ ] Actualizar `contractorEmailService.ts`
- [ ] Actualizar `projectPaymentService.ts`
- [ ] Actualizar otros servicios menores

### Fase 3: Testing & Validation (1 hora)
- [ ] Test envío de invoice
- [ ] Test envío de estimate
- [ ] Test envío de contract
- [ ] Verificar counts en Chyrris KAI
- [ ] Verificar per-user counts

### Fase 4: Monitoring & Alerts (30 min)
- [ ] Verificar alertas en Chyrris KAI cuando > 80%
- [ ] Verificar alertas cuando > 90%
- [ ] Documentar proceso de upgrade de Resend si necesario

---

## 📈 Métricas de Éxito

1. ✅ Todos los emails enviados aparecen en `email_logs`
2. ✅ Count global en Chyrris KAI coincide con Firestore
3. ✅ Count per-user es preciso
4. ✅ Alertas funcionan cuando se acerca al límite
5. ✅ No hay errores de tracking bloqueando envíos

---

## 🔗 Archivos a Modificar

### Nuevos
1. `server/services/emailTrackingService.ts` (CREAR)

### Modificar
1. `server/services/resendService.ts` (línea 29 y 282)
2. `server/services/invoiceEmailService.ts`
3. `server/services/estimateEmailService.ts`
4. `server/services/contractorEmailService.ts`
5. `server/services/projectPaymentService.ts`
6. `server/services/subscriptionEmailService.ts`
7. `server/services/trialNotificationService.ts`
8. `server/services/otp-service.ts`
9. `server/services/emailService.ts`

---

**Estimación Total:** 4-6 horas de desarrollo + testing  
**Prioridad:** 🚨 CRÍTICA  
**Riesgo si no se implementa:** Exceder límite de Resend y perder servicio de email

---

**Autor:** Manus AI  
**Fecha:** 2026-01-03  
**Revisión:** Gelasio Sanchez
