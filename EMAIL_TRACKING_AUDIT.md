# 🚨 AUDITORÍA CRÍTICA: Sistema de Tracking de Emails - Owl Fenc

**Fecha:** 2026-01-03  
**Criticidad:** ALTA  
**Límite Resend:** 500 emails/día  
**Estado Actual:** ❌ SIN TRACKING

---

## 📊 Resumen Ejecutivo

**HALLAZGO CRÍTICO:** Actualmente NO existe ningún sistema de tracking de emails en Owl Fenc. Esto significa:

- ✅ Emails se están enviando correctamente
- ❌ NO se está contando cuántos emails se envían por día
- ❌ NO se está rastreando qué usuario envía cada email
- ❌ NO hay forma de saber si estamos cerca del límite de 500/día
- ❌ Riesgo de exceder límite y perder servicio de email

---

## 🔍 Servicios de Email Identificados

### Servicios Principales (9 archivos)
1. **invoiceEmailService.ts** - Envío de facturas a clientes
2. **estimateEmailService.ts** - Envío de presupuestos
3. **contractorEmailService.ts** - Emails de contratistas
4. **emailService.ts** - Servicio general de emails
5. **dualSignatureService.ts** - Contratos con firma dual
6. **projectPaymentService.ts** - Pagos de proyectos
7. **subscriptionEmailService.ts** - Emails de suscripciones
8. **trialNotificationService.ts** - Notificaciones de trial
9. **otp-service.ts** - Códigos OTP para autenticación

### Rutas que Envían Emails (15+ archivos)
- `email-routes.ts` - Rutas generales de email
- `estimate-email-routes.ts` - Envío de estimates
- `email-contract.ts` - Envío de contratos
- `contractor-payment-routes.ts` - Pagos de contractors
- `dualSignatureRoutes.ts` - Firma dual
- `password-reset-routes.ts` - Reset de contraseñas
- `notifications-routes.ts` - Notificaciones
- Y más...

### Servicio Central
**`resendService.ts`** - Servicio centralizado que maneja TODOS los envíos de email
- Línea 282: `const result = await resend.emails.send(emailPayload);`
- Este es el ÚNICO punto donde realmente se envían emails a Resend

---

## 💡 Arquitectura Actual

```
┌─────────────────────────────────────────────────────────────┐
│  Servicios de Email (invoiceEmailService, etc.)             │
│  ↓                                                           │
│  resendService.sendEmail()                                   │
│  ↓                                                           │
│  resend.emails.send() ← AQUÍ SE ENVÍA EL EMAIL             │
│  ↓                                                           │
│  ❌ NO HAY TRACKING                                          │
└─────────────────────────────────────────────────────────────┘
```

---

## ✅ Solución Propuesta

### Arquitectura Nueva

```
┌─────────────────────────────────────────────────────────────┐
│  Servicios de Email (invoiceEmailService, etc.)             │
│  ↓                                                           │
│  resendService.sendEmail()                                   │
│  ↓                                                           │
│  resend.emails.send() ← ENVÍO DEL EMAIL                     │
│  ↓                                                           │
│  ✅ emailTrackingService.logEmailSent() ← NUEVO             │
│  ↓                                                           │
│  Firestore: email_logs collection                           │
└─────────────────────────────────────────────────────────────┘
```

### Implementación Mínima (1 archivo)

**Crear: `server/services/emailTrackingService.ts`**

```typescript
import { db } from '../lib/firebase';

export interface EmailLogData {
  userId: string;
  emailType: string; // 'invoice', 'estimate', 'contract', etc.
  recipient: string;
  subject: string;
  success: boolean;
  timestamp: Date;
  resendMessageId?: string;
}

export async function logEmailSent(data: EmailLogData): Promise<void> {
  try {
    await db.collection('email_logs').add({
      ...data,
      createdAt: new Date()
    });
  } catch (error) {
    console.error('[EMAIL-TRACKING] Error logging email:', error);
    // NO lanzar error - el tracking no debe bloquear el envío
  }
}
```

