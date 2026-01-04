# 🧪 Guía de Testing: Email Tracking System

**Proyecto:** Owl Fenc + Chyrris KAI  
**Fecha:** 2026-01-03  
**Estado:** ✅ Implementación completada - Listo para testing

---

## 📋 Resumen de Implementación

### ✅ Archivos Creados/Modificados en Owl Fenc

1. **NUEVO:** `server/services/emailTrackingService.ts`
   - `logEmailSent()` - Registra cada email en Firestore
   - `getTodayEmailCount()` - Cuenta emails del día
   - `getUserTodayEmailCount()` - Cuenta emails por usuario
   - `checkEmailLimit()` - Verifica límite (alertas en 80% y 90%)

2. **MODIFICADO:** `server/services/resendService.ts`
   - Agregado import de `emailTrackingService`
   - Actualizado interface `EmailData` con `userId` y `emailType`
   - Tracking automático en línea 286 (emails exitosos)
   - Tracking automático en línea 313 (emails fallidos - sin ID)
   - Tracking automático en línea 347 (emails fallidos - excepción)

3. **MODIFICADO:** `server/services/invoiceEmailService.ts`
   - Agregado `userId` a interface `InvoiceEmailData`
   - 2 llamadas actualizadas con `userId` y `emailType: 'invoice'`

4. **MODIFICADO:** `server/services/estimateEmailService.ts`
   - Agregado `userId` a interface `EstimateData`
   - 4 llamadas actualizadas con `userId` y `emailType: 'estimate'`

### ✅ Chyrris KAI (Ya estaba listo)

- `getSystemUsageMetrics()` ya consulta `email_logs` collection
- `getUserUsageBreakdown()` ya consulta `email_logs` por usuario
- Frontend Usage System ya muestra emails/día y % de uso

---

## 🧪 Plan de Testing

### Test 1: Envío de Invoice (CRÍTICO)

**Objetivo:** Verificar que los invoices se rastrean correctamente

**Pasos:**
1. Abrir Owl Fenc app
2. Ir a sección de Invoices
3. Crear un nuevo invoice
4. Enviarlo a un cliente (usa tu propio email para testing)
5. Verificar que el email llegó

**Verificación en Firestore:**
1. Abrir Firebase Console → Firestore Database
2. Buscar collection `email_logs`
3. Debe haber un nuevo documento con:
   ```json
   {
     "userId": "qztot1YEy3UWz605gIH2iwwWhW53",
     "emailType": "invoice",
     "recipient": "client@example.com",
     "subject": "Factura #12345 - Owl Fenc",
     "success": true,
     "sentAt": Timestamp,
     "resendMessageId": "re_abc123...",
     "createdAt": Timestamp
   }
   ```

**Verificación en Chyrris KAI:**
1. Abrir Chyrris KAI → Usage System
2. Verificar que "Emails Sent (Today)" aumentó en 1
3. Verificar que tu usuario muestra 1 en columna "Emails"
4. Verificar que el % de uso se actualizó

**Resultado esperado:**
- ✅ Email enviado correctamente
- ✅ Documento creado en `email_logs`
- ✅ Count aumentó en Chyrris KAI
- ✅ Count por usuario correcto

---

### Test 2: Envío de Estimate

**Objetivo:** Verificar que los estimates se rastrean correctamente

**Pasos:**
1. Abrir Owl Fenc app
2. Ir a sección de Estimates
3. Crear un nuevo estimate
4. Enviarlo a un cliente
5. Verificar que el email llegó

**Verificación en Firestore:**
- Debe haber un nuevo documento con `emailType: "estimate"`

**Verificación en Chyrris KAI:**
- Count debe aumentar en 1 (o 2 si se envía copia al contractor)

**Resultado esperado:**
- ✅ Email enviado correctamente
- ✅ Documento creado con `emailType: "estimate"`
- ✅ Count aumentó correctamente

---

### Test 3: Múltiples Envíos

**Objetivo:** Verificar que el tracking funciona con múltiples emails

**Pasos:**
1. Enviar 5 invoices diferentes
2. Enviar 3 estimates diferentes
3. Total: 8 emails (o más si hay copias)

**Verificación en Firestore:**
- Debe haber 8+ documentos en `email_logs`
- Cada uno con su `emailType` correcto

**Verificación en Chyrris KAI:**
- Count global debe ser 8+
- Count por usuario debe sumar 8+
- % de uso debe ser ~1.6% (8/500)

**Resultado esperado:**
- ✅ Todos los emails rastreados
- ✅ Counts correctos en Chyrris KAI
- ✅ % de uso correcto

---

### Test 4: Verificar Límite de Alertas

**Objetivo:** Verificar que las alertas funcionan cuando se acerca al límite