**Modificar: `server/services/resendService.ts` (línea 282)**

```typescript
// ANTES:
const result = await resend.emails.send(emailPayload);

// DESPUÉS:
const result = await resend.emails.send(emailPayload);

// Track email send
if (result.data?.id) {
  await emailTrackingService.logEmailSent({
    userId: emailData.userId, // Pasar desde servicios superiores
    emailType: emailData.emailType || 'general',
    recipient: emailData.to,
    subject: emailData.subject,
    success: true,
    timestamp: new Date(),
    resendMessageId: result.data.id
  });
}
```

---

## 📋 Plan de Implementación

### Fase 1: Implementación Básica (URGENTE)
- [ ] Crear `emailTrackingService.ts` con función `logEmailSent()`
- [ ] Modificar `resendService.ts` línea 282 para llamar tracking
- [ ] Agregar campo `userId` a todos los servicios de email
- [ ] Agregar campo `emailType` a todos los servicios de email
- [ ] Probar con 1 envío de invoice

### Fase 2: Integración Completa
- [ ] Actualizar `invoiceEmailService.ts` para pasar userId
- [ ] Actualizar `estimateEmailService.ts` para pasar userId
- [ ] Actualizar `contractorEmailService.ts` para pasar userId
- [ ] Actualizar todos los demás servicios

### Fase 3: Monitoreo en Chyrris KAI
- [ ] Verificar que `getUserUsageBreakdown()` lee email_logs
- [ ] Verificar que `getSystemUsageMetrics()` cuenta emails/día
- [ ] Agregar alertas cuando > 400 emails/día
- [ ] Agregar alertas cuando > 450 emails/día

---

## ⚠️ Riesgos Actuales

1. **Sin límite de control:** Podríamos enviar 1000 emails y no saberlo hasta que Resend bloquee la cuenta
2. **Sin atribución:** No sabemos qué usuario está consumiendo más emails
3. **Sin histórico:** No podemos analizar patrones de uso
4. **Sin alertas:** No hay forma de prevenir exceder el límite

---

## 🎯 Beneficios de la Implementación

1. **Control preciso:** Saber exactamente cuántos emails se envían
2. **Por usuario:** Identificar usuarios que envían muchos emails
3. **Por tipo:** Saber qué features consumen más emails (invoices vs estimates)
4. **Alertas tempranas:** Avisar cuando estamos cerca del límite
5. **Histórico:** Analizar tendencias y planificar upgrades

---

## 📊 Datos Esperados

### Colección Firestore: `email_logs`

```json
{
  "userId": "qztot1YEy3UWz605gIH2iwwWhW53",
  "emailType": "invoice",
  "recipient": "client@example.com",
  "subject": "Factura #12345",
  "success": true,
  "timestamp": "2026-01-03T19:30:00Z",
  "resendMessageId": "re_abc123xyz",
  "createdAt": "2026-01-03T19:30:00Z"
}
```

### Queries en Chyrris KAI

```typescript
// Emails enviados HOY
const today = new Date();
today.setHours(0, 0, 0, 0);
const emailsToday = await db.collection('email_logs')
  .where('createdAt', '>=', today)
  .get();

// Emails por usuario
const userEmails = await db.collection('email_logs')
  .where('userId', '==', userId)
  .get();
```

---

## 🚀 Próximos Pasos

1. **INMEDIATO:** Crear `emailTrackingService.ts`
2. **INMEDIATO:** Modificar `resendService.ts` para tracking
3. **CORTO PLAZO:** Actualizar todos los servicios para pasar userId
4. **MEDIANO PLAZO:** Implementar alertas en Chyrris KAI
5. **LARGO PLAZO:** Considerar upgrade de plan Resend si es necesario

---

**Autor:** Manus AI  
**Revisión requerida:** Gelasio Sanchez (owl@chyrris.com)