**Pasos:**
1. Revisar logs del servidor de Owl Fenc
2. Buscar mensajes de `[EMAIL-TRACKING]`

**Verificación en logs:**
- Si < 400 emails: No debe haber alertas
- Si >= 400 emails (80%): Debe aparecer `⚠️ WARNING`
- Si >= 450 emails (90%): Debe aparecer `🚨 CRITICAL`

**Resultado esperado:**
- ✅ Alertas aparecen en los umbrales correctos

---

### Test 5: Email Fallido

**Objetivo:** Verificar que los emails fallidos también se rastrean

**Pasos:**
1. Intentar enviar un invoice a un email inválido (ej: `test@invalid-domain-xyz.com`)
2. Verificar que el envío falla

**Verificación en Firestore:**
- Debe haber un documento con:
  ```json
  {
    "success": false,
    "errorMessage": "..."
  }
  ```

**Verificación en Chyrris KAI:**
- Count NO debe aumentar (solo cuenta emails exitosos)

**Resultado esperado:**
- ✅ Email fallido registrado en Firestore
- ✅ Count en Chyrris KAI no aumenta

---

### Test 6: Verificar Per-User Tracking

**Objetivo:** Verificar que cada usuario tiene su count individual

**Pasos:**
1. Login como Usuario A
2. Enviar 3 invoices
3. Logout
4. Login como Usuario B
5. Enviar 2 invoices

**Verificación en Chyrris KAI:**
- Usuario A debe mostrar 3 emails
- Usuario B debe mostrar 2 emails
- Total global debe ser 5 emails

**Resultado esperado:**
- ✅ Counts por usuario correctos
- ✅ Total global correcto

---

## 🔍 Troubleshooting

### Problema 1: No aparecen documentos en `email_logs`

**Posibles causas:**
1. Firestore no está configurado correctamente
2. El servicio `emailTrackingService` tiene errores
3. El `userId` no se está pasando correctamente

**Solución:**
1. Verificar logs del servidor de Owl Fenc
2. Buscar errores de `[EMAIL-TRACKING]`
3. Verificar que Firebase está inicializado correctamente

---

### Problema 2: Counts en Chyrris KAI muestran 0

**Posibles causas:**
1. La collection `email_logs` está vacía
2. La query en Chyrris KAI tiene errores
3. El campo `sentAt` tiene formato incorrecto

**Solución:**
1. Verificar que hay documentos en `email_logs` en Firestore
2. Verificar que el campo `sentAt` es un Timestamp
3. Revisar logs de Chyrris KAI para errores de query

---

### Problema 3: Counts no coinciden

**Posibles causas:**
1. Hay emails con `success: false` que no se cuentan
2. Hay emails antiguos que se están contando
3. La query de "today" no está filtrando correctamente

**Solución:**
1. Verificar que solo se cuentan emails con `success: true`
2. Verificar que la query filtra por `sentAt >= today`
3. Revisar la función `getTodayStart()` en Chyrris KAI

---

## 📊 Métricas de Éxito

### ✅ Implementación Exitosa

- [ ] Todos los emails enviados aparecen en `email_logs`
- [ ] Count global en Chyrris KAI es correcto
- [ ] Count por usuario es correcto
- [ ] % de uso se calcula correctamente
- [ ] Alertas aparecen cuando >= 80% del límite
- [ ] Emails fallidos se registran con `success: false`
- [ ] No hay errores en logs del servidor

### ⚠️ Problemas Conocidos

- **Servicios no actualizados:** Los servicios que no son invoice/estimate usan `userId: 'system'` por defecto
- **Solución:** Actualizar manualmente cuando sea necesario

---

## 🚀 Próximos Pasos Después del Testing

### Si todo funciona correctamente:

1. **Monitorear por 1 semana:**
   - Verificar que los counts son precisos
   - Identificar patrones de uso
   - Verificar que no hay emails perdidos

2. **Actualizar servicios restantes:**
   - `contractorEmailService.ts`
   - `projectPaymentService.ts`
   - `subscriptionEmailService.ts`
   - `trialNotificationService.ts`
   - `otp-service.ts`

3. **Implementar alertas automáticas:**
   - Email al admin cuando >= 80% del límite
   - Email al admin cuando >= 90% del límite
   - Notificación en Chyrris KAI

4. **Considerar upgrade a Resend Pro:**
   - Cuando se acerque a 2,500 emails/mes
   - Upgrade a $20/mes para 50,000 emails/mes

---

## 📞 Contacto

Si encuentras problemas durante el testing, documenta:
1. Qué test estabas haciendo
2. Qué esperabas que pasara
3. Qué pasó en realidad
4. Screenshots de Firestore y Chyrris KAI
5. Logs del servidor de Owl Fenc

---

**Autor:** Manus AI  
**Fecha:** 2026-01-03  
**Versión:** 1.0
